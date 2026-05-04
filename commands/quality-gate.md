# Quality Gate Command

Run the OMF quality pipeline on demand for a file or project scope.

## Usage

`/quality-gate [path|.] [--fix] [--strict]`

- default target: current directory (`.`)
- `--fix`: allow auto-format/fix where configured
- `--strict`: fail on warnings where supported

## Pipeline

1. Detect language/tooling for target.
2. Run formatter checks.
3. Run lint/type checks when available.
4. If `.claude/ontology/index.json` exists **and** `scripts/ci/validate-ontology.js` exists — `PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require("path"),f=require("fs"),h=require("os").homedir(),a=[p.join(h,".claude"),p.join(h,".codex")],q=p.join("scripts","lib","utils.js");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],"plugins","oh-my-forge"),p.join(a[j],"plugins","oh-my-forge@rlagycks"),p.join(a[j],"plugins","marketplace","oh-my-forge"),p.join(a[j],"plugins","everything-claude-code"),p.join(a[j],"plugins","everything-claude-code@everything-claude-code"),p.join(a[j],"plugins","marketplace","everything-claude-code"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ["oh-my-forge","everything-claude-code"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],"plugins","cache",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"; ONTOLOGY_INDEX="$PLUGIN_ROOT/.claude/ontology/index.json"; if [ -f "$ONTOLOGY_INDEX" ] && [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ]; then node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js"; elif [ ! -f "$ONTOLOGY_INDEX" ]; then echo "Ontology: SKIPPED (.claude/ontology/index.json 없음)"; else echo "Ontology: SKIPPED (validate-ontology.js 없음 — OMF 개발 레포 전용)"; fi` 실행.
5. Produce a concise remediation list.

## Notes

This command mirrors hook behavior but is operator-invoked.

## Arguments

$ARGUMENTS:
- `[path|.]` optional target path
- `--fix` optional
- `--strict` optional
