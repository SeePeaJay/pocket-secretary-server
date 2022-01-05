require('dotenv').config();
const express = require('express');
const session = require("express-session");
const passport = require('passport');
const axios = require('axios');
const GitHubStrategy = require('passport-github2').Strategy;
const { Octokit } = require("@octokit/core");
const { RequestError } = require("@octokit/request-error");

const app = express();
let engramDataArray = [];

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "http://localhost:8080"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
}); // this is needed to prevent the `Cross-Origin Request Blocked` error somehow ...?

app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
// to support persistent login sessions, apparently?

app.get('/auth/github', async (req, res) => {
	res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_APP_CLIENT_ID}`);
});

app.get('/auth/github/callback',
  async (req, res) => {
		// Successful authentication, redirect home.
		// console.log(req); // result is printed in the terminal, not in the browser
		const code = req.query.code;
		let octokit = null;
		let userName = '';
		let installationId = 0;
		let repositoryName = '';

  	try {
      const accessTokenResponse = await axios.post('https://github.com/login/oauth/access_token', {}, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
        params: {
          client_id: process.env.GITHUB_APP_CLIENT_ID,
          client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
          code,
        }
      });

      const accessToken = accessTokenResponse.data.access_token

      // const userResponse = await axios.get('https://api.github.com/user', {
      // headers: {
      //  'Authorization': `token ghu_FCPEI6hxXfRO7pSFaO9B8qhazBuGe50J2w6O`,
      // }
      // });
      // console.log(userResponse.data);

      octokit = new Octokit({
        auth: accessToken,
      });

      const { data: userData } = await octokit.request('GET /user');
			userName = userData.login;

			const { data: installationData } = await octokit.request('GET /user/installations');
			installationId = installationData.installations[0].id;

			const { data: repositoryData } = await octokit.request(`GET /user/installations/${installationId}/repositories`);
			repositoryName = repositoryData.repositories[0].name;

			// const { data: psecDirectoryData } = await octokit.request('GET /repos/SeePeaJay/pocket-secretary-repo-test/contents/psec');
			const { data: engramsDirectoryData } = await octokit.request(`GET /repos/${userName}/${repositoryName}/contents/engrams`);
				// make sure you have set the `Contents` permission to read & write for this part to work
				// may need to use another method if list of engrams reach over 1k, see https://docs.github.com/en/rest/reference/repos#get-repository-content

			for (const basicEngramData of engramsDirectoryData) {
				const { data: engramData } = await octokit.request(`GET /repos/${userName}/${repositoryName}/contents/engrams/${basicEngramData.name}`);

				console.log(engramData.content)
				engramDataArray.push({
					title: basicEngramData.name.replace('.engram', ''),
					content: engramData.content,
				});
			}
      // console.log(engramsDirectoryData); // maybe at this point download the engram and send the content back to client?
    } catch (err) {
			if (err instanceof RequestError) {
				if (err.status === 404 && err.request.url.endsWith('/contents/engrams')) {
					console.log('need to create the directory');

					await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
  					owner: userName,
  					repo: repositoryName,
  					path: 'engrams/sample.engram',
  					message: 'init',
  					content: Buffer.from('* Sample').toString('base64'),
					});

					engramDataArray = [
						{
							title: 'sample',
							content: Buffer.from('* Sample').toString('base64'),
						},
					];
				}
			} else {
				console.error(err);
			}
    }

    res.redirect('/engrams');
	});

app.get('/engrams', (req, res) => {
	// console.log(engramDataArray);
	res.send(engramDataArray);
	});

// check if authenticated; redirect?

app.listen(3000, () => console.log('server is running on port 3000'));
