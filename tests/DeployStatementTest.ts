/// <reference path="../typings/globals/mocha/index.d.ts" />
/// <reference path="../typings/globals/chai/index.d.ts" />

import chai = require('chai');

var expect = chai.expect;

// import {GitSync} from "../src/GitSync";
import {Pattern} from "../src/Pattern";
import {DeployStatement} from "../src/statements";

describe('DeploySentence', () => {
  describe('#parseDeploySentence', () => {
    it('should parse sentence with branch master and site name dev', () => {
      let s = new DeployStatement;
      let ret = s.parse('please deploy shaka from master branch to dev server');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "master",
        logging: undefined,
        sites: ["dev"]
      });
    });

    it('should parse sentence with personal branch and site name lite-on', () => {
      let s = new DeployStatement;
      let ret = s.parse('please deploy shaka from carlos/tasks branch to lite-on server');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "carlos/tasks",
        logging: undefined,
        sites: ["lite-on"]
      });
    });

    it('should parse sentence with personal branch and multiple site name', () => {
      let s = new DeployStatement;
      let ret = s.parse('please deploy shaka from carlos/tasks branch to staging,dev server');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "carlos/tasks",
        logging: undefined,
        sites: ["staging", "dev"]
      });
    });

    it('should parse logging level', () => {
      let s = new DeployStatement;
      let ret = s.parse('please deploy shaka from carlos/tasks branch to staging,dev verbosely');
      expect(ret).is.deep.equal({
        appName: "shaka",
        branch: "carlos/tasks",
        sites: ["staging", "dev"],
        verbose: true
      });
    });



  });
});
