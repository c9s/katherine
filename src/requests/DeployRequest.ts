import {SlackMessage} from "../SlackMessage";
import {Request} from "./Request";

export interface DeployRequest extends Request {

  branch : string;

  appName : string;

  sites : Array<string>;

  fromMessage?: SlackMessage;

  verbose?: boolean;

  silent?: boolean;

  debug?: boolean;
}
