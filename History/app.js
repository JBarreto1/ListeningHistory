var fetch = require('node-fetch')
var express = require('express'); // Express web server framework
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
// var CronJob = require('cron').CronJob;
// var mongo = require('mongodb');

const {promisify} = require('util');

const key = require("../key");
const client_id = key.client_id
const client_secret = key.client_secret
var redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri

var MongoClient = require('mongodb').MongoClient;
var DBurl = "mongodb://localhost:27017/";
const db = require("./db");
const collection = "UserHist";


/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

async function fetchFirstToken(code, redirect_uri) {
    // given the code that comes back from Spotify, go get a refresh and access token

    const data = 'code='+code+'&redirect_uri='+redirect_uri+'&grant_type=authorization_code'
    const url = 'https://accounts.spotify.com/api/token'
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + (Buffer.from(client_id + ':' + client_secret).toString('base64'))
        },
        body: data //JSON.stringify(data) // body data type must match "Content-Type" header
        });
    //   const token = response.json()
    //   console.log(token)
    return response.json()
}

async function fetchRefreshedToken(refresh_token) {
    // given the refresh token we got from our first request, go get a new access token

    const data = 'refresh_token=' + refresh_token + '&grant_type=refresh_token'
    const url = 'https://accounts.spotify.com/api/token'
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + (Buffer.from(client_id + ':' + client_secret).toString('base64'))
        },
        body: data //JSON.stringify(data) // body data type must match "Content-Type" header
        });
    //   const token = response.json()
    //   console.log(token)
    return response.json()
}

async function fetchCurrentUser(access_token) {
    // given the access token, fetch the current user's information

    const url = 'https://api.spotify.com/v1/me'
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + access_token
        }
        });
    return response.json()
}

async function findUserInDB(currentUser,currentUserName){
    //return the after timemark if the user already existed in the DB, otherwise return null
    let after = null
    // db.getDB().collection(collection).find({}).toArray((err,documents)=>{
    //     if(err)
    //         console.log(err);
    //     else{
    //         console.log(documents)
    //     }
    // })

    const client = await MongoClient.connect(DBurl,{useNewUrlParser: true}) // function(err, db) {
        .catch(err => { console.log(err); });   
        //find the User and determine if there's an entry already
    try {
        const dbo = client.db("SpotifyHistory");
        var query = { userID: currentUser };
        let result = await dbo.collection("UserHist").find(query)
            if (result) {
                after = result.after
            }
        
    } catch(err) {
        console.log(err);
    } try {
         //is this the first time I'm seeing this user (they aren't in the DB)?
         const dbo = client.db("SpotifyHistory");
        var query = { userID: currentUser };
         if (after == null) {
            //if I couldn't find the user ID, it must be a new one - add them to the DB!
            var newUser = { 
                currentUserName: currentUserName, 
                userID: currentUser, 
                tracks: [] };
            let result = await dbo.collection("UserHist").insertOne(newUser)
                console.log("New User Added!");
            
            }
    } catch (err) {
        console.log(err);
    }
    finally {
        client.close();
    }
    return after
      //return '1632153130833'
}

async function fetchPlayHistorySinceLast(access_token, after) {
    // given the access token, fetch the recently played history starting after a given time. 50 is still the API max
    let url = 'https://api.spotify.com/v1/me/player/recently-played?'
    const limit = 2
    if (after) {
        url += new URLSearchParams({
            'limit': limit,
            'after': after
        })
    } else {
        url += new URLSearchParams({
            'limit': limit
        })
    }
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + access_token
        }
        });
    if (response.status === 200) {
        return response.json()
    } else {
        console.log(response)
    }
}

