---
description: Record a design decision, bug root cause, or tool usage pattern into the ontology decision log.
---

# /decide Command

Records why code was changed, what the root cause of a bug was, or how a tool should be used — into the ontology's persistent decision log.

## Usage

```
/decide
/decide --domain domain_commands --type bug-fix --summary "..." --why "..."
```

## Decision Types

| Type | When to use |
|------|-------------|
| `design` | Architectural choice, trade-off, or intentional constraint |
| `bug-fix` | Root cause of a bug that was fixed |
| `refactor` | Why code was restructured |
| `tool-pattern` | How a tool/hook should be used (learned from failure) |
| `constraint` | A rule that must be enforced to prevent regressions |

## Interactive Flow

When called without arguments, prompt the user for:

1. **Domain** — which domain does this belong to? (list from `.claude/ontology/index.json`)
2. **Type** — design / bug-fix / refactor / tool-pattern / constraint
3. **Summary** — one-line: what was decided or changed?
4. **Why** — root cause or motivation (the most important field)
5. **Files** — which files are affected? (comma-separated, optional)
6. **Ref** — PR, commit, or issue number (optional)

Then run:

```bash
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" add \
  --domain <domain> \
  --type <type> \
  --summary "<summary>" \
  --why "<why>" \
  --files "<file1,file2>" \
  --ref "<ref>"
```

This writes to:
- `domain_<name>.json` → `decisions[]` array (queryable by domain)
- `~/.claude/decisions/index.jsonl` → global append-only log (cross-session)

## Querying Decisions

```bash
# All decisions in a domain
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" query --domain domain_commands
```

```bash
# All bug-fixes
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" query --type bug-fix
```

```bash
# Decisions touching a specific file
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" query --file commands/plan.md
```

```bash
# Decisions since a date
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" query --since 2026-04-01
```

```bash
# Free-text search
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" query --q "silent failure"
```

```bash
# List domains that have decisions
DECISIONS_JS="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(\"path\"),f=require(\"fs\"),h=require(\"os\").homedir(),a=[p.join(h,\".claude\"),p.join(h,\".codex\")],q=p.join(\"scripts\",\"lib\",\"utils.js\");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],\"plugins\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"oh-my-forge@rlagycks\"),p.join(a[j],\"plugins\",\"marketplace\",\"oh-my-forge\"),p.join(a[j],\"plugins\",\"everything-claude-code\"),p.join(a[j],\"plugins\",\"everything-claude-code@everything-claude-code\"),p.join(a[j],\"plugins\",\"marketplace\",\"everything-claude-code\"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [\"oh-my-forge\",\"everything-claude-code\"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],\"plugins\",\"cache\",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/decisions.js"
node "$DECISIONS_JS" list-domains
```

## Auto-Recording Convention

After any significant bug fix or architectural decision, Claude should proactively offer:

> "이 수정 내용을 의사결정 로그에 기록할까요? (`/decide` 실행)"

If the user says yes (or the session includes a `/decide` call), record it immediately before moving on.

## Design Philosophy

The decision log answers the question: **"왜 이렇게 되어 있지?"**

- Bug fixes: record the ROOT CAUSE, not just "fixed X"
- Design decisions: record the TRADE-OFF that was considered
- Tool patterns: record what FAILED before this approach was chosen
- Constraints: record the INCIDENT that necessitated the constraint

The `why` field is the most important — it's what prevents the same mistake twice.
