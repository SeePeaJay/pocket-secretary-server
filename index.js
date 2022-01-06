require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require("express-session");
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const { Octokit } = require("@octokit/core");
const { RequestError } = require("@octokit/request-error");
const axios = require('axios');
// var util = require('util');
// var bodyParser = require('body-parser');
// var methodOverride = require('method-override');
// var partials = require('express-partials');

passport.serializeUser(function(user, done) {
  done(null, user);
});
passport.deserializeUser(function(obj, done) {
	console.log('plz tell me this isnt called');
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
        engramDataArray: [],
      };

			// const userMatchIndex = users.findIndex(user => user.id === profile.id);

			// if (userMatchIndex !== -1) {
			// 	users[userMatchIndex].accessToken = accessToken;
			// 	users[userMatchIndex].refreshToken = refreshToken;
			// } else {
			// 	users.push(user);
			// }
      
			// console.log(user);

      return done(null, user);
    });
  }
));

const app = express();

// configure Express
app.use(function(req, res, next) {
   //replace localhost:8080 to the ip address:port of your server
   res.header("Access-Control-Allow-Origin", "http://localhost:8080"); // has to be 8080 as of this writing
   res.header("Access-Control-Allow-Headers", "X-Requested-With");
   res.header('Access-Control-Allow-Headers', 'Content-Type');
   res.header('Access-Control-Allow-Credentials', true);
   next();
});
// app.set('views', __dirname + '/views');
// app.set('view engine', 'ejs');
// app.use(partials());
// app.use(bodyParser.urlencoded({ extended: true }));
// app.use(bodyParser.json());
// app.use(methodOverride());
app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false, cookie: { secure: false } }));
app.use(passport.initialize());
app.use(passport.session());
// app.use(express.static(__dirname + '/public'));

app.get('/auth/github',
  passport.authenticate('github', { scope: [ 'user:email' ], session: true }),
  function(req, res){
    // The request will be redirected to GitHub for authentication, so this
    // function will not be called.
  });

app.get('/auth/github/callback', 
  passport.authenticate('github', { failureRedirect: '/', session: true }),
  async function(req, res) {
    // const code = req.query.code;

    console.log(req.isAuthenticated());
		console.log(req.user);
		console.log(req.sessionID);

    res.redirect('/engrams');
  });

app.get('/engrams', async (req, res) => {
	console.log('---------------')
  console.log(req.isAuthenticated());
	console.log(req.user);
	console.log(req.sessionID);

	const octokit = new Octokit({
		auth: req.user.accessToken,
	});

	try {
		const { data: installationData } = await octokit.request('GET /user/installations');
		const installationId = installationData.installations[0].id;

		const { data: repositoryData } = await octokit.request(`GET /user/installations/${installationId}/repositories`);
		req.user.repositoryName = repositoryData.repositories[0].name; // get first directory only

		const { data: engramsDirectoryData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
			owner: req.user.name,
			repo: req.user.repositoryName,
			path: 'engrams'
		});
			// make sure you have set the `Contents` permission to read & write for this part to work
			// may need to use another method if list of engrams reach over 1k, see https://docs.github.com/en/rest/reference/repos#get-repository-content

		const engramDataArray = [];
		for (const basicEngramData of engramsDirectoryData) {
			const { data: engramData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
				owner: req.user.name,
				repo: req.user.repositoryName,
				path: `engrams/${basicEngramData.name}`,
			});

			// console.log(engramData.content)
			engramDataArray.push({
				title: basicEngramData.name.replace('.engram', ''),
				content: engramData.content,
			});
		}
		req.user.engramDataArray = engramDataArray;
	} catch (error) {
		if (err instanceof RequestError && err.status === 404 && err.request.url.endsWith('/contents/engrams')) {
			console.log('need to create the directory');

			await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
				owner: req.user.name,
				repo: req.user.repositoryName,
				path: 'engrams/sample.engram',
				message: 'init',
				content: Buffer.from('* Sample').toString('base64'),
			});

			req.user.engramDataArray.push(
				{
					title: 'sample',
					content: Buffer.from('* Sample').toString('base64'),
				},
			);
		} else {
			console.error(err);

			done(err); // or return done(null, false, { message: '...' });?
		}
	}

  res.send(req.user.engramDataArray);
  });

app.listen(3000, () => console.log('server is running on port 3000'));

// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed.  Otherwise, the user will be redirected to the
//   login page.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    console.log('authenticated wooo');
    return next();
  }
  console.log('oh no');
  res.redirect('/');
}


/*
const users = [{
	id: 0,
	name: 'dummy user',
	accessToken: '0123',
	refreshToken: '4567',
	repositoryName: 'very original',
	engramDataArray: [{
		title: 'Dog',
		content: '',
	}],
}];

const octokit = new Octokit({
        auth: accessToken,
      });

      try {
        const { data: installationData } = await octokit.request('GET /user/installations');
        const installationId = installationData.installations[0].id;

        const { data: repositoryData } = await octokit.request(`GET /user/installations/${installationId}/repositories`);
        user.repositoryName = repositoryData.repositories[0].name; // get first directory only

        const { data: engramsDirectoryData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner: user.name,
          repo: user.repositoryName,
          path: 'engrams'
        });
          // make sure you have set the `Contents` permission to read & write for this part to work
          // may need to use another method if list of engrams reach over 1k, see https://docs.github.com/en/rest/reference/repos#get-repository-content

        for (const basicEngramData of engramsDirectoryData) {
          const { data: engramData } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: user.name,
            repo: user.repositoryName,
            path: `engrams/${basicEngramData.name}`,
          });

          // console.log(engramData.content)
          user.engramDataArray.push({
            title: basicEngramData.name.replace('.engram', ''),
            content: engramData.content,
          });
        }
      } catch (error) {
        if (err instanceof RequestError && err.status === 404 && err.request.url.endsWith('/contents/engrams')) {
          console.log('need to create the directory');

          await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
            owner: user.name,
            repo: user.repositoryName,
            path: 'engrams/sample.engram',
            message: 'init',
            content: Buffer.from('* Sample').toString('base64'),
          });

          user.engramDataArray.push(
            {
              title: 'sample',
              content: Buffer.from('* Sample').toString('base64'),
            },
          );
        } else {
          console.error(err);

          done(err); // or return done(null, false, { message: '...' });?
        }
      }
*/