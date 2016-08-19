/// <reference path="../node_modules/typeloy/lib/src/index.d.ts" />

const slack = require('@slack/client');
const _ = require('underscore');
import child_process = require('child_process');
import {DeployAction, GitSync, GitRepo} from "typeloy";
import {DeployStatement} from "../src/DeployStatement";
import {DeployTask} from "../src/DeployTask";
import {WorkerPool} from "../src/WorkerPool";

const fs = require('fs');

const MemoryDataStore = slack.MemoryDataStore;
const RtmClient = slack.RtmClient;
const token = process.env.SLACK_API_TOKEN || '';
const rtm = new RtmClient(token, {
  // logLevel: 'debug',
  dataStore: new MemoryDataStore(),
});

const slackWeb = new slack.WebClient(token);

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";

const Redis = require("redis");
const sub = Redis.createClient();
const pub = Redis.createClient();

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

function formatReply(userId, message) : string {
  return `<@${userId}>: ${message}`;
}


class DeployBot {

  protected rtm;

  protected startData;

  protected workerPool : WorkerPool;

  protected config;

  constructor(rtm, config) {
    this.rtm = rtm;
    this.config = config;
    this.rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, this.handleStartData.bind(this));
    this.rtm.on(RTM_EVENTS.MESSAGE, this.handleMessage.bind(this));
    this.rtm.on(RTM_EVENTS.CHANNEL_JOINED, this.handleChannelJoined.bind(this));

    // you need to wait for the client to fully connect before you can send messages
    this.rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, function () {});

    this.workerPool = new WorkerPool(sub, config.pool);

    sub.on("message", this.handleMasterMessage.bind(this));
    sub.on("subscribe", (channel, count) => {
      console.log("redis.subscribe", channel, count);
    });
    sub.subscribe(MASTER_CHANNEL);

    this.workerPool.start();
  }

  handleMasterMessage(channel : string, message : string) {
    let payload = JSON.parse(message);
    console.log('handleMasterMessage', channel, JSON.stringify(payload.message, null, "  "));
    switch (payload.type) {
      case "connect":
        // this.rtm.sendMessage(`worker ${payload.name} connected.`, payload.currentTask.fromMessage.channel);
        pub.publish(payload.name, JSON.stringify({ 'type': 'config', 'config': this.config }));
        break;
      case "idle":
        this.workerPool.free(payload.name);
        this.rtm.sendMessage(`${payload.name} is now idle.`, payload.currentTask.fromMessage.channel);
        break;
      case "error":
      case "debug":
        if (payload.currentTask && payload.currentTask.fromMessage && payload.currentTask.fromMessage.channel) {
          this.rtm.sendMessage(formatPlainText(payload.message), payload.currentTask.fromMessage.channel);
        }
      case "progress":
        if (payload.currentTask && payload.currentTask.fromMessage && payload.currentTask.fromMessage.channel) {
          if (typeof payload.message === "object") {
            let msg = _.extend(payload.message, {
              'channel': payload.currentTask.fromMessage.channel,
              "asuser": true
            });
            slackWeb.chat.postMessage(payload.currentTask.fromMessage.channel, "", _.extend(payload.message, {
              "as_user": true
            }));
          } else {
            this.rtm.sendMessage(payload.message, payload.currentTask.fromMessage.channel);
          }
        }
        break;
    }
  }

  handleMessage(message) {
    let user = this.rtm.dataStore.getUserById(message.user);
    let channel = this.rtm.dataStore.getChannelGroupOrDMById(message.channel);
    console.log(
      'User %s posted a message in %s channel',
      user.name,
      channel.name
    );

    const parseDeployStatement = new RegExp('');
    const parseMentionUserId = new RegExp('^<@(\\w+)>:\\s*');
    const matches = message.text.match(parseMentionUserId);

    if (!matches) {
      return;
    }
    console.log("Request matches ID: ", matches);
    const objectId = matches[1];


    if (objectId == this.startData.self.id) {
      let sentence = message.text.replace(parseMentionUserId, '');
      let s = new DeployStatement;
      let task : DeployTask = s.parse(sentence);
      task.fromMessage = message;
      let worker = this.workerPool.getWorker();
      if (worker) {
        pub.publish(worker, JSON.stringify({ 'type': 'deploy', 'task' : task }));
      } else {
        this.rtm.sendMessage(formatReply(message.user, 'Sorry, all the workers are busy...'), message.channel);
      }
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


function prepareWorkingRepositoryPool(config) {
  if (!config.source) {
    throw new Error('config.source is undefined.');
  }
  const repo = config.source.repository;
  for (const poolName in config.pool) {
    const poolDirectory = config.pool[poolName];
    if (!fs.existsSync(poolDirectory)) {
      console.log(`Cloning ${poolName} => ${poolDirectory} ...`);
      child_process.execSync(`git clone ${repo} ${poolDirectory}`, { stdio: [0,1,2], encoding: 'utf8' } );
    }
  }
}


const config = JSON.parse(fs.readFileSync('delivery.json'));
console.log('===> preparing workingRepository pool');
prepareWorkingRepositoryPool(config);

if (fs.existsSync('typeloy.json')) {
  const typeloyConfig = JSON.parse(fs.readFileSync('typeloy.json'));
  config.deploy = typeloyConfig;
}

console.log("===> forking deploy workers");
var bot = new DeployBot(rtm, config);
rtm.start();
