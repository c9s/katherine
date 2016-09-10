const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const _ = require('underscore');

import {RedisClient} from "redis";
import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployRequest} from "./DeployRequest";
import {Worker} from "./Worker";
import {Request} from "./Request";

import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "./channels";

import {createAttachmentsFromStdout, createAttachmentsFromSummaryMap} from "./SlackUtils";

class BaseProcess {

  protected worker : Worker;

  protected currentRequest : Request;

  protected pub : RedisClient;

  constructor(worker, pub : RedisClient, currentRequest : Request) {
    this.worker = worker;
    this.pub = pub;
    this.currentRequest = currentRequest;
  }

}

class DeployProcess extends BaseProcess {

  protected worker : DeployWorker;

  protected currentRequest : DeployRequest;

  constructor(worker : DeployWorker, pub : RedisClient, currentRequest : DeployRequest) {
    super(worker, pub, currentRequest);
  }

  protected log(title : string, output) {
    console.log(`===> #${this.worker.name}:${title}`);
    console.log(output);
  }

  protected debug(message) {
    if (this.currentRequest && (this.currentRequest.debug || this.currentRequest.verbose)) {
      this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
  }

  protected progress(message) {
    if (this.currentRequest && !this.currentRequest.silent) {
      this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
  }

  protected complete(message) {
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
  }

  protected error(err) {
    let message = err;
    if (err instanceof Error) {
      message = err.message;
    }
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'error', 'message': message, 'currentRequest': this.currentRequest }));
  }

  public start() {
    const worker = this.worker;
    const request = this.currentRequest;
    const self = this;

    this.progress(`OK, checking out branch ${request.branch} ...`);

    const deleteLocalBranch = (branch) => {
      if (branch === "master") {
        return Promise.resolve();
      }
      return worker.repo.deleteBranch(branch, { "force": true }).then( ({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout(`Removed local branch ${branch}`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const checkout = (branch) => {
      return worker.repo.checkout(branch).then( ({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout(`Checking out branch ${request.branch}.`, stdout));
        if (error) {
          this.error(error);
        }
        return Promise.resolve();
      });
    }

    const fetch = (remote) => {
      this.progress(`Fetching tags...`);
      return worker.repo.fetch(remote, { tags: true });
    }

    const pull = (remote) => {
      this.progress(`Going to pull down the changes for branch ${request.branch}...`);
      return worker.repo.pull(remote).then(({ error, stdout, stderr }) => {
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        this.debug(createAttachmentsFromStdout(`OK, the branch ${request.branch} is now updated.`, stdout));
        return Promise.resolve();
      });
    }

    const cleanForce = () => {
      this.progress(`Removing untracked files...`);
      return worker.repo.clean({ 'force': true, 'removeUntrackedDirectory': true }).then(({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout("Repository is now cleaned.", stdout));
        console.log(stderr);
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    }

    const resetHard = () => {
      this.progress(`Resetting changes...`);
      return worker.repo.reset({ 'hard': true }).then(({ error, stdout, stderr }) => {
        this.debug(createAttachmentsFromStdout("Changes have been reset.", stdout));
        if (error) {
          self.error(error);
          return;
        }
        return Promise.resolve();
      });
    };

    const submoduleUpdate = () => {
      this.progress(`Updating submodules...`);
      return worker.repo.submoduleUpdate({ 'init': true, 'recursive': true, 'force': true }).then(({ error, stdout, stderr }) => {
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
    return resetHard()
      .then(() => cleanForce())
      .then(() => fetch('origin'))
      .then(() => checkout('master'))
      .then(() => deleteLocalBranch(request.branch))
      .then(() => checkout(request.branch))
      .then(() => pull('origin'))
      .then(() => submoduleUpdate())
      .then(() => {
        let action = new DeployAction(worker.deployConfig);
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

        deployment = Deployment.create(worker.deployConfig, uuid.v4());
        this.progress(`Started building ${request.appName} on branch ${request.branch}`);
        return action.run(deployment, request.sites, {
          dryrun: false,
          clean: true
        } as any).then((mapResult : SummaryMap) => {
          this.complete(createAttachmentsFromSummaryMap(request, deployment, mapResult));
          return Promise.resolve(mapResult);
        });
      })
  }
}


/**
 * Right now we only implemented 2 commands:
 *
 * 1. config (update deploy config)
 * 2. deploy (deploy request)
 */
export class DeployWorker extends Worker {

  public start() {
    this.reportConnected();
  }

  protected log(title : string, output) {
    console.log(`===> #${this.name}:${title}`);
    console.log(output);
  }

  public handleMessage(channel : string, message) {
    console.log('handleMessage', channel, message);
    const payload = JSON.parse(message);
    if (channel === this.name) {
      switch (payload.type) {
        case 'config':
          this.setConfig(payload.config);
          this.reportReady();
          break;
        case 'deploy':
          this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'start', 'name' : this.name }));
          this.jobQueue = this.jobQueue.then(() => {
            return this.deploy(payload.request);
          });
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
    if (this.currentRequest && (this.currentRequest.debug || this.currentRequest.verbose)) {
      this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
  }

  protected progress(message) {
    if (this.currentRequest && !this.currentRequest.silent) {
      this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
    }
  }

  protected complete(message) {
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'progress', 'message': message, 'currentRequest': this.currentRequest }));
  }

  protected error(err) {
    let message = err;
    if (err instanceof Error) {
      message = err.message;
    }
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'error', 'message': message, 'currentRequest': this.currentRequest }));
  }

  protected reportConnected() {
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'connect', 'name' : this.name }));
  }

  protected reportReady() {
    this.pub.hset(WORKER_STATUS, this.name, "ready");
    this.pub.publish(MASTER_CHANNEL, JSON.stringify({ 'type': 'ready', 'name' : this.name, 'currentRequest': this.currentRequest }));
  }

  protected reportBusy() {
    this.pub.hset(WORKER_STATUS, this.name, "busy");
  }

  protected setConfig(config) {
    this.config = config;
    let deployConfig = <Config>_.extend({}, this.config.deploy);
    deployConfig.app.directory = path.resolve(path.join(this.directory, deployConfig.app.directory));
    this.deployConfig = ConfigParser.preprocess(deployConfig);
    // console.log("Generated deployConfig", JSON.stringify(this.deployConfig, null, "  "));
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
      return;
    }

    this.currentRequest = request;
    this.reportBusy();
    console.log(`#${this.name}: received deploy`, request);

    const proc = new DeployProcess(this, this.pub, request);
    return proc.start()
      .then((mapResult : SummaryMap) => {
        this.reportReady();
        return Promise.resolve(mapResult);
      })
      .catch((err) => {
        console.error(err);
        this.error(err);
        this.reportReady();
      });
  }
}