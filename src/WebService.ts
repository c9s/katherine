const connect = require('connect');
const urlrouter = require('urlrouter');
const url = require('url');
const slack = require('@slack/client');

const fs = require('fs');
const path = require('path');
const Redis = require("redis");
const _ = require('underscore');



import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployRequest} from "./DeployRequest";
import {WorkerPool} from "./WorkerPool";
import {SlackMessage} from "./SlackMessage";

const config = JSON.parse(fs.readFileSync('delivery.json'));

const token = process.env.SLACK_API_TOKEN || '';
const slackWeb = new slack.WebClient(token);

const redis = Redis.createClient(config.redis);

const workerPool = new WorkerPool(config);

function getUserIds() {
  return new Promise<any>(resolve => {
    slackWeb.users.list({}, (err, resp) => {
      let memberIds = {};
      resp.members.forEach((el, i) => {
        memberIds[el.name] = el.id;
      });
      resolve(memberIds);
    });
  });
}

function getChannelIds() {
  return new Promise<any>(resolve => {
    slackWeb.channels.list({ exclude_archived: true }, (err, resp) => {
      let channelIds = {};
      resp.channels.forEach((el, i) => {
        channelIds[el.name] = el.id;
      });
      resolve(channelIds);
    });
  });
}
Promise.all([ getChannelIds(), getUserIds() ]).then((result) => {
  console.log("Got the channel IDs and user IDs...");
  let channelIds = result[0];
  let userIds = result[1];

  console.log("Creating http server...");
  connect(urlrouter((app) => {
    app.get('/deploy/:app/:branch/:sites', function (req, res, next) {
      let u = url.parse(req.url, true);

      // u.query.silent
      // console.log(req);
      let request = { 
        appName: req.params.app,
        branch: req.params.branch,
        sites: req.params.sites.split(/,/),
        silent: true,
        fromMessage: {
          user: null,
          // user: userIds['c9s'],
          channel: channelIds['bot-tests']
        } as SlackMessage
      } as DeployRequest;

      console.log("Request", request);

      workerPool.findIdleWorker().then((workerId) => {
        redis.publish(workerId, JSON.stringify({ 'type': 'deploy', 'request' : request }));
      }).catch((e) => {
        console.log(e);
        // this.rtm.sendMessage(`Error: ${e}`, message.channel);
        // this.rtm.sendMessage(formatReply(message.user, 'Sorry, all the workers are busy...'), message.channel);
      });

      res.end('OK');
    });
  })).listen(3000);
});
