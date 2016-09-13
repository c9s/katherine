import {Pattern} from "../Pattern";
import {DeployRequest} from "../requests";
import {Statement} from "./Statement";

export class DeployStatement extends Statement {

  constructor() {
    super();
    this.patterns.push(new Pattern("(?:please )?deploy :appName from :branch branch (?:to|on) :sites(?: (?:servers?|sites?))?(?: :logging)?", "i", {
      "appName": { "pattern": "[a-zA-Z-]+" },
      "branch": { "pattern": "[a-zA-Z0-9-_/]+" },
      "sites": { "pattern": "[a-zA-Z-_,]+" },
      "logging": { "pattern": "verbosely|silently|debugly" }
    }));
  }

  public parse(input : string) : DeployRequest {
    for (let i in this.patterns) {
      const pattern = this.patterns[i];
      const matches = pattern.match(input);
      if (matches) {
        if (typeof matches.sites === "string") {
          matches.sites = (<string>matches.sites).split(/,/);
        }
        switch (matches.logging) {
          case "verbosely":
            delete matches.logging;
            matches.verbose = true;
            break;
          case "silently":
            delete matches.logging;
            matches.silent = true;
            break;
          case "debugly":
            delete matches.logging;
            matches.debug = true;
            break;
        }
        return matches;
      }
    }
    return;
  }

}