async function storePlays(data,currentUser) {
    // Take the whole returned JSON data from recently played API and add it to the data base
        const client = await MongoClient.connect(DBurl,{useNewUrlParser: true}) // function(err, db) {
            .catch(err => { console.log(err); });
        //find the User and determine if there's an entry already
        // if (err) throw err;
        // var dbo = db.db("SpotifyHistory");
        try {
            const dbo = client.db("SpotifyHistory");
            let myquery = { userID: currentUser };
            // console.log(currentUser)
            // console.log(data)
            for (let i = 0; i < data.items.length; i++) {
                let trackToAdd = {
                    name: data.items[i].track.name,
                    id: data.items[i].track.id,
                    artist: data.items[i].track.artists[0].name, //a song can belong to multiple artists keep the first (might change later)
                    album: data.items[i].track.album.name,
                    played_at: data.items[i].played_at, //This one isn't in the track level
                    uri: data.items[i].track.name,
                    external_url: data.items[i].track.external_urls.spotify //possible other external urls
                }

                await dbo.collection("UserHist").updateOne( myquery, { $push: { tracks: trackToAdd } });
            }
            //I've added the tracks to the users history, so now I can adjust the cursor so that I don't add duplciates
            let moveCursor = { $set: {after: data.cursors.after} };
            await dbo.collection("UserHist").updateOne(myquery, moveCursor, function(err, res) {
                console.log("1 document updated");
            })
        } catch (err) {
            console.log(err)
        }
        finally {

            client.close();
        }
}

async function getTracksFromDB(currentUser) {
    db.getDB().collection(collection).find({userID: currentUser}).toArray((err,documents)=>{
        if(err)
            console.log(err);
        else{
            console.log(documents)
        }
    })
}

var stateKey = 'spotify_auth_state';

var app = express();

app.use(express.static(__dirname + '/public'))
   .use(cors())
   .use(cookieParser());

app.get('/login', function(req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-read-private user-read-email user-read-recently-played';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/callback', function(req, res) {

    // your application requests refresh and access tokens
    // after checking the state parameter
  
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;
  
    if (state === null || state !== storedState) {
      res.redirect('/#' +
        querystring.stringify({
          error: 'state_mismatch'
        }));
    } else {
      res.clearCookie(stateKey);
      
      fetchFirstToken(code, redirect_uri)
        .then(data => {
            // I can grab an access code here, but it expires in an hour, so just use the refresh to get a new access token before ever call to recently played
            const refresh_token = data.refresh_token; 

            fetchRefreshedToken(refresh_token)
                .then(data => {
                    access_token = data.access_token;
                    let currentUser = null
                    let currentUserName = null
                    let after = null

                    fetchCurrentUser(access_token)
                        .then(data => {
                            currentUser = data.id
                            currentUserName = data.name
                            
                            findUserInDB(currentUser,currentUserName)
                                .then(after => {
                                    fetchPlayHistorySinceLast(access_token, after)
                                        .then(data => {
                                            console.log(currentUser)
                                            storePlays(data, currentUser)
                                            // console.log(data)
                                            // res.json({
                                            //     data: currentUser
                                            // })
                                            res.redirect('/#' +
                                                querystring.stringify({
                                                    loggedIn: true
                                                }));
                                        })
                                        .catch((error) => {
                                            console.error('Error (getting play history):', error);
                                        })
                                    })
                                .catch((error) => {
                                    console.log('Error finding the user in the DB', error)
                                })
                        })
                        .catch((error) => {
                            console.error('Error (getting user data):', error);
                        })
                    
                })
                .catch((error) => {
                    console.error('Error (getting refresh token):', error);
                })
        })
        .catch((error) => {
            console.error('Error (getting first token):', error);
          });;
    
    
        //   getTracksFromDB(currentUser)

        //   res.redirect('/#' +
        //     querystring.stringify({
        //         data: "info sent"
        //     }));
    //   else {
    //     res.redirect('/#' +
    //       querystring.stringify({
    //         error: 'invalid_token'
    //       }));
    //   }
    
    }
})

// add cronJob functionality in the future to keep an ongoing log of the songs I've listened to
// var CronJob = require('cron').CronJob;

// const fetchSpotHist = require('./tasks/fetch-spotify')

// var job = new CronJob('* * */2 * * *', fetchSpotHist, null, true, 'America/Los_Angeles');

// console.log('After job instantiation');
// job.start();

db.connect((err)=>{
    // If err unable to connect to database
    // End application
    if(err){
        console.log('unable to connect to database');
        process.exit(1);
    }
    // Successfully connected to database
    // Start up our Express Application
    // And listen for Request
    else{
        // app.listen(3000,()=>{
        //     console.log('connected to database, app listening on port 3000');
        // });
        console.log("connected to db")
    }
});

console.log('Listening on 8888');
app.listen(8888);