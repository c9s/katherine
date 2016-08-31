
import {Pattern} from "./Pattern";
import {DeployRequest} from "./DeployRequest";

export class DeployStatement {

  public parse(input : string) : DeployRequest {
    let patterns = [];

    patterns.push(new Pattern("(?:please )?deploy :appName from :branch branch to :sites(?: (?:servers?|sites?))?(?: :logging)?", "i", {
      "appName": { "pattern": "[a-zA-Z-]+" },
      "branch": { "pattern": "[a-zA-Z-_/]+" },
      "sites": { "pattern": "[a-zA-Z-_,]+" },
      "logging": { "pattern": "verbosely" }
    }));

    for (let i in patterns) {
      let pattern = patterns[i];
      let matches = pattern.match(input);
      if (matches) {
        if (typeof matches.sites === "string") {
          matches.sites = matches.sites.split(/,/);
        }
        if (matches.logging == "verbosely") {
          delete matches.logging;
          matches.verbose = true;
        }
        return matches;
      }
    }
    return;
  }

}
