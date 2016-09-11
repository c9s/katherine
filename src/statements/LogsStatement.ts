import {Pattern} from "../Pattern";
import {LogsRequest} from "../requests";
import {Statement} from "./Statement";

export class LogsStatement extends Statement {

  constructor() {
    super();
    this.patterns.push(new Pattern("show me the logs (?:to|on) :sites", "i", {
      "sites": { "pattern": "[a-zA-Z-_,]+" },
    }));
  }

  public parse(input : string) : LogsRequest {
    for (const i in this.patterns) {
      const pattern = this.patterns[i];
      const matches = pattern.match(input);
      if (matches) {
        if (typeof matches.sites === "string") {
          matches.sites = matches.sites.split(/,/);
        }
        return matches;
      }
    }
    return;
  }
}
