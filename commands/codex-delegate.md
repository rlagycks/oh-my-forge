---
description: Ontology-guided delegation of implementation tasks to Codex worker. Reads .claude/ontology/index.json to get file coordinates, generates a structured BRIEF, then delegates to Codex.
---

# Codex Delegate

Delegate an implementation task to Codex using the ontology GPS. Claude reads only the index and one spec doc (~3K tokens) instead of exploring the full source tree.

## Usage

`/codex-delegate <domain_id> <task>`

**Example:**
```
/codex-delegate domain_hooks "Add ECC_DISABLED_HOOKS support to the PostToolUse event handler"
```

## Execution Steps

### Step 1 — Ontology Query

Run `node "$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')/scripts/lib/ontology.js" query --domain <domain_id>` (fallback to `keys` if the domain is missing).

**Detect format:**
- **Flat format**: `{ "domain_X": { files: [...], ... } }` — domain entry is inline
- **Split format**: `{ "version": "1.0", "domains": { "domain_X": "./path/to/file.json" } }` — load the referenced file

If the domain key does not exist, list available `domain_*` keys and stop.

For **split format**, load the domain JSON file. It contains:
```json
{
  "domain": "domain_X",
  "summary": "...",
  "basePath": "/api/v1/...",
  "endpoints": [{ "method": "GET", "path": "...", "summary": "..." }],
  "models": [{ "name": "...", "fields": {} }],
  "constraints": ["..."],
  "dependsOn": ["domain_Y"]
}
```

### Step 2 — Read Constraints

Use `entry.constraints` directly if present (both formats).

Fallback (flat format only): read `## 핵심 제약` section of `entry.spec`.

### Step 3 — Generate BRIEF via the Shared Runtime

Use `scripts/lib/codex-handoff.js` as the source of truth for request construction.

- `buildBrief` generates the BRIEF text.
- `dispatch --request-file` generates the prompt file, invokes Codex, and validates that Codex returned `RESULT:` before the caller proceeds.
- Codex implementation requests must carry `write: true`; the runtime converts that contract into the companion `--write` flag.
- The runtime includes a `FALSE NORMAL DETECTOR` gate: `RESULT: DONE` is downgraded to `BLOCKED` when proof fields are missing or unresolved `FALSE NORMAL SIGNALS` remain.

Construct the BRIEF in the shared runtime format:

```
BRIEF
=====
DOMAIN: <domain_id>
TASK: <task description>

FILES:
<flat format: entry.files, one per line>
<split format: infer from domain slug convention, e.g. src/**/ar/** for domain_ar>

ENDPOINTS:
<split format: list each endpoint as "METHOD /path — summary">
<flat format: none>

MODELS:
<split format: list model names and key fields>
<flat format: none>

SYMBOLS:
<entry.symbols, or "none">

CONSTRAINTS:
<entry.constraints, one per line>

DEPENDS ON:
<entry.dependsOn, or "none">

HANDOFF FORMAT:
Return your result in the following structure:
  RESULT: DONE | BLOCKED | PARTIAL
  FILES CHANGED: <list>
  TESTS: PASS | FAIL | SKIPPED
  EVIDENCE: <proof item 1> | <proof item 2>
  FALSE NORMAL CHECKS: <what looked healthy but was verified>
  FALSE NORMAL SIGNALS: <unresolved misleading signal 1> | <signal 2> | none
  OPEN RISKS: <risk 1> | <risk 2> | none
  NEXT ACTION: <clear next operator action>
  SUMMARY: <one paragraph>
```

**If the Codex companion is available** (openai-codex plugin or legacy codex-plugin-cc; foreground delegation expected by the caller), write the request JSON to a temp file and dispatch it through the shared runtime:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
node "$PLUGIN_ROOT/scripts/lib/codex-handoff.js" dispatch \
  --request-file "<handoff-request.json>"
```

If auto-resolution selects the wrong companion in your environment, override it explicitly:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
node "$PLUGIN_ROOT/scripts/lib/codex-handoff.js" dispatch \
  --request-file "<handoff-request.json>" \
  --companion-path "<codex-companion.mjs>"
```

**Fallback** (sync, requires Codex CLI in PATH):
```bash
codex "<BRIEF>"
```

Background mode is manual-only. If you explicitly want queued background work, call `/codex:rescue --background` directly instead of `/codex-delegate`. Automatic callers such as `/plan` expect a foreground Codex result in the same control flow.

### Step 4 — Validate Codex Result

After `/codex:rescue` or `codex` completes, inspect the output with `parseCodexResult`:

- If the output is empty, or contains no `RESULT:` line → output `CODEX_DELEGATION_FAILED: rescue returned no result` and return `RESULT: BLOCKED` immediately.
- If `RESULT: DONE` exists but `TESTS`, `EVIDENCE`, `FALSE NORMAL CHECKS`, `FALSE NORMAL SIGNALS`, or `NEXT ACTION` are missing, the false-normal detector returns `RESULT: BLOCKED`.
- If `RESULT: DONE` contains unresolved `FALSE NORMAL SIGNALS`, the runtime returns `RESULT: BLOCKED` even when `TESTS: PASS`.
- Do NOT proceed to code review or commit if Codex did not confirm execution.
- Surface the failure clearly so the caller (plan.md Step 4 or the user) can re-delegate with a clearer BRIEF.

## When to Use

| Condition | Use |
|-----------|-----|
| Single-domain bug fix or feature | `/codex-delegate domain_X "task"` |
| Multi-domain task | Decompose first, then delegate each domain separately |
| Architecture decision | Do NOT delegate — handle in Claude directly |
| Security-sensitive code | Delegate with `codexWorkerHint: read-only`, then `/code-review` |

## Adding a New Domain

Before delegating, the domain must exist in the ontology:

1. Copy `docs/features/_template.md` → `docs/features/<domain>.md`
2. Add `domain_<name>` entry to `.claude/ontology/index.json`
3. Add a row to `docs/features/index.md`
4. Run `npm test` — `validate-ontology.js` enforces consistency
