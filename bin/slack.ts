/// <reference path="../node_modules/typeloy/lib/src/index.d.ts" />

const fs = require('fs');
const path = require('path');
const slack = require('@slack/client');
const _ = require('underscore');
import child_process = require('child_process');

import {DeployStatement, SetupStatement, RestartStatement, LogsStatement} from "../src/statements";
import {WorkerPool} from "../src/WorkerPool";

const MemoryDataStore = slack.MemoryDataStore;
const RtmClient = slack.RtmClient;
const token = process.env.SLACK_API_TOKEN || '';

const Redis = require("redis");

const rtm = new RtmClient(token, {
  // logLevel: 'debug',
  dataStore: new MemoryDataStore(),
});
const slackWeb = new slack.WebClient(token);

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";

const config = JSON.parse(fs.readFileSync('katherine.json'));
const sub = Redis.createClient(config.redis);
const pub = Redis.createClient(config.redis);

const CLIENT_EVENTS = slack.CLIENT_EVENTS;
const RTM_EVENTS = slack.RTM_EVENTS;
const RTM_CLIENT_EVENTS = slack.CLIENT_EVENTS.RTM;

function formatError(m) {
  if (m instanceof Error) {
    return m.message;
  }
  return m;
}

function formatPlainText(message : string) : string {
  if (typeof message === "object") {
    message = JSON.stringify(message);
  }
  return "```\n"
   + message
   + "\n```";
}

function formatReply(userId : string, message) : string {
  return `<@${userId}>: ${message}`;
}

abstract class SlackBot {

  protected rtm;

  protected messageQueue : Promise<any>;

  constructor(rtm) {
    this.rtm = rtm;
    this.messageQueue = Promise.resolve({});
  }

  public sendMessage(message, channel) {
    if (typeof message === "object") {
      this.sendWebAPIMessage(message, channel);
    } else {
      this.sendRtmMessage(message, channel);
    }
  }

  public sendWebAPIMessage(message, channel) {
    this.messageQueue.then(() => {
      return new Promise(resolve => {
        let msg = _.extend(message, {
          "channel": channel,
          "as_user": true
        });
        slackWeb.chat.postMessage(channel, "", msg, resolve);
      });
    });
  }

  public sendRtmMessage(message, channel) {
    this.messageQueue.then(() => {
      return new Promise(resolve => {
        this.rtm.sendMessage(message, channel, resolve);
      });
    });
  }

}

class DeployBot extends SlackBot {

  protected startData;

  protected config;

  constructor(rtm, config) {
    super(rtm);
    this.config = config;

    this.rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, this.handleStartData.bind(this));
    this.rtm.on(RTM_EVENTS.MESSAGE, this.handleMessage.bind(this));
    this.rtm.on(RTM_EVENTS.CHANNEL_JOINED, this.handleChannelJoined.bind(this));

    // you need to wait for the client to fully connect before you can send messages
    this.rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, () => {
      let user = rtm.dataStore.getUserById(rtm.activeUserId);
      let team = rtm.dataStore.getTeamById(rtm.activeTeamId);
      console.log('Connected to ' + team.name + ' as ' + user.name);
    });


    sub.on("message", this.handleMasterMessage.bind(this));
    sub.on("subscribe", (channel, count) => {
      console.log("redis.subscribe", channel, count);
    });
    sub.subscribe(MASTER_CHANNEL);
  }

  handleMasterMessage(channel : string, message : string) {
    let payload = JSON.parse(message);
    // console.log('handleMasterMessage', channel, JSON.stringify(payload, null, "  "));
    switch (payload.type) {
      case "connect":
        // this.rtm.sendMessage(`worker ${payload.name} connected.`, payload.currentRequest.fromMessage.channel);
        pub.publish(payload.name, JSON.stringify({ 'type': 'config', 'config': this.config }));
        break;
      case "ready":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(`The deploy worker ${payload.name} is ready.`, payload.currentRequest.fromMessage.channel);
        }
        break;
      case "error":
      case "debug":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(formatPlainText(payload.message), payload.currentRequest.fromMessage.channel);
        }
      case "progress":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(payload.message, payload.currentRequest.fromMessage.channel);
        }
        break;
    }
  }

  handleMessage(message) {
    let user = this.rtm.dataStore.getUserById(message.user);
    let channel = this.rtm.dataStore.getChannelGroupOrDMById(message.channel);

    if (user && channel) {
      console.log(
        'User %s posted a message in %s channel',
        user.name,
        channel.name
      );
    }

    const parseDeployStatement = new RegExp('');
    const parseMentionUserId = new RegExp('^<@(\\w+)>:\\s*');

    if (!message.text) {
      return;
    }

    const matches = message.text.match(parseMentionUserId);
    if (!matches) {
      return;
    }
    console.log("Request matches ID: ", matches);

    const objectId = matches[1];

    const statements = {
      'deploy'  : new DeployStatement,
      'setup'   : new SetupStatement,
      'restart' : new RestartStatement,
      'logs'    : new LogsStatement,
    };

    // talking to me...
    if (objectId == this.startData.self.id) {
      const sentence = message.text.replace(parseMentionUserId, '');
      for (const jobType in statements) {
        const s = statements[jobType];
        const request = s.parse(sentence);
        if (request) {
          request.fromMessage = message;
          /*
          this.workerPool.findIdleWorker().then((workerId) => {
            console.log(`job: ${jobType} => worker ${workerId}`);
            pub.publish(workerId, JSON.stringify({ 'type': jobType, 'request' : request }));
          }).catch((e) => {
            console.log(e);
            this.rtm.sendMessage(`Error: ${e}`, message.channel);
          });
          */
          return;
        }
      }
      this.rtm.sendMessage(formatReply(message.user, "Sorry, I don't understand."), message.channel);
    }
  }

  handleChannelJoined(message) {
    console.log("CHANNEL_JOINED", message);
  }

  handleStartData(rtmStartData) {
    console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
    this.startData = rtmStartData;
  }
}

/*
const workerPool = new WorkerPool(config);
workerPool.fork();
*/
const bot = new DeployBot(rtm, config);
if (config.web) {
  const httpServer = child_process.fork(path.resolve(__dirname + '/../src/WebService'), []);
}

console.log("===> Starting RTM ...");
rtm.start();
