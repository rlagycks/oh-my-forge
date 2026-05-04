---
name: promote
description: Promote project-scoped instincts to global scope
command: true
---

# Promote Command

Promote instincts from project scope to global scope in continuous-learning-v2.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
python3 "$PLUGIN_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" promote [instinct-id] [--force] [--dry-run]
```

## Usage

```bash
/promote                      # Auto-detect promotion candidates
/promote --dry-run            # Preview auto-promotion candidates
/promote --force              # Promote all qualified candidates without prompt
/promote grep-before-edit     # Promote one specific instinct from current project
```

## What to Do

1. Detect current project
2. If `instinct-id` is provided, promote only that instinct (if present in current project)
3. Otherwise, find cross-project candidates that:
   - Appear in at least 2 projects
   - Meet confidence threshold
4. Write promoted instincts to `~/.claude/homunculus/instincts/personal/` with `scope: global`
