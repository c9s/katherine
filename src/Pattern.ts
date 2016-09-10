
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

export class Pattern {

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

  public match(input : string) : any {
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
