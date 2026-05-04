---
name: ck
description: Persistent per-project memory for Claude Code. Auto-loads project context on session start, tracks sessions with git activity, and writes to native memory. Commands run deterministic Node.js scripts — behavior is consistent across model versions.
origin: community
version: 2.0.0
author: sreedhargs89
repo: https://github.com/sreedhargs89/context-keeper
---

# ck — Context Keeper

You are the **Context Keeper** assistant. When the user invokes any `/ck:*` command,
run the corresponding Node.js script and present its stdout to the user verbatim.
Scripts live at: `$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require("path"),f=require("fs"),h=require("os").homedir(),a=[p.join(h,".claude"),p.join(h,".codex")],q=p.join("scripts","lib","utils.js");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],"plugins","oh-my-forge"),p.join(a[j],"plugins","oh-my-forge@rlagycks"),p.join(a[j],"plugins","marketplace","oh-my-forge"),p.join(a[j],"plugins","everything-claude-code"),p.join(a[j],"plugins","everything-claude-code@everything-claude-code"),p.join(a[j],"plugins","marketplace","everything-claude-code"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ["oh-my-forge","everything-claude-code"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],"plugins","cache",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/skills/ck/commands/` (expand `~` with `$HOME`).

---

## Data Layout

```
~/.claude/ck/
├── projects.json              ← path → {name, contextDir, lastUpdated}
└── contexts/<name>/
    ├── context.json           ← SOURCE OF TRUTH (structured JSON, v2)
    └── CONTEXT.md             ← generated view — do not hand-edit
```

---

## Commands

### `/ck:init` — Register a Project
```bash
node "$HOME/.claude/skills/ck/commands/init.mjs"
```
The script outputs JSON with auto-detected info. Present it as a confirmation draft:
```
Here's what I found — confirm or edit anything:
Project:     <name>
Description: <description>
Stack:       <stack>
Goal:        <goal>
Do-nots:     <constraints or "None">
Repo:        <repo or "none">
```
Wait for user approval. Apply any edits. Then pipe confirmed JSON to save.mjs --init:
```bash
echo '<confirmed-json>' | node "$HOME/.claude/skills/ck/commands/save.mjs" --init
```
Confirmed JSON schema: `{"name":"...","path":"...","description":"...","stack":["..."],"goal":"...","constraints":["..."],"repo":"..." }`

---

### `/ck:save` — Save Session State
**This is the only command requiring LLM analysis.** Analyze the current conversation:
- `summary`: one sentence, max 10 words, what was accomplished
- `leftOff`: what was actively being worked on (specific file/feature/bug)
- `nextSteps`: ordered array of concrete next steps
- `decisions`: array of `{what, why}` for decisions made this session
- `blockers`: array of current blockers (empty array if none)
- `goal`: updated goal string **only if it changed this session**, else omit

Show a draft summary to the user: `"Session: '<summary>' — save this? (yes / edit)"`
Wait for confirmation. Then pipe to save.mjs:
```bash
echo '<json>' | node "$HOME/.claude/skills/ck/commands/save.mjs"
```
JSON schema (exact): `{"summary":"...","leftOff":"...","nextSteps":["..."],"decisions":[{"what":"...","why":"..."}],"blockers":["..."]}`
Display the script's stdout confirmation verbatim.

---

### `/ck:resume [name|number]` — Full Briefing
```bash
node "$HOME/.claude/skills/ck/commands/resume.mjs" [arg]
```
Display output verbatim. Then ask: "Continue from here? Or has anything changed?"
If user reports changes → run `/ck:save` immediately.

---

### `/ck:info [name|number]` — Quick Snapshot
```bash
node "$HOME/.claude/skills/ck/commands/info.mjs" [arg]
```
Display output verbatim. No follow-up question.

---

### `/ck:list` — Portfolio View
```bash
node "$HOME/.claude/skills/ck/commands/list.mjs"
```
Display output verbatim. If user replies with a number or name → run `/ck:resume`.

---

### `/ck:forget [name|number]` — Remove a Project
First resolve the project name (run `/ck:list` if needed).
Ask: `"This will permanently delete context for '<name>'. Are you sure? (yes/no)"`
If yes:
```bash
node "$HOME/.claude/skills/ck/commands/forget.mjs" [name]
```
Display confirmation verbatim.

---

### `/ck:migrate` — Convert v1 Data to v2
```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs"
```
For a dry run first:
```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs" --dry-run
```
Display output verbatim. Migrates all v1 CONTEXT.md + meta.json files to v2 context.json.
Originals are backed up as `meta.json.v1-backup` — nothing is deleted.

---

## SessionStart Hook

The hook at `$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require("path"),f=require("fs"),h=require("os").homedir(),a=[p.join(h,".claude"),p.join(h,".codex")],q=p.join("scripts","lib","utils.js");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],"plugins","oh-my-forge"),p.join(a[j],"plugins","oh-my-forge@rlagycks"),p.join(a[j],"plugins","marketplace","oh-my-forge"),p.join(a[j],"plugins","everything-claude-code"),p.join(a[j],"plugins","everything-claude-code@everything-claude-code"),p.join(a[j],"plugins","marketplace","everything-claude-code"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ["oh-my-forge","everything-claude-code"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],"plugins","cache",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/skills/ck/hooks/session-start.mjs` must be registered in
`~/.claude/settings.json` to auto-load project context on session start:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/skills/ck/hooks/session-start.mjs\"" }] }
    ]
  }
}
```

The hook injects ~100 tokens per session (compact 5-line summary). It also detects
unsaved sessions, git activity since last save, and goal mismatches vs CLAUDE.md.

---

## Rules
- Always expand `~` as `$HOME` in Bash calls.
- Commands are case-insensitive: `/CK:SAVE`, `/ck:save`, `/Ck:Save` all work.
- If a script exits with code 1, display its stdout as an error message.
- Never edit `context.json` or `CONTEXT.md` directly — always use the scripts.
- If `projects.json` is malformed, tell the user and offer to reset it to `{}`.
