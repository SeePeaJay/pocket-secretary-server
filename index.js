require('dotenv').config();
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
				await getEngramsTree(user);
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
    res.redirect('/'); // back to client Landing route
		// TODO: for some reason, any URL here will eventually resolve to '/' (even tho the URL would appear for a brief moment before changing back to '/'). Thankfully, this appears not to be an issue so far.
  }
);

// should only be requested by the client
app.get('/', async function(req, res) {
	if (req.isAuthenticated()) {
		// prepare user and all engram data to send back
		const username = req.user.name;

		try {
			const everyEngramTitleAndContent = await getEveryEngramTitleAndContent(req.user);

			res.send({ username, everyEngramTitleAndContent });
		} catch (error) {
			console.error(error);

			res.send(false);
		}
	} else {
		res.send(false);
	}
});

app.put('/engram', async function(req, res) {
	const engramFilename = `${req.body.engramTitle}.engram`;
	const repoIsInit = false;
	const engramIsNew = req.body.engramIsNew;

	await saveEngram(req.user, engramFilename, req.body.engramContent, repoIsInit, engramIsNew);
	res.sendStatus(200);
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
	console.log('WARNING: User is not authenticated.');
  res.redirect('/');
}

async function getEngramsTree(user) { // return the tree representation of '/engrams' (containing useful info of every file within said directory), as per the Git trees API
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

		const { data: everyCommitData } = await octokit.request('GET /repos/{owner}/{repo}/commits', {
  		owner: user.name,
  		repo: user.repositoryName,
		});

		const mostRecentCommitSha = everyCommitData[0].sha;
		const { data: mostRecentCommitData } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
  		owner: user.name,
  		repo: user.repositoryName,
			ref: mostRecentCommitSha,
		}); // ref here = particular commit sha

		const repoSha = mostRecentCommitData.commit.tree.sha;
		const { data: repoData } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
  		owner: user.name,
  		repo: user.repositoryName,
			tree_sha: repoSha,
		});

		const engramsDirectorySha = repoData.tree.find((item) => item.path === 'engrams').sha;
		const { data: everyEngramData } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
  		owner: user.name,
  		repo: user.repositoryName,
			tree_sha: engramsDirectorySha,
		});

		return everyEngramData.tree;
	} catch (error) {
		throw(error);
	}
}

async function initEngramsDirectory(user) {
	console.log('Need to create the directory ...');

	const engramFilename = 'Starred.engram';
	const engramContent = '* Starred';
	const repoIsInit = true;

	saveEngram(user, engramFilename, engramContent, repoIsInit);
}

async function getEveryEngramTitleAndContent(user) {
	const octokit = new Octokit({
		auth: user.accessToken,
	});

	const everyEngramTitleAndContent = [];
	try {
		const engramsTree = await getEngramsTree(user);

		// console.log(engramsTree);

		for (const basicEngramProperties of engramsTree) {
			const engramFilename = basicEngramProperties.path;
			const { data: specificEngramProperties } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
				owner: user.name,
				repo: user.repositoryName,
				path: `engrams/${engramFilename}`,
			});

			everyEngramTitleAndContent.push({
				title: engramFilename.replace('.engram', ''), // TODO: better way to trim this
				content: specificEngramProperties.content,
			});
		}
	} catch (error) {
		throw error;
	}

	return everyEngramTitleAndContent;
}

// if repo is being initialized ...
async function saveEngram(user, engramFilename, engramContent, repoIsInit, engramIsNew) {
	const octokit = new Octokit({ auth: user.accessToken });
	const owner = user.name;
	const repo = user.repositoryName;
	const path = `engrams/${engramFilename}`;
	let message = repoIsInit ? 'init' : 'auto save';

	try {
		if (!engramIsNew) {
			var { data: { sha } } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}',
				{ owner, repo, path });
		}

		// console.log(sha);

		await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', { owner, repo, path, message,
			content: Buffer.from(engramContent).toString('base64'),
			...(!repoIsInit) && { sha }, // 
		});
	} catch (error) {
		console.error(error);
	}
}
