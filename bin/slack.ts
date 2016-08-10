/// <reference path="../node_modules/typeloy/lib/src/index.d.ts" />

var slack = require('@slack/client');
var _ = require('underscore');
import child_process = require('child_process');
import {DeployAction, GitSync, GitRepo} from "typeloy";
import {DeployStatement} from "../src/DeployStatement";
import {DeployTask} from "../src/DeployTask";
import {WorkerPool} from "../src/WorkerPool";

/*
const RedisSMQ = require("rsmq");
const rsmq = new RedisSMQ( {host: "127.0.0.1", port: 6379, ns: "rsmq"} );
*/

const fs = require('fs');

const MemoryDataStore = slack.MemoryDataStore;
const RtmClient = slack.RtmClient;
const token = process.env.SLACK_API_TOKEN || '';
const rtm = new RtmClient(token, {
  // logLevel: 'debug',
  dataStore: new MemoryDataStore(),
});

const CLIENT_EVENTS = slack.CLIENT_EVENTS;
const RTM_EVENTS = slack.RTM_EVENTS;
const RTM_CLIENT_EVENTS = slack.CLIENT_EVENTS.RTM;

class DeployBot {

  protected rtm;

  protected startData;

  protected workerPool : WorkerPool;

  constructor(rtm, config) {
    this.rtm = rtm;
    this.rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, this.handleStartData.bind(this));
    this.rtm.on(RTM_EVENTS.MESSAGE, this.handleMessage.bind(this));
    this.rtm.on(RTM_EVENTS.CHANNEL_JOINED, this.handleChannelJoined.bind(this));

    // you need to wait for the client to fully connect before you can send messages
    this.rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, function () {});

    this.workerPool = new WorkerPool(config.pool);
    this.workerPool.addListener('finished', this.handleWorkerTaskFinished.bind(this));
    this.workerPool.addListener('progress', this.handleWorkerProgress.bind(this));
    this.workerPool.addListener('error', this.handleWorkerError.bind(this));
    this.workerPool.publish({ "type": "config", "config": config });
  }

  handleWorkerError(e) {
    if (e.currentTask.fromMessage && e.currentTask.fromMessage.channel) {
      this.rtm.sendMessage(e.message, e.currentTask.fromMessage.channel);
      this.rtm.sendMessage("```\n" + JSON.stringify(e.error, null, "  ") + "\n```", e.currentTask.fromMessage.channel);
    }
  }

  handleWorkerProgress(e) {
    if (e.currentTask.fromMessage && e.currentTask.fromMessage.channel) {
      this.rtm.sendMessage(e.message, e.currentTask.fromMessage.channel);
    }
  }

  handleWorkerTaskFinished(e) {
    this.workerPool.freeWorker(e.name);
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

    function replyFormat(userId, message) {
      return `<@${userId}>: ${message}`;
    }

    if (objectId == this.startData.self.id) {
      let sentence = message.text.replace(parseMentionUserId, '');

      let s = new DeployStatement;
      let task : DeployTask = s.parse(sentence);
      task.fromMessage = message;

      // debug the task structure
      // this.rtm.sendMessage(JSON.stringify(task, null, "  "), message.channel);

      this.rtm.sendMessage('Finding available workers from worker pool...', message.channel);
      let worker = this.workerPool.getWorker();
      if (worker) {
        worker.send({ 'type': 'deploy', 'task' : task });
      } else {
        this.rtm.sendMessage( replyFormat(message.user, 'Sorry, all the workers are busy...'), message.channel);
      }
    }

    /*
    { type: 'message',
      channel: 'C0DG1BP5F',
      user: 'U1SV0V03B',
      text: '<@U1Z4ZGPC2>: test',
      text: '<@U1Z4ZGPC2>: shaka from master branch to staging server.',
      ts: '1470650550.000004',
      team: 'T0BR6PCRY' } }
    */
    /*
    // This will send the message 'this is a test message' to the channel identified by id 'C0CHZA86Q'
    rtm.sendMessage('This is a test message', 'C0CHZA86Q', function messageSent() {
      // optionally, you can supply a callback to execute once the message has been sent
    });
    */
  }

  handleChannelJoined(message) {
    console.log("CHANNEL_JOINED", message);
    // rtm.sendMessage('This is a test message', 'C0CHZA86Q');
  }

  handleStartData(rtmStartData) {
    console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
    this.startData = rtmStartData;
    /*
    self: { id: 'U1Z4ZGPC2',
          name: 'mr.deploy',
          prefs: [Object],
          created: 1470642759,
          manual_presence: 'active' },
    */
  }
}


function prepareWorkingRepositoryPool(config) {
  if (!config.source) {
    throw new Error('config.source is undefined.');
  }
  var repo = config.source.repository;

  for (let poolName in config.pool) {
    let poolDirectory = config.pool[poolName];

    if (fs.existsSync(poolDirectory)) {
      console.log(`Repository ${poolDirectory} exists.`);
      continue;
    }


    console.log(`Cloning ${poolName} => ${poolDirectory} ...`);
    let output = child_process.execSync(`git clone ${repo} ${poolDirectory}`);
    console.log(output);
  }
}


var config = JSON.parse(fs.readFileSync('delivery.json'));
console.log('===> preparing workingRepository pool');
prepareWorkingRepositoryPool(config);

console.log("===> forking deploy workers");
var bot = new DeployBot(rtm, config);
rtm.start();
