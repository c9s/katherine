import {Pattern} from "../Pattern";
import {SetupRequest} from "../requests";
import {Statement} from "./Statement";

export class SetupStatement extends Statement {

  constructor() {
    super();
    this.patterns.push(new Pattern("(?:please )?setup(?: :tasks)? (?:to|on) :sites(?: (?:servers?|sites?))?(?: :logging)?", "i", {
      "tasks": {  "pattern": "[a-zA-Z-_,]+" },
      "sites": { "pattern": "[a-zA-Z-_,]+" },
      "logging": { "pattern": "verbosely|silently|debugly" }
    }));
  }

  public parse(input : string) : SetupRequest {

    for (let i in this.patterns) {
      const pattern = this.patterns[i];
      const matches = pattern.match(input);
      if (matches) {
        if (typeof matches.sites === "string") {
          matches.sites = matches.sites.split(/,/);
        }
        if (typeof matches.tasks === "string") {
          matches.tasks = matches.tasks.split(/,/);
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
