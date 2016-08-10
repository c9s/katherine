
import {Pattern} from "./Pattern";
import {DeployTask} from "./DeployTask";

export class DeployStatement {

  public parse(input : string) : DeployTask {
    let patterns = [];

    patterns.push(new Pattern("(?:please )?deploy :appName from :branch branch to :sites(?: (?:server|site))?", "i", {
      "appName": { 'pattern': "[a-zA-Z-]+" },
      "branch": { 'pattern': "[a-zA-Z-_/]+" },
      "sites": { 'pattern': "[a-zA-Z-_,]+" },
    }));

    for (let i in patterns) {
      let pattern = patterns[i];
      let matches = pattern.match(input);
      if (matches) {
        if (matches.sites) {
          matches.sites = matches.sites.split(/,/);
        }
        return matches;
      }
    }
    return;
  }

}
