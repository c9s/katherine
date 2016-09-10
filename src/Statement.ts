import {Pattern} from "./Pattern";

export class Statement {

  protected patterns : Array<Pattern>;

  constructor() {
    this.patterns = [];
  }

  public test(input : string) : boolean {
    for (let i in this.patterns) {
      const pattern = this.patterns[i];
      const matches = pattern.match(input);
      if (matches) {
        return true;
      }
    }
    return false;
  }

}
