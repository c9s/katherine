
import {SlackMessage} from "./SlackMessage";

export interface DeployRequest {

  branch : string;

  appName : string;

  sites : Array<string>;

  fromMessage?: SlackMessage;

  verbose?: boolean;

  silent?: boolean;

  debug?: boolean;
}
