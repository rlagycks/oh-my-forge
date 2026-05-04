---
description: Start NanoClaw v2 — OMF's persistent, zero-dependency REPL with model routing, skill hot-load, branching, compaction, export, and metrics.
---

# Claw Command

Start an interactive AI agent session with persistent markdown history and operational controls.

## Usage

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
node "$PLUGIN_ROOT/scripts/claw.js"
```

Or via npm:

```bash
npm run claw
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAW_SESSION` | `default` | Session name (alphanumeric + hyphens) |
| `CLAW_SKILLS` | *(empty)* | Comma-separated skills loaded at startup |
| `CLAW_MODEL` | `sonnet` | Default model for the session |

## REPL Commands

```text
/help                          Show help
/clear                         Clear current session history
/history                       Print full conversation history
/sessions                      List saved sessions
/model [name]                  Show/set model
/load <skill-name>             Hot-load a skill into context
/branch <session-name>         Branch current session
/search <query>                Search query across sessions
/compact                       Compact old turns, keep recent context
/export <md|json|txt> [path]   Export session
/metrics                       Show session metrics
exit                           Quit
```

## Notes

- NanoClaw remains zero-dependency.
- Sessions are stored at `~/.claude/claw/<session>.md`.
- Compaction keeps the most recent turns and writes a compaction header.
- Export supports markdown, JSON turns, and plain text.
