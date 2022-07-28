require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require("express-session");
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const { Octokit } = require("@octokit/core");
const { RequestError } = require("@octokit/request-error");
const cors = require('cors');

const app = express();

// configure Express
app.use(cors({
	origin: 'http://localhost:8080', // has to be 8080 as of this typing
	methods: ['GET', 'PUT', 'POST', 'DELETE'],
	headers: ['X-Requested-With', 'Content-Type'],
	credentials: true,
}));
app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false, cookie: { secure: false } }));
app.use(express.json());

// configure Passport
passport.serializeUser(function(user, done) {
  done(null, user);
});
passport.deserializeUser(function(obj, done) {
  done(null, obj);
});
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
    callbackURL: "/auth/github/callback",
    proxy: true,
  },
  function(accessToken, refreshToken, profile, done) {
    // asynchronous verification, for effect...
    process.nextTick(async function () {
      const user = {
				id: profile.id,
        name: profile.username,
				accessToken,
				refreshToken,
        repositoryName: '',
      };

			try {
				await setRepositoryName(user);
			} catch (error) {
				if (error instanceof RequestError && error.status === 404 && error.request.url.endsWith('/contents/engrams')) {
					await initEngramsDirectory(user);
				} else {
					console.error(error);

					done(error); // or return done(null, false, { message: '...' });?
				}
			}

      return done(null, user);
    });
  }
));
app.use(passport.initialize());
app.use(passport.session());

// Github authentication server does not allow CORS (client making an axios POST request would not work), so this in combination with a redirect link in the client is the way to go. 
app.get('/auth/github',
  passport.authenticate('github', { scope: [ 'user:email' ], session: true }),
  function(req, res) {
    // The request will be redirected to GitHub for authentication, so this function will not be called.
  }
);
app.get('/auth/github/callback', 
  passport.authenticate('github', { failureRedirect: '/', session: true }),
  function(req, res) {
		console.log('Logging in ...');
    res.redirect('/'); // back to client Landing route
		// TODO: for some reason, any URL here will eventually resolve to '/' (even tho the URL would appear for a brief moment before changing back to '/'). Thankfully, this appears not to be an issue so far.
  }
);

// should only be requested by the client
app.get('/', async function(req, res) {
	if (req.isAuthenticated()) { // prepare user and all engram data to send back
		const username = req.user.name;

		try {
			const dataForAllEngrams = await getDataForAllEngrams(req.user);

			res.send({ username, dataForAllEngrams });
		} catch (error) {
			console.log(error);
			res.sendStatus(502); // TODO: send entire error message (for alert in frontend)?
		}
	} else {
		res.send(false);
	}
});

app.put('/engram', async function(req, res) {
	const engramFilename = `${req.body.engramTitle}.engram`;

	try {
		await saveEngram(req.user, engramFilename, req.body.engramContents, req.body.commitMessage);
		res.sendStatus(200);
	} catch (error) {
		console.log(error);
		res.sendStatus(502);
	}
});

app.delete('/engrams', async function(req, res) {
	const filenamesOfToBeDeletedEngrams = req.body.engramTitles.map((engramTitle) => `${engramTitle}.engram`);
	const commitMessage = req.body.commitMessage;

	try {
		await deleteEngrams(req.user, filenamesOfToBeDeletedEngrams, commitMessage);
		res.sendStatus(200);
	} catch (error) {
		console.log(error);
		res.sendStatus(502);
	}
});

app.post('/logout', function(req, res) { // TODO: DELETE instead of POST?
	console.log('Logging out ...');
  req.logout();
  res.redirect('/'); // TODO: does this even work?
});

app.listen(3000, () => console.log('server is running on port 3000'));

// Simple route middleware to ensure user is authenticated. Use this route middleware on any resource that needs to be protected.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
		console.log('User is authenticated.'); 
    return next();
  }
	console.log('User is not authenticated.');
  res.redirect('/');
}

async function setRepositoryName(user) {
	const octokit = new Octokit({ // for some reason octokit cannot be a param, hence this
		auth: user.accessToken,
	});

	try {
		const { data: installationData } = await octokit.request('GET /user/installations');
		const installationId = installationData.installations[0].id;
		const { data: repositoryData } = await octokit.request(
			'GET /user/installations/{installation_id}/repositories',
			{
				installation_id: installationId,
			}
		);

		user.repositoryName = repositoryData.repositories[0].name; // get first directory only
	} catch (error) {
		throw(error);
	}
}

