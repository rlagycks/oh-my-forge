---
name: instinct-status
description: Show learned instincts (project + global) with confidence
command: true
---

# Instinct Status Command

Shows learned instincts for the current project plus global instincts, grouped by domain.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
python3 "$PLUGIN_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## Usage

```
/instinct-status
```

## What to Do

1. Detect current project context (git remote/path hash)
2. Read project instincts from `~/.claude/homunculus/projects/<project-id>/instincts/`
3. Read global instincts from `~/.claude/homunculus/instincts/`
4. Merge with precedence rules (project overrides global when IDs collide)
5. Display grouped by domain with confidence bars and observation stats

## Output Format

```
============================================================
  INSTINCT STATUS - 12 total
============================================================

  Project: my-app (a1b2c3d4e5f6)
  Project instincts: 8
  Global instincts:  4

## PROJECT-SCOPED (my-app)
  ### WORKFLOW (3)
    ███████░░░  70%  grep-before-edit [project]
              trigger: when modifying code

## GLOBAL (apply to all projects)
  ### SECURITY (2)
    █████████░  85%  validate-user-input [global]
              trigger: when handling user input
```
