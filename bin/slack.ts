const fs = require('fs');
const path = require('path');
const slack = require('@slack/client');

import * as _ from "underscore";

namespace Slack {
  export interface Channel {
    id : string;

    name : string;

    is_channel : boolean;

    created: number;

    creator : string;

    is_archived : boolean;

    is_general : boolean;

    members : Array<string>;

    is_member : boolean;

    is_private : boolean;

    is_shared : boolean;

    is_org_shared : boolean;

    last_read : string; // timestamp string

    has_pins : boolean;
  }

  export interface Message {

    type : string;

    channel : string;

    user : string;

    text : string;

    ts : string;

    thread_ts ?: string;

    source_team : string;

    // "reply_to":17276
    reply_to ?: number;
  }

}


import child_process = require('child_process');
import {WorkerPool} from "../src/WorkerPool";
import * as mongo from "mongodb";

const token = process.env.SLACK_API_TOKEN || '';

const MemoryDataStore = slack.MemoryDataStore;
const RtmClient = slack.RtmClient;


async function connectMongo(url : string) : Promise<mongo.Db> {
  return new Promise<mongo.Db>((resolve, reject) => {
      mongo.MongoClient.connect(url, (err, db) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
  });
}


import * as redis from "redis";

const mongoUrl = 'mongodb://localhost:27017/test';

const dataStore = new MemoryDataStore();
const rtm = new RtmClient(token, {
  // logLevel: 'debug',
  dataStore: dataStore,
});

const slackWeb = new slack.WebClient(token);

const BROADCAST_CHANNEL = "jobs";
const MASTER_CHANNEL = "master";

const config = JSON.parse(fs.readFileSync('katherine.json'));
const sub = redis.createClient(config.redis);
const pub = redis.createClient(config.redis);

const CLIENT_EVENTS = slack.CLIENT_EVENTS;
const RTM_EVENTS = slack.RTM_EVENTS;
const RTM_CLIENT_EVENTS = slack.CLIENT_EVENTS.RTM;



function formatError(m) {
  if (m instanceof Error) {
    return m.message;
  }
  return m;
}

function formatPlainText(message : string) : string {
  if (typeof message === "object") {
    message = JSON.stringify(message);
  }
  return "```\n"
   + message
   + "\n```";
}

function formatReply(userId : string, message) : string {
  return `<@${userId}>: ${message}`;
}



class ChannelHistoryFetcher {

  protected client;

  constructor(client) {
    this.client = client;
  }

  public fetch(channelId : string, oldest : string) : Promise<any> {
    return new Promise<any>(resolve => {
      this.client.channels.history(channelId, {
        "count": 20,
        "oldest": oldest,
      }, (err, info) => {
        resolve(info);
      });
    });
  }
}

class ChannelHistorySynchronizer {

  protected dataStore;

  protected fetcher : ChannelHistoryFetcher;

  constructor(dataStore, fetcher : ChannelHistoryFetcher) {

    this.dataStore = dataStore;
    this.fetcher = fetcher;
  }

  public async syncChannel(chan : Slack.Channel) {
    const db = await connectMongo(mongoUrl);
    // const col = db.collection("channel-" + chan.id + "_" + chan.name);
    const col = db.collection("messages");

    let ts = ((new Date()).getTime() / 1000) - (3600*24*30);

    const lastMsg = await col.findOne({
      "channel": chan.id,
    }, { "sort": { "ts": -1 }, "limit": 1 });
    if (lastMsg) {
      ts = lastMsg.ts;
    }

    const sync = async (ts) => {
      console.log("Fetching",chan.id, ts);
      const response = await this.fetcher.fetch(chan.id, ts);
      const messages = response.messages;
      if (messages.length == 0) {
        return response;
      }

      for (let msg of response.messages) {
        console.log("Message", msg.text);
      }

      const composeMessages = messages.map((m) => {
        m.channel = chan.id;
        return m;
      });

      col.insert(composeMessages, (err, result) => {
        if (err) {
          console.error(err);
        } else {
          console.log("Inserted", result.insertedCount);
        }
      });
      return response;
    };
    let response = await sync(ts);
    while (response.has_more) {
      const latest = response.messages[0];
      response = await sync(latest.ts);
    }
  }

  public sync() {
    // @see https://api.slack.com/types/channel
    const chan = this.dataStore.getChannelByName('general') as Slack.Channel;
    console.log("Channel", chan);
    this.syncChannel(chan);
  }
}


abstract class SlackBot {

  protected rtm;

  protected messageQueue : Promise<any>;

  constructor(rtm) {
    this.rtm = rtm;
    this.messageQueue = Promise.resolve({});
  }

  public sendMessage(message, channel) {
    if (typeof message === "object") {
      this.sendWebAPIMessage(message, channel);
    } else {
      this.sendRtmMessage(message, channel);
    }
  }

  public sendWebAPIMessage(message, channel) {
    this.messageQueue.then(() => {
      return new Promise(resolve => {
        let msg = _.extend(message, {
          "channel": channel,
          "as_user": true
        });
        slackWeb.chat.postMessage(channel, "", msg, resolve);
      });
    });
  }

  public sendRtmMessage(message, channel) {
    this.messageQueue.then(() => {
      return new Promise(resolve => {
        this.rtm.sendMessage(message, channel, resolve);
      });
    });
  }

}

class DeployBot extends SlackBot {

  protected startData;

  protected config;

  constructor(rtm, config) {
    super(rtm);
    this.config = config;

    this.rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, this.handleStartData.bind(this));
    this.rtm.on(RTM_EVENTS.MESSAGE, this.handleMessage.bind(this));
    this.rtm.on(RTM_EVENTS.CHANNEL_JOINED, this.handleChannelJoined.bind(this));

    // you need to wait for the client to fully connect before you can send messages
    this.rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, () => {
      let user = rtm.dataStore.getUserById(rtm.activeUserId);
      let team = rtm.dataStore.getTeamById(rtm.activeTeamId);
      console.log('Connected to ' + team.name + ' as ' + user.name);
    });

    sub.on("message", this.handleMasterMessage.bind(this));
    sub.on("subscribe", (channel, count) => {
      console.log("redis.subscribe", channel, count);
    });
    sub.subscribe(MASTER_CHANNEL);
  }

  protected handleMasterMessage(channel : string, message : string) {
    const payload = JSON.parse(message);

    // console.log('handleMasterMessage', channel, JSON.stringify(payload, null, "  "));
    /*
    switch (payload.type) {
      case "connect":
        // this.rtm.sendMessage(`worker ${payload.name} connected.`, payload.currentRequest.fromMessage.channel);
        pub.publish(payload.name, JSON.stringify({ 'type': 'config', 'config': this.config }));
        break;
      case "ready":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(`The deploy worker ${payload.name} is ready.`, payload.currentRequest.fromMessage.channel);
        }
        break;
      case "error":
      case "debug":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(formatPlainText(payload.message), payload.currentRequest.fromMessage.channel);
        }
      case "progress":
        if (payload.currentRequest && payload.currentRequest.fromMessage && payload.currentRequest.fromMessage.channel) {
          this.sendMessage(payload.message, payload.currentRequest.fromMessage.channel);
        }
        break;
    }
    */
  }

  protected handleMessage(message) {
    let user = this.rtm.dataStore.getUserById(message.user);
    let channel = this.rtm.dataStore.getChannelGroupOrDMById(message.channel);

    if (user && channel) {
      console.log(
        'User %s posted a message in %s channel',
        user.name,
        channel.name
      );
    }

    console.log(message);


    const parseMentionUserId = new RegExp('^<@(\\w+)>:\\s*');

    if (!message.text) {
      return;
    }

    const matches = message.text.match(parseMentionUserId);
    if (!matches) {
      return;
    }
    console.log("Request matches ID: ", matches);

    const objectId = matches[1];

    const statements = {
      // 'deploy'  : new DeployStatement,
    };

    // talking to me...
    if (objectId == this.startData.self.id) {
      const sentence = message.text.replace(parseMentionUserId, '');
      for (const jobType in statements) {
        const s = statements[jobType];
        const request = s.parse(sentence);
        if (request) {
          request.fromMessage = message;
          /*
          this.workerPool.findIdleWorker().then((workerId) => {
            console.log(`job: ${jobType} => worker ${workerId}`);
            pub.publish(workerId, JSON.stringify({ 'type': jobType, 'request' : request }));
          }).catch((e) => {
            console.log(e);
            this.rtm.sendMessage(`Error: ${e}`, message.channel);
          });
          */
          return;
        }
      }
      this.rtm.sendMessage(formatReply(message.user, "Sorry, I don't understand."), message.channel);
    }
  }

  protected handleChannelJoined(message) {
    console.log("CHANNEL_JOINED", message);
  }

  protected async handleStartData(rtmStartData) {
    console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
    this.startData = rtmStartData;

    const historyFetcher = new ChannelHistoryFetcher(slackWeb);
    const historySynchronizer = new ChannelHistorySynchronizer(dataStore, historyFetcher);
    historySynchronizer.sync();

    /*
      console.log(err,
        channelHistory.oldest, // 1483228800
        channelHistory.messages
      );
    */
    /*
        [ { type: 'message',
          user: 'U10AAPXXX',
          text: 'text...',
          attachments: [Array],
          ts: '1508303169.000048' },
          ... ]

      REPLY:

        {
          "reply_to":16450,
          "type":"message",
          "channel":"C6HRHSJ3Y",
          "user":"U62AAPNBS",
          "text":".....",
          "ts":"1508553791.000077"
        }

    */
    /*
    */
  }
}


/*
const workerPool = new WorkerPool(config);
workerPool.fork();
*/
const bot = new DeployBot(rtm, config);
if (config.web) {
  const httpServer = child_process.fork(path.resolve(__dirname + '/../src/WebService'), []);
}

console.log("===> Starting RTM ...");
rtm.start();