async function initEngramsDirectory(user) {
	console.log('Need to create the directory ...');

	const engramFilename = 'Starred.engram';
	const engramContents = '* Starred';
	const commitMessage = 'init';

	await saveEngram(user, engramFilename, engramContents, commitMessage);
}

async function getDataForAllEngrams(user) {
	const octokit = new Octokit({
		auth: user.accessToken,
	});

	const dataForAllEngrams = [];
	try {
		const { repository: { object: { entries: allEngramEntries }}} = await octokit.graphql(
			`query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) {
					object(expression: "HEAD:engrams") {
						... on Tree {
							entries {
								name
								object {
									... on Blob {
										text
									}
								}
							}
						}
					}
				}
			}`,
			{ owner: user.name, name: user.repositoryName, }
		); // use variables as suggested at https://github.com/octokit/graphql.js#variables

		allEngramEntries.forEach((entry) => {
			dataForAllEngrams.push({
				title: path.parse(entry.name).name,
				content: Buffer.from(entry.object.text).toString('base64'),
			});
		});
	} catch (error) {
		throw error;
	}

	return dataForAllEngrams;
}

async function getLatestCommitData(user) {
	const octokit = new Octokit({
		auth: user.accessToken,
	});

	try {
		const { data: dataForAllCommits } = await octokit.request('GET /repos/{owner}/{repo}/commits', {
			owner: user.name,
			repo: user.repositoryName,
		});

		return dataForAllCommits[0];
	} catch (error) {
		throw(error);
	}
}

// commitMessage appears to be a better alternative compared to one param for each additional commit reason (repoIsNew, etc.) ... recall Github's 100644
// TODO: GraphQL?
async function saveEngram(user, engramFilename, engramContents, commitMessage) {
	const octokit = new Octokit({ auth: user.accessToken });
	const owner = user.name;
	const repo = user.repositoryName;
	const path = `engrams/${engramFilename}`;

	try {
		if (commitMessage === 'auto save') { // if the engram is not newly created or renamed
			var { data: { sha } } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}',
				{ owner, repo, path }); // var to make sha accessible outside of current scope
		}

		await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', { owner, repo, path,
			message: commitMessage,
			content: Buffer.from(engramContents).toString('base64'),
			...(sha) && { sha }, // conditionally add sha to object
		});
	} catch (error) {
		throw(error);
	}
}

// TODO: GraphQL?
async function deleteEngrams(user, filenamesOfToBeDeletedEngrams, commitMessage) {
	const octokit = new Octokit({ auth: user.accessToken });

	// build a new git tree
	const newTree = [];
	filenamesOfToBeDeletedEngrams.forEach(async (filename) => {
		newTree.push({
			path: `engrams/${filename}`,
			mode: '100644',
			type: 'blob',
			sha: null,
		})
	});

	try {
		const { sha: latestCommitSha } = await getLatestCommitData(user);

		// create the tree on Github
		const { data: dataForCreatingTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
			owner: user.name,
			repo: user.repositoryName,
			tree: newTree,
			base_tree: latestCommitSha,
		});
		const treeSha = dataForCreatingTree.sha;

		// create a new commit that links to the tree
		const { data: newCommitData } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
			owner: user.name,
			repo: user.repositoryName,
			message: commitMessage,
			parents: [latestCommitSha],
			tree: treeSha,
		});
		const newCommitSha = newCommitData.sha;
	
		// update main branch ref to point to the new commit
		await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
			owner: user.name,
			repo: user.repositoryName,
			ref: 'heads/main',
				/*
					* shouldn't be 'refs/...', otherwise run into 422 reference does not exist error
					* should be main, unless Github changes it again ... in which case, consider searching the ref first: https://docs.github.com/en/rest/git/refs#list-matching-references
						* const { data: dataForAllRefs } = await octokit.request('GET /repos/{owner}/{repo}/git/matching-refs/{ref}', 	{
								owner: user.name,
								repo: user.repositoryName,
								ref: 'heads',
							});
				*/
			sha: newCommitSha,
			force: true,
		});

	} catch (error) {
		throw(error);
	}
}
