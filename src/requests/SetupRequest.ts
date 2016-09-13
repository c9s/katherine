import {SlackMessage} from "../SlackMessage";
import {Request} from "./Request";

export interface SetupRequest extends Request {

  tasks : Array<string>;

  sites : Array<string>;

  fromMessage?: SlackMessage;
}
