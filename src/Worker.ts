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

function createAttachmentsFromSummaryMap(request, deployment, summaryMap : SummaryMap) {

  let fields = [];

  if (deployment.tag) {
    fields.push({ 
      'title': 'Source',
      'value': deployment.tag,
      'short': true
    })
  }

  if (deployment.revInfo && deployment.revInfo.commits.length > 0) {
    fields.push({ 
      'title': 'Commit',
      'value': deployment.revInfo.commits[0].hash,
      'short': true
    })
    fields.push({ 
      'title': 'Author',
      'value': deployment.revInfo.commits[0].author.name,
      'short': true
    })
    fields.push({ 
      'title': 'Committed At',
      'value': deployment.revInfo.commits[0].committedAt,
      'short': true
    })
  }

  if (request.sites) {
    fields.push({ 
      'title': 'Sites',
      'value': request.sites.join(', '),
      'short': true
    })
  }
  if (request.branch) {
    fields.push({ 
      'title': 'Branch',
      'value': request.branch,
      'short': true
    })
  }

  if (request.fromMessage && request.fromMessage.user) {
    fields.push({ 
      'title': 'By User',
      'value': `<@${request.fromMessage.user}>`,
      'short': true
    })
  }

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
          "fields": fields,
          "mrkdwn_in": ["text", "pretext", "fields"]
        });
      });
    } else {
      attachments.push({
        "text": `The deployment on host ${host} has been successfully performed.`,
        "fallback": `The deployment on host ${host} has been successfully performed.`,
        "color": "#36a64f",
        "fields": fields,
        "mrkdwn_in": ["text", "pretext", "fields"]
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

  protected debug(message) {
    if (this.currentRequest && this.currentRequest.debug) {
      pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
  }

  protected progress(message) {
    if (this.currentRequest && !this.currentRequest.silent) {
      pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
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
        this.debug(createAttachmentsFromStdout(`Removed local branch ${branch}`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const checkout = (branch) => {
      return this.repo.checkout(branch).then( ({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout(`Checking out branch ${request.branch}.`, stdout));
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
        this.debug(createAttachmentsFromStdout(`OK, the branch ${request.branch} is now updated.`, stdout));
        return Promise.resolve();
      });
    }

    const resetHard = () => {
      this.progress(`Resetting changes...`);
      return this.repo.reset({ 'hard': true }).then(({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout("Repository is now cleaned.", stdout));
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
        this.debug(createAttachmentsFromStdout("Submodule updated.", stdout));
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    }

    let deployment = null;
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

        deployment = Deployment.create(this.deployConfig);
        try {
          this.progress(`Started building ${request.appName} on branch ${request.branch}`);
          return action.run(deployment, request.sites, { dryrun: false, clean: false } as any);
        } catch (err) {
          this.error(err);
          return Promise.reject(err);
        }
      })
      .then((mapResult : SummaryMap) => {
        this.progress(createAttachmentsFromSummaryMap(request, deployment, mapResult));
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
