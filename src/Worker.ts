const Redis = require("redis");

import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployRequest} from "./DeployRequest";

const _ = require('underscore');

const path = require('path');

const sub = Redis.createClient();
const pub = Redis.createClient();

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";

const STATUS_HASH = "worker-status";

function createAttachmentsFromStdout(title : string, stdout : string) {
  return {
    'attachments': [{
      "pretext": title,
      "fallback": title,
      "text": "```\n" + stdout.trim() + "\n```",
      "color": "#aaa",
      "mrkdwn_in": ["text", "pretext"]
    }]
  };
}

function createAttachmentsFromSummaryMap(summaryMap : SummaryMap) {
  let attachments = [];
  _.each(summaryMap, (summaryMapResult : SummaryMapResult, host : string) => {
    let err = summaryMapResult.error;
    let message = null;

    if (err) {
      let failedItems = _.filter(summaryMapResult.history, (historyItem: SummaryMapHistory) => historyItem.error);
      _.each(failedItems, (failedItem : SummaryMapHistory) => {
        attachments.push({
          "pretext": `The deployment on host ${host} has failed.`,
          "fallback": `The deployment on host ${host} has failed.`,
          "text": "```\n" + failedItem.error.trim() + "\n```",
          "color": "red",
          "mrkdwn_in": ["text", "pretext"]
        });
      });
    } else {
      attachments.push({
        "text": `The deployment on host ${host} has been successfully performed.`,
        "fallback": `The deployment on host ${host} has been successfully performed.`,
        "color": "#36a64f",
        "mrkdwn_in": ["text", "pretext"]
      });
    }
  });
  return { 'attachments': attachments };
}

/**
 * Right now we only implemented 2 commands:
 *
 * 1. config (update deploy config)
 * 2. deploy (deploy request)
 */
class DeployWorker {

  protected name : string;

  protected directory : string;

  protected repo : GitRepo;

  protected config : any;

  protected deployConfig : any;

  protected currentRequest : DeployRequest;

  constructor(name : string, directory : string) {
    this.name = name;
    this.directory = directory;
    this.repo = new GitRepo(directory);
    sub.on("message", this.handleMessage.bind(this));
    sub.subscribe(BROADCAST_CHANNEL);
    sub.subscribe(this.name);
  }

  public start() {
    this.reportConnected();
  }

