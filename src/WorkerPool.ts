
var _ = require('underscore');
import child_process = require('child_process');
import {EventEmitter} from 'events';

export class WorkerPool extends EventEmitter {

  protected poolConfig : Object;

  protected workers : Object;

  protected availability : Object;

  constructor(poolConfig) {
    super();
    this.poolConfig = poolConfig;
    this.availability = {};
    this.workers = {};
    this.fork();
  }

  public onMessage(message) {
    if (message['type'] === "finished") {
      this.freeWorker(message['name']);
    }
    this.emit(message['type'] , message);
  }

  /**
   * publish message to all workers.
   */
  public publish(message) {
    _.each(this.workers, (worker) => {
      worker.send(message);
    });
  }

  public fork() {
    for (let poolName in this.poolConfig) {
      let poolDirectory = this.poolConfig[poolName];
      let worker = child_process.fork(__dirname + '/../src/Worker', [poolName, poolDirectory]);
      worker.on('message', this.onMessage.bind(this));
      this.workers[poolName] = worker;
    }
  }

  public getWorker() {
    for (let poolName in this.workers) {
      let used = this.availability[poolName];
      if (!used) {
        this.availability[poolName] = true;
        let worker = this.workers[poolName];
        return worker;
      }
    }
  }

  public freeWorker(name : number) {
    this.availability[name] = false;
  }
}
