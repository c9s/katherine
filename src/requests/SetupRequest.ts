import {SlackMessage} from "../SlackMessage";
import {Request} from "./Request";

export interface SetupRequest extends Request {

  appName : string;

  sites : Array<string>;

  fromMessage?: SlackMessage;
}
