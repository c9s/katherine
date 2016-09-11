import {SlackMessage} from "../SlackMessage";
import {Request} from "./Request";

export interface RestartRequest extends Request {

  appName : string;

  sites : Array<string>;

  fromMessage?: SlackMessage;

  verbose?: boolean;

  silent?: boolean;

  debug?: boolean;
}
