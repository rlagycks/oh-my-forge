---
name: projects
description: List known projects and their instinct statistics
command: true
---

# Projects Command

List project registry entries and per-project instinct/observation counts for continuous-learning-v2.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
python3 "$PLUGIN_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

## Usage

```bash
/projects
```

## What to Do

1. Read `~/.claude/homunculus/projects.json`
2. For each project, display:
   - Project name, id, root, remote
   - Personal and inherited instinct counts
   - Observation event count
   - Last seen timestamp
3. Also display global instinct totals
