/// <reference path="../node_modules/typeloy/lib/src/index.d.ts" />

var slack = require('@slack/client');
var _ = require('underscore');
import child_process = require('child_process');
import {DeployAction, GitSync, GitCommands} from "typeloy";
import {DeployStatement} from "../src/DeployStatement";

var fs = require('fs');

import {EventEmitter} from 'events';

class WorkerPool extends EventEmitter {

  protected poolConfig : Object;

  protected workers : Object;

  protected availability : Object;

  constructor(poolConfig) {
    super();
    this.poolConfig = poolConfig;
    this.availability = {};
    this.workers = {};
    this.fork();
  }

  public onMessage(message) {
    if (message['type'] === "finished") {
      this.freeWorker(message['name']);
    }
    this.emit(message['type'] , message);
  }

  /**
   * publish message to all workers.
   */
  public publish(message) {
    _.each(this.workers, (worker) => {
      worker.send(message);
    });
  }

  public fork() {
    for (let poolName in this.poolConfig) {
      let poolDirectory = this.poolConfig[poolName];
      let worker = child_process.fork(__dirname + '/../src/worker', [poolName, poolDirectory]);
      worker.on('message', this.onMessage.bind(this));
      this.workers[poolName] = worker;
    }
  }

  public getWorker() {
    for (let poolName in this.workers) {
      let used = this.availability[poolName];
      if (!used) {
        this.availability[poolName] = true;
        let worker = this.workers[poolName];
        return worker;
      }
    }
  }

  public freeWorker(name : number) {
    this.availability[name] = false;
  }
}


var MemoryDataStore = slack.MemoryDataStore;
var RtmClient = slack.RtmClient;
var token = process.env.SLACK_API_TOKEN || '';
var rtm = new RtmClient(token, {
  // logLevel: 'debug',
  dataStore: new MemoryDataStore(),
});

var CLIENT_EVENTS = slack.CLIENT_EVENTS;
var RTM_EVENTS = slack.RTM_EVENTS;
var RTM_CLIENT_EVENTS = slack.CLIENT_EVENTS.RTM;


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
    this.workerPool.addListener('finished', this.handleTaskFinished.bind(this));
    this.workerPool.publish({ "type": "config", "config": config });
  }

  handleTaskFinished(message) {
    console.log("handleTaskFinished", message);
    this.workerPool.freeWorker(message.name);
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
    if (matches) {
      console.log("matches ID: ", matches);
      const objectId = matches[1];
      if (objectId == this.startData.self.id) {
        let sentence = message.text.replace(parseMentionUserId, '');
        let s = new DeployStatement;
        let info = s.parse(sentence);

        let worker = this.workerPool.getWorker();
        if (worker) {
          this.rtm.sendMessage(`<@${message.user}>: ${JSON.stringify(info, null, "  ")}`, message.channel);
          worker.send({ 'type': 'deploy', 'deploy' : info });
        } else {
          this.rtm.sendMessage(`<@${message.user}>: sorry, all workers are busy.`, message.channel);
        }
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
  for (let poolName in config.pool) {
    let poolDirectory = config.pool[poolName];
    console.log(poolName , " => ", poolDirectory);
  }
}


var config = JSON.parse(fs.readFileSync('delivery.json'));
console.log('===> preparing workingRepository pool');
prepareWorkingRepositoryPool(config);

console.log("===> forking deploy workers");
var bot = new DeployBot(rtm, config);
rtm.start();
