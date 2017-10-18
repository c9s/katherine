
const _ = require('underscore');

import * as path from "path";
import {fork,ChildProcess} from 'child_process';
import {EventEmitter} from 'events';
const Redis = require("redis");

import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "./channels";

interface WorkerMap<T> {
    [key: string]: T;
}

export class WorkerPool extends EventEmitter {

  protected redis;

  protected poolConfig : Object;

  protected workerProcesses : WorkerMap<ChildProcess> = {};

  constructor(config) {
    super();
    this.redis = Redis.createClient(config.redis);
    this.poolConfig = config.pool;
  }

  public fork() {
    for (let poolName in this.poolConfig) {
      const poolDirectory = this.poolConfig[poolName];
      const worker : ChildProcess = fork(path.resolve(__dirname + '/../bin/worker'), [poolName, poolDirectory]);
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
