'use strict'

var express = require('express');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var randomstring = require("randomstring");
var NodeRSA = require('node-rsa');
var fs = require('fs');
var config = require('./config.json');

var app = express();
var publicKey = new NodeRSA();
var verificationTokens = {};

publicKey.importKey(fs.readFileSync(config.verification.publicKey));

app.use(cookieParser());
app.use(bodyParser.json());

app.get('/js/token-signer.js', function(req, res) {
    if (('token' in req.query) || ('sign' in req.query)) {
        if ((('token' in req.query) ^ ('sign' in req.query))
            || !(req.query.token in verificationTokens)
            || !publicKey.verify(req.query.token, req.query.sign.replace(/ /g, '+'), 'binary', 'base64')) {
            res.status(400).end();
        } else {
            clearTimeout(verificationTokens[req.query.token]);
            delete verificationTokens[req.query.token];

            res.end();
        }
    } else {
        let token = randomstring.generate();

        verificationTokens[token] = setTimeout(function () {
            delete verificationTokens[token];
        }, config.verification.tokenTTL*1000);

        res.redirect(config.verification.signer + req.path + '?token=' + token);
    }
});

app.use(express.static('static'));

app.listen(config.server.port);
