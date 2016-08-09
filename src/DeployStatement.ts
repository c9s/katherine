
import {Pattern} from "./Pattern";

export class DeployStatement {

  public parse(input : string) {
    let patterns = [];
    patterns.push(new Pattern("(?:please)? deploy :appName from :branch branch to :server server", "i", {
      "appName": { pattern: "[a-zA-Z-]+" },
      "branch": { pattern: "[a-zA-Z-_/]+" },
      "server": { pattern: "[a-zA-Z-_]+" },
    }));

    for (var i in patterns) {
      let pattern = patterns[i];
      let matches = pattern.match(input);
      if (matches) {
        return matches;
      }
    }
    return;
  }

}
