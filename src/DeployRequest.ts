interface SlackMessage {

  channel : string;

  user : string;

  text : string;

  type : string;

  ts : string;

  tream : string;

}

export interface DeployRequest {

  branch : string;

  appName : string;

  sites : Array<string>;

  fromMessage?: SlackMessage;

  verbose?: boolean;

  silent?: boolean;

  debug?: boolean;
}
