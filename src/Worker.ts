const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const _ = require('underscore');

import {DeployAction, GitSync, GitRepo, Deployment, Config, ConfigParser, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";
import {DeployRequest} from "./DeployRequest";
import {RedisClient} from "redis";

import {WORKER_STATUS, MASTER_CHANNEL, BROADCAST_CHANNEL} from "./channels";

import {createAttachmentsFromStdout, createAttachmentsFromSummaryMap} from "./SlackUtils";

interface WorkerConfig {
  pub : RedisClient;
  sub : RedisClient;
}

export abstract class Worker {

  public name : string;

  public directory : string;

  public repo : GitRepo;

  public config : any;

  public deployConfig : any;

  public pub : RedisClient;

  public sub : RedisClient;

  protected currentRequest : DeployRequest;

  protected jobQueue : Promise<any>;

  constructor(name : string, directory : string, config : WorkerConfig) {
    this.name = name;
    this.directory = directory;
    this.repo = new GitRepo(directory);

    this.pub = config.pub;

    const sub = this.sub = config.sub;

    // Setup handleMessage handler
    sub.on("message", this.handleMessage.bind(this));

    // subscribe
    sub.subscribe(BROADCAST_CHANNEL);
    sub.subscribe(this.name);
    this.jobQueue = Promise.resolve(null);
  }

  public abstract handleMessage(channel : string, message);
}
