
var _ = require('underscore');
import child_process = require('child_process');
import {EventEmitter} from 'events';

export class WorkerPool extends EventEmitter {

  protected redis;

  protected poolConfig : Object;

  protected workers : Object;

  constructor(sub, poolConfig) {
    super();
    this.redis = sub;
    this.poolConfig = poolConfig;
    this.workers = {};
    this.redis.on('subscribe', (channel, message) => {
      let payload = JSON.parse(message);
      switch (payload) {
        case "connect":
          this.workers[payload.name] = true;
          break;
      }
    });
  }

  public fork() {
    for (let poolName in this.poolConfig) {
      let poolDirectory = this.poolConfig[poolName];
      let worker = child_process.fork(__dirname + '/../src/Worker', [poolName, poolDirectory]);
      this.workers[poolName] = worker;
    }
  }

  public findIdleWorker() : Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.redis.hgetall("workers", (err, obj) => {
        for (let key in obj) {
          if (obj[key] == "ready") {
            return resolve(key);
          }
        }
        reject();
      });
    });
  }
}
