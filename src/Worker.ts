const Redis = require("redis");

import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployTask} from "./DeployTask";

const _ = require('underscore');

const path = require('path');

const sub = Redis.createClient();
const pub = Redis.createClient();

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";


function createAttachmentsFromSummaryMap(summaryMap : SummaryMap) {
  let attachments = [];
  _.each(summaryMap, (summaryMapResult : SummaryMapResult, host : string) => {
    let err = summaryMapResult.error;
    let color = err ? "red" : "#36a64f";
    let message = null;

    if (err) {
      let failedItems = _.filter(summaryMapResult.history, (historyItem: SummaryMapHistory) => historyItem.error);
      _.each(failedItems, (failedItem : SummaryMapHistory) => {
        attachments.push({
          "pretext": `I failed to deploy on host ${host}.`,
          "fallback": `I failed to deploy on host ${host}.`,
          "text": "```\n" + failedItem.error + "\n```",
          "color": "red",
          "mrkdwn_in": ["text", "pretext"]
        });
      });
    } else {
      attachments.push({
        "text": `I succeed to deploy on host ${host}`,
        "fallback": `I failed to deploy on host ${host}.`,
        "color": color,
        "mrkdwn_in": ["text", "pretext"]
      });
    }
  });
  return attachments;
}

/**
 * Right now we only implemented 2 commands:
 *
 * 1. config (update deploy config)
 * 2. deploy (deploy task)
 */
class DeployWorker {

  protected name : string;

  protected directory : string;

  protected repo : GitRepo;

  protected config : any;

  protected currentTask : DeployTask;

  constructor(name : string, directory : string) {
    this.name = name;
    this.directory = directory;
    this.repo = new GitRepo(directory);
    sub.on("message", this.handleMessage.bind(this));
    sub.subscribe(BROADCAST_CHANNEL);
    sub.subscribe(this.name);
  }

  public start() {
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'connect', 'name' : this.name }));
  }

  public handleMessage(channel, message) {
    console.log('handleMessage', channel, message);
    const payload = JSON.parse(message);
    if (channel === this.name) {
      switch (payload.type) {
        case 'config':
          this.setConfig(payload.config);
          break;
        case 'deploy':
          pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'start', 'name' : this.name }));
          this.deploy(payload.task);
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
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentTask': this.currentTask }));
  }


  protected error(err) {
    let message = err;
    if (err instanceof Error) {
      message = err.message;
    }
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'error', 'message': message, 'currentTask': this.currentTask }));
  }

  protected reportIdle() {
    pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'idle', 'name' : this.name, 'currentTask': this.currentTask }));
  }

  protected setConfig(config) {
    this.config = config;
  }

  protected deploy(task : DeployTask) {
    const self = this;
    if (!this.config) {
      console.log("config is empty");
      // process.send({ 'type': 'errored', 'message': 'config is not set.' });
      return;
    }
    this.currentTask = task;

    console.log(`#${this.name}: received deploy`, task);

    this.progress(`OK, checking out branch ${task.branch} ...`);

    const deleteLocalBranch = (branch) => {
      if (branch === "master") {
        return Promise.resolve();
      }
      return this.repo.deleteBranch(branch, { "force": true }).then( ({ error, stdout, stderr }) => {
        this.progress(stdout);
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const checkout = (branch) => {
      return this.repo.checkout(branch).then( ({ error, stdout, stderr }) => {
        this.progress(stdout);
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const pull = (remote) => {
      this.progress(`Going to pull down the changes for branch ${task.branch}...`);
      return this.repo.pull(remote).then( ({ error, stdout, stderr }) => {
        this.progress(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        this.progress(`OK, the branch ${task.branch} is now updated.`);
        return Promise.resolve();
      });
    }

    /*
    const cleanForce = () => {
      this.progress(`Force clean...`);
      return this.repo.clean({ 'force': true, 'removeUntrackedDirectory': true }).then(({ error, stdout, stderr }) => {
        this.progress(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    }
    */

    const resetHard = () => {
      this.progress(`Resetting changes...`);
      return this.repo.reset({ 'hard': true }).then(({ error, stdout, stderr }) => {
        this.progress(stdout);
        console.log(stderr);
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
        this.progress(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    }

    resetHard()
      .then(() => checkout('master'))
      .then(() => deleteLocalBranch(task.branch))
      .then(() => checkout(task.branch))
      .then(() => pull('origin'))
      .then(() => submoduleUpdate())
      .then(() => {
        this.progress(`Preparing config for depolyment...`);
        let deployConfig = <Config>_.extend({}, this.config.deploy);
        deployConfig.app.directory = path.resolve(path.join(this.directory, deployConfig.app.directory));
        deployConfig = ConfigParser.preprocess(deployConfig);
        console.log("deployConfig", deployConfig);

        this.progress(`Started building ${task.appName} on branch ${task.branch}`);
        let action = new DeployAction(deployConfig);

        action.on('task.started', (taskId) => {
          console.log('task.started', taskId);
          this.progress({
            "attachments": [{
              "text": "Started " + taskId,
              "color": "#ccc",
              "mrkdwn_in": ["text", "pretext"]
            }]
          });
        });
        action.on('task.success', (taskId) => {
          console.log('task.success', taskId);
          this.progress({
            "attachments": [{
              "text": taskId,
              "color": "#36a64f",
              "mrkdwn_in": ["text", "pretext"]
            }]
          });
        });
        action.on('task.failed', (taskId) => {
          console.log('task.failed', taskId);
          this.progress(':joy: ' + taskId);
        });

        let deployment = Deployment.create(deployConfig);
        return action.run(deployment, task.sites, { clean: false, dryrun: false } as any);
      })
      .then((mapResult : SummaryMap) => {
        // let errorCode = hasSummaryMapErrors(mapResult) ? 1 : 0;
        // this.progress(JSON.stringify(mapResult, null, "  "));
        this.progress(createAttachmentsFromSummaryMap(mapResult));
        this.reportIdle();
      })
      .catch((err) => {
        console.error(err);
        this.error(err);
        this.reportIdle();
      });
  }
}
console.log("===> Starting worker: ", process.argv[2], process.argv[3]);
const worker = new DeployWorker(process.argv[2], process.argv[3]);
worker.start();
