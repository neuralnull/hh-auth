'use strict'

var express = require('express');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var randomstring = require("randomstring");
var NodeRSA = require('node-rsa');
var fs = require('fs');
var request = require('request');
var levelup = require('levelup')
var leveldown = require('leveldown')

var config = require('./config.json');
var personalConfig = require('./personal-config.json');

if (!fs.existsSync('./db')) {
    fs.mkdirSync('./db');
}

var app = express();
var publicKey = new NodeRSA();
var verificationTokens = {};

var usersDB = levelup(leveldown('./db/users'));
var usersCache = {};

function generateToken() {
    let token = randomstring.generate();

    verificationTokens[token] = setTimeout(function () {
        delete verificationTokens[token];
    }, config.verification.tokenTTL*1000);

    return token;
}

function hasToken(token) {
    return token in verificationTokens;
}

function deleteToken(token) {
    if (hasToken(token)) {
        clearTimeout(verificationTokens[token]);
        delete verificationTokens[token];
    }
}

function getCurrentDate() {
    let date = new Date();

    date = new Date(
        date.getTime() +
        60000*date.getTimezoneOffset() +
        3600000*config.server.timeZoneOffset
    );

    return date;
}

function getVisitDate(date) {
    return date.toLocaleString('ISO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getVisitTime(date) {
    return date.toLocaleTimeString('ISO', { hour: '2-digit', minute: '2-digit' });
}

publicKey.importKey(fs.readFileSync(config.verification.publicKey));

usersDB.createReadStream().on('data', (user) => {
    usersCache[user.key] = JSON.parse(user.value);
    usersCache[user.key].db = levelup(leveldown(`./db/user-${user.key}`));
});

app.use(cookieParser(personalConfig.server.secret));
app.use(bodyParser.json());

app.use((req, res, next) => {
    if ('userId' in req.signedCookies) {
        req.userData = usersCache[req.signedCookies.userId];
    }
    next();
});

app.get('/', (req, res, next) => {
    if (!req.userData) {
        let slackAuthUrl =
            `${config.slackAuth.authUrl}?scope=${config.slackAuth.scope}` +
            `&client_id=${personalConfig.slackAuth.clientId}`;

        res.redirect(slackAuthUrl);
    } else {
        next();
    }
});

app.get('/api/slack-auth', (req, res) => {
    if (!('code' in req.query) || ('error' in req.query)) {
        res.status(400).end();
    } else {
        let slackAccessUrl =
            `${config.slackAuth.accessUrl}?client_id=${personalConfig.slackAuth.clientId}` +
            `&client_secret=${personalConfig.slackAuth.clientSecret}&code=${req.query.code}`;

        request(slackAccessUrl, { json: true }, (slackErr, slackRes, slackData) => {
            if (slackErr || !slackData.ok) {
                res.status(400).end();
            } else {
                let userData = {
                    name: slackData.user.name,
                    email: slackData.user.email,
                    avatar: slackData.user.image_72
                }

                usersDB.put(slackData.user.id, JSON.stringify(userData), (err) => {
                    if (err) {
                        res.status(500).end('Internal error');
                    } else {
                        usersCache[slackData.user.id] = userData;
                        if (!usersCache[slackData.user.id].db) {
                            usersCache[slackData.user.id].db = levelup(leveldown(`./db/user-${slackData.user.id}`));
                        }
                        res.cookie('userId', slackData.user.id, { signed: true });
                        res.redirect('/');
                    }
                });
            }
        });
    }
});

app.use((req, res, next) => {
    if (!req.userData) {
        res.status(401).end();
    } else {
        next();
    }
});

app.get('/js/token-signer.js', (req, res, next) => {
    if (('token' in req.query) || ('sign' in req.query)) {
        if ((('token' in req.query) ^ ('sign' in req.query))
            || !hasToken(req.query.token)
            || !publicKey.verify(req.query.token, req.query.sign.replace(/ /g, '+'), 'binary', 'base64')) {
            res.status(400).end();
        } else {
            let date = getCurrentDate();
            let visitDate = getVisitDate(date);
            let visitTime = getVisitTime(date);

            req.userData.db.put(visitDate, visitTime, (err) => {
                if (err) {
                    res.status(500).end();
                } else {
                    deleteToken(req.query.token);
                    next();
                }
            });
        }
    } else {
        res.redirect(`${config.verification.signer}${req.path}?token=${generateToken()}`);
    }
});

app.get('/api/attendance', (req, res) => {
    let attendance = [];
    let usersCount = 0;
    let visitDate = req.query.visitDate || getVisitDate(getCurrentDate());

    for (let userId in usersCache) {
        usersCount++;
        usersCache[userId].db.get(visitDate, (err, visitTime) => {
            if (!err) {
                attendance.push({
                    name: usersCache[userId].name,
                    email: usersCache[userId].email,
                    avatar: usersCache[userId].avatar,
                    visitTime: visitTime.toString()
                });
            }
            if (--usersCount == 0) {
                res.send(attendance);
            }
        });
    }
});

app.use(express.static('static'));

app.listen(config.server.port);
