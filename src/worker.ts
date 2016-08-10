
import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap} from "typeloy";
import {DeployTask} from "./DeployTask";
var _ = require('underscore');

var path = require('path');

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


    process.on("message", this.handleMessage.bind(this));
    process.on("disconnect", this.handleDisconnect.bind(this));
  }

  public handleDisconnect() {
    console.log("disconnected");
  }

  public handleMessage(message) {
    switch (message.type) {
      case 'config':
        this.setConfig(message);
        break;

      case 'deploy':
        this.deploy(message.task);
        break;
      default:
        this.error("unknown command");
        break;
    }
  }

  protected progress(message) {
    process.send({ 'type': 'progress', 'message': message, 'currentTask': this.currentTask });
  }

  protected error(err) {
    let message = err;
    if (err instanceof Error) {
      message = err.message;
    }
    process.send({ 'type': 'error', 'message': message, 'error': err, 'currentTask': this.currentTask });
  }

  protected setFinished() {
    console.log("===> task finished..");
    process.send({ 'type': 'finished', 'name': this.name, 'currentTask': this.currentTask });
  }

  protected setConfig(message) {
    console.log('config:', message.config);
    this.config = message.config;
  }

  protected deploy(task : DeployTask) {
    const self = this;
    if (!this.config) {
      process.send({ 'type': 'errored', 'message': 'config is not set.' });
      return;
    }
    this.currentTask = task;

    console.log(`#${this.name}: received deploy`, task);

    this.progress(`I am checking out branch ${task.branch} ...`);

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
      this.progress(`I am going to pull down the changes for branch ${task.branch}...`);
      return this.repo.pull(remote).then( ({ error, stdout, stderr }) => {
        this.progress(stdout);
        console.log(stderr);
        if (error) {
          self.error(error);
          this.setFinished();
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
          this.setFinished();
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
          this.setFinished();
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
          this.setFinished();
          return;
        }
        return Promise.resolve();
      });
    }

    resetHard()
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
        let action = new DeployAction(deployConfig, this.directory);
        let deployment = Deployment.create(deployConfig, this.directory);
        return action.run(deployment, task.sites);
      })
      .then((mapResult : Array<SummaryMap>) => {
        console.log("After deploy", mapResult);
        this.progress(JSON.stringify(mapResult, null, "  "));
        this.progress("Deployed.");
        // var errorCode = haveSummaryMapsErrors(mapResult) ? 1 : 0;
        this.setFinished();
      })
      .catch((err) => {
        console.error(err);
        this.error(err);
        this.setFinished();
      });
  }
}
console.log("===> Starting worker: ", process.argv[2], process.argv[3]);
let worker = new DeployWorker(process.argv[2], process.argv[3]);
