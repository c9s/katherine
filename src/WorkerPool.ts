
const _ = require('underscore');

import path = require("path");

import child_process = require('child_process');
import {EventEmitter} from 'events';
const Redis = require("redis");

import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "./channels";

export class WorkerPool extends EventEmitter {

  protected redis;

  protected poolConfig : Object;

  protected workerProcesses : Object;

  constructor(config) {
    super();
    this.redis = Redis.createClient(config.redis);
    this.poolConfig = config.pool;
    this.workerProcesses = {};
  }

  public fork() {
    for (let poolName in this.poolConfig) {
      const poolDirectory = this.poolConfig[poolName];
      const worker = child_process.fork(path.resolve(__dirname + '/../bin/worker'), [poolName, poolDirectory]);
      this.workerProcesses[poolName] = worker;
    }
  }

  public findIdleWorker() : Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.redis.hgetall("workers", (err, obj) => {
        console.log(err, obj);
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
