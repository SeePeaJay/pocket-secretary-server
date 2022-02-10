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
				await getEngramsDirectoryData(user);
			} catch (error) {
				if (error instanceof RequestError && error.status === 404 && error.request.url.endsWith('/contents/engrams')) {
					await saveEngramData(user, 'sample.engram', '* Sample');
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

app.get('/auth/github',
  passport.authenticate('github', { scope: [ 'user:email' ], session: true }),
  function(req, res){
    // The request will be redirected to GitHub for authentication, so this function will not be called.
  });

app.get('/auth/github/callback', 
  passport.authenticate('github', { failureRedirect: '/', session: true }),
  function(req, res) {
    res.redirect('/');
  });

app.get('/', function(req, res) {
	if (req.isAuthenticated()) {
		res.send(req.user.name);
	} else {
		res.send(false);
	}
});

app.get('/engrams', ensureAuthenticated, async (req, res) => {
	const engramTitles = [];

	try {
		const engramsDirectoryData = await getEngramsDirectoryData(req.user);
		for (const basicEngramData of engramsDirectoryData) {
			engramTitles.push(basicEngramData.name.replace('.engram', ''));
		}
	} catch (error) {
		console.error(error);
	}

  res.send(engramTitles);
  });

app.get('/engrams/:engramTitle', ensureAuthenticated, async (req, res) => {
	const engramData = {};
	const octokit = new Octokit({
		auth: req.user.accessToken,
	});

	try {
		const engramsDirectoryData = await getEngramsDirectoryData(req.user);

		const engramFilename = engramsDirectoryData.find((basicEngramData) => basicEngramData.name.startsWith(req.params.engramTitle)).name;
		const { data: basicEngramData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
			owner: req.user.name,
			repo: req.user.repositoryName,
			path: `engrams/${engramFilename}`,
		});

		engramData.title = engramFilename.replace('.engram', '');
		engramData.content = basicEngramData.content;
	} catch (error) {
		console.error(error);
	}

	console.log(engramData);

	res.send(engramData);
});

app.put('/engram', function(req, res) {
	// await saveEngramData(req.user, engramFilename, engramContent);
});

app.post('/logout', function(req, res) {
	console.log('Logging out ...');
  req.logout();
  res.redirect('/');
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

async function getEngramsDirectoryData(user) {
	const octokit = new Octokit({
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

		const { data: engramsDirectoryData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
			owner: user.name,
			repo: user.repositoryName,
			path: 'engrams'
		});

		return engramsDirectoryData;
	} catch (error) {
		throw(error);
	}
}

async function saveEngramData(user, engramFilename, engramContent) {
	console.log('Need to create the directory ...');

	const octokit = new Octokit({
		auth: user.accessToken,
	});

	try {
		await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
			owner: user.name,
			repo: user.repositoryName,
			path: `engrams/${engramFilename}`,
			message: 'init',
			content: Buffer.from(engramContent).toString('base64'),
		});
	} catch (error) {
		console.error(error);
	}
}
