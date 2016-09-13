/// <reference path="../typings/globals/mocha/index.d.ts" />
/// <reference path="../typings/globals/chai/index.d.ts" />

import chai = require('chai');

const expect = chai.expect;

// import {GitSync} from "../src/GitSync";
import {Pattern} from "../src/Pattern";
import {SetupStatement} from "../src/statements";

describe('SetupSentence', () => {
  describe('#parseSetupSentence', () => {
    it('should parse setup sentence without task names', () => {
      const s = new SetupStatement;
      const ret = s.parse('please setup on dev server');
      expect(ret).is.deep.equal({
        logging: undefined,
        tasks: undefined,
        sites: ["dev"]
      });
    });

    it('should parse setup sentence with task name', () => {
      const s = new SetupStatement;
      const ret = s.parse('please setup certbot on dev server');
      expect(ret).is.deep.equal({
        logging: undefined,
        tasks: ["certbot"],
        sites: ["dev"]
      });
    });

    it('should parse setup sentence with multiple task names', () => {
      const s = new SetupStatement;
      const ret = s.parse('please setup certbot,stud on dev server');
      expect(ret).is.deep.equal({
        logging: undefined,
        tasks: ["certbot", "stud"],
        sites: ["dev"]
      });
    });
  });
});
