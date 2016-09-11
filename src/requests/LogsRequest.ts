import {SlackMessage} from "../SlackMessage";
import {Request} from "./Request";

export interface LogsRequest extends Request {
  sites : Array<string>;

  fromMessage?: SlackMessage;

  verbose?: boolean;

  silent?: boolean;

  debug?: boolean;
}
