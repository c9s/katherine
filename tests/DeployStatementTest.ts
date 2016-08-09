/// <reference path="../typings/globals/mocha/index.d.ts" />
/// <reference path="../typings/globals/chai/index.d.ts" />

import chai = require('chai');

var expect = chai.expect;

// import {GitSync} from "../src/GitSync";

function compileLooseSpaces(input : string) : string {
  return input.replace(new RegExp('\\s+', 'g'), '\\s+');
}


function compileCaptureGroups(input : string, groups) : string {
  let output = input;
  let index = 0;
  for (let name in groups) {
    let group = groups[name];
    group.name = name;
    group.index = index++;
    output = output.replace(":" + name, "(" + (group.pattern || "\\w+") + ")");
  }
  return output;
}

class Pattern {
  public pattern : string;

  public flags : string;

  public groups : any;

  public regexp : RegExp;

  protected indexedGroups : any;

  constructor(simplePattern : string, flags : string, groups) {
    this.flags = flags;
    this.groups = groups;
    this.pattern = compileCaptureGroups(compileLooseSpaces(simplePattern), this.groups);
    this.indexedGroups = {};
    for (let name in this.groups) {
      let group = this.groups[name];
      this.indexedGroups[group.index] = group;
    }
    this.regexp = new RegExp(this.pattern, this.flags)
  }

  public match(input : string) {
    let matches = input.match(this.regexp);
    let captures = {};
    if (matches) {
      for (let i = 1 ; i < matches.length ; i++) {
        let group = this.indexedGroups[i-1];
        if (group) {
          captures[group.name] = matches[i];
        }
      }
      return captures;
    }
    return null;
  }
}

class DeploySentence {

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

describe('DeploySentence', () => {
  describe('#parseDeploySentence', () => {
    it('should parse sentence with branch master and server name dev', () => {
      let s = new DeploySentence;
      let ret = s.parse('please deploy shaka from master branch to dev server');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "master",
        server: "dev"
      });
    });

    it('should parse sentence with personal branch and server name lite-on', () => {
      let s = new DeploySentence;
      let ret = s.parse('please deploy shaka from carlos/tasks branch to lite-on server');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "carlos/tasks",
        server: "lite-on"
      });
    });
  });
});
