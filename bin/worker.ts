const fs = require('fs');
const Redis = require("redis");

import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "../src/channels";
import {DeployWorker} from "../src/DeployWorker";

const config = JSON.parse(fs.readFileSync('delivery.json'));
const sub = Redis.createClient(config.redis);
const pub = Redis.createClient(config.redis);
console.log("===> Starting worker: ", process.argv[2], process.argv[3]);
const worker = new DeployWorker(process.argv[2], process.argv[3], {
  pub: pub,
  sub: sub
});
worker.start();
