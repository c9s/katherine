
import {DeployAction, GitSync, GitCommands} from "typeloy";

class DeployWorker {

  protected name : string;

  protected directory : string;

  protected config : any;

  constructor(name : string, directory : string) {
    this.name = name;
    this.directory = directory;

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
        this.deploy(message);
        break;
      default:
        this.error("unknown command");
        break;
    }
  }

  protected error(message) {
    process.send({ 'type': 'error', 'message': message });
  }

  protected setConfig(message) {
    console.log('config:', message.config);
    this.config = message.config;
  }

  protected deploy(message) {
    if (!this.config) {
      process.send({ 'type': 'errored', 'message': 'config is not set.' });
      return;
    }
    console.log('deploy', message);
    setTimeout(() => {
      this.setFinished();
    }, 5000);
  }

  protected setFinished() {
    process.send({ 'type': 'finished', 'name': this.name });
  }
}

console.log(process.argv);
let worker = new DeployWorker(process.argv[1], process.argv[2]);
