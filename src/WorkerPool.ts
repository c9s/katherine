
var _ = require('underscore');
import child_process = require('child_process');
import {EventEmitter} from 'events';

export class WorkerPool extends EventEmitter {

  protected redis;

  protected poolConfig : Object;

  protected workers : Object;

  protected availability : Object;

  constructor(sub, poolConfig) {
    super();
    this.redis = sub;
    this.poolConfig = poolConfig;
    this.availability = {};
    this.workers = {};

    this.redis.on('subscribe', (channel, message) => {
      console.log(channel, message);
      let payload = JSON.parse(message);
      switch (payload) {
        case "connect":
          this.workers[ payload.name ] = true;
          this.availability[ payload.name ] = true;
          break;
        case "start":
          this.availability[ payload.name ] = false;
          break;
        case "idle":
          this.availability[ payload.name ] = true;
          break;
      }
    });
  }

  public start() {
    for (let poolName in this.poolConfig) {
      let poolDirectory = this.poolConfig[poolName];
      let worker = child_process.fork(__dirname + '/../src/Worker', [poolName, poolDirectory]);
      this.workers[poolName] = worker;
      this.availability[poolName] = true;
    }
  }

  public getWorker() {
    for (let workerId in this.workers) {
      let available = this.availability[workerId];
      if (available) {
        this.availability[workerId] = false;
        return workerId;
      }
    }
  }
}
