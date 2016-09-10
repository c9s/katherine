const fs = require('fs');

import {RedisClient} from "redis";
import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "../src/channels";
import {DeployWorker} from "../src/DeployWorker";

const config = JSON.parse(fs.readFileSync('delivery.json'));
const sub = new RedisClient(config.redis);
const pub = new RedisClient(config.redis);
console.log("===> Starting worker: ", process.argv[2], process.argv[3]);
const worker = new DeployWorker(process.argv[2], process.argv[3], {
  pub: pub,
  sub: sub
});
worker.start();