  public handleMessage(channel, message) {
    console.log('handleMessage', channel, message);
    const payload = JSON.parse(message);
    if (channel === this.name) {
      switch (payload.type) {
        case 'config':
          this.setConfig(payload.config);
          this.reportReady();
          break;
        case 'deploy':
          pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'start', 'name' : this.name }));
          this.deploy(payload.request);
          break;
      }
    } else if (channel === BROADCAST_CHANNEL) {
      switch (payload.type) {
        case 'config':
          this.setConfig(payload.config);
          break;
        default:
          this.error("unknown command");
          break;
      }
    }
  }

  protected progress(message) {
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
  }


  protected error(err) {
    let message = err;
    if (err instanceof Error) {
      message = err.message;
    }
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'error', 'message': message, 'currentRequest': this.currentRequest }));
  }

  protected reportConnected() {
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'connect', 'name' : this.name }));
  }

  protected reportReady() {
    pub.hset("workers", this.name, "ready");
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'ready', 'name' : this.name, 'currentRequest': this.currentRequest }));
  }

  protected reportBusy() {
    pub.hset("workers", this.name, "busy");
  }

  protected setConfig(config) {
    this.config = config;
    let deployConfig = <Config>_.extend({}, this.config.deploy);
    deployConfig.app.directory = path.resolve(path.join(this.directory, deployConfig.app.directory));
    this.deployConfig = ConfigParser.preprocess(deployConfig);
    console.log("Generated deployConfig", JSON.stringify(this.deployConfig, null, "  "));
  }

  protected deploy(request : DeployRequest) {
    const self = this;
    if (!this.config) {
      console.log("this.config is empty");
      // process.send({ 'type': 'errored', 'message': 'config is not set.' });
      return;
    }

    if (!this.deployConfig) {
      this.error("this.deployConfig is undefined.");
    }

    this.currentRequest = request;

    console.log(`#${this.name}: received deploy`, request);

    this.progress(`OK, checking out branch ${request.branch} ...`);

    const deleteLocalBranch = (branch) => {
      if (branch === "master") {
        return Promise.resolve();
      }
      return this.repo.deleteBranch(branch, { "force": true }).then( ({ error, stdout, stderr }) => {
        this.progress(createAttachmentsFromStdout(`Removed local branch ${branch}`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const checkout = (branch) => {
      return this.repo.checkout(branch).then( ({ error, stdout, stderr }) => {
        this.progress(createAttachmentsFromStdout(`Checking out branch ${request.branch}.`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const fetch = (remote) => {
      this.progress(`Fetching tags...`);
      return this.repo.fetch(remote, { tags: true });
    }

    const pull = (remote) => {
      this.progress(`Going to pull down the changes for branch ${request.branch}...`);
      return this.repo.pull(remote).then( ({ error, stdout, stderr }) => {
        console.log(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        this.progress(createAttachmentsFromStdout(`OK, the branch ${request.branch} is now updated.`, stdout));
        return Promise.resolve();
      });
    }

    const resetHard = () => {
      this.progress(`Resetting changes...`);
      return this.repo.reset({ 'hard': true }).then(({ error, stdout, stderr }) => {
        this.progress(createAttachmentsFromStdout("Repository is now cleaned.", stdout));
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    };

    const submoduleUpdate = () => {
      this.progress(`Updating submodules...`);
      return this.repo.submoduleUpdate({ 'init': true, 'recursive': true, 'force': true }).then(({ error, stdout, stderr }) => {
        this.progress(createAttachmentsFromStdout("Submodule updated.", stdout));
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    }

    resetHard()
      .then(() => fetch('origin'))
      .then(() => checkout('master'))
      .then(() => deleteLocalBranch(request.branch))
      .then(() => checkout(request.branch))
      .then(() => pull('origin'))
      .then(() => submoduleUpdate())
      .then(() => {

        let action = new DeployAction(this.deployConfig);

        action.on('task.started', (taskId) => {
          this.progress({
            "attachments": [{
              "text": `Started ${taskId}`,
              "fallback": `Started ${taskId}`,
              "color": "#ccc",
              "mrkdwn_in": ["text", "pretext"]
            }]
          });
        });
        action.on('task.success', (taskId) => {
          this.progress({
            "attachments": [{
              "fallback": `Succeed ${taskId}`,
              "text": `Succeed ${taskId}`,
              "color": "#36a64f",
              "mrkdwn_in": ["text", "pretext"]
            }]
          });
        });
        action.on('task.failed', (taskId) => {
          this.progress(':joy: ' + taskId);
        });

        let deployment = Deployment.create(this.deployConfig);
        try {
          this.progress(`Started building ${request.appName} on branch ${request.branch}`);
          return action.run(deployment, request.sites, { dryrun: false } as any);
        } catch (err) {
          this.error(err);
          return Promise.reject(err);
        }
      })
      .then((mapResult : SummaryMap) => {
        // let errorCode = hasSummaryMapErrors(mapResult) ? 1 : 0;
        // this.progress(JSON.stringify(mapResult, null, "  "));
        this.progress(createAttachmentsFromSummaryMap(mapResult));
        this.reportReady();
      })
      .catch((err) => {
        console.error(err);
        this.error(err);
        this.reportReady();
      });
  }
}
console.log("===> Starting worker: ", process.argv[2], process.argv[3]);
const worker = new DeployWorker(process.argv[2], process.argv[3]);
worker.start();
