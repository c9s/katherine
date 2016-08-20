const Redis = require("redis");

import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployTask} from "./DeployTask";

const _ = require('underscore');

const path = require('path');

const sub = Redis.createClient();
const pub = Redis.createClient();

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";


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
        this.progress(createAttachmentsFromStdout(`Removed local branch ${branch}`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const checkout = (branch) => {
      return this.repo.checkout(branch).then( ({ error, stdout, stderr }) => {
        this.progress(createAttachmentsFromStdout(`Checking out branch ${task.branch}.`, stdout));
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
      this.progress(`Going to pull down the changes for branch ${task.branch}...`);
      return this.repo.pull(remote).then( ({ error, stdout, stderr }) => {
        console.log(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        this.progress(createAttachmentsFromStdout(`OK, the branch ${task.branch} is now updated.`, stdout));
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
              "text": "Succeed " + taskId,
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
        try {
          return action.run(deployment, task.sites, { clean: false, dryrun: false } as any);
        } catch (err) {
          this.error(err);
          return Promise.reject(err);
        }
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
