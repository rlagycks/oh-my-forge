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

Run `node '${CLAUDE_PLUGIN_ROOT:-.}/scripts/lib/ontology.js' query --domain <domain_id>` (fallback to `keys` if the domain is missing).

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

### Step 3 — Generate BRIEF and Delegate

Construct the BRIEF and pass it to Codex:

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
  SUMMARY: <one paragraph>
```

**If codex-plugin-cc is installed** (async delegation):
```
/codex:rescue <BRIEF> --background --fresh
```

**Fallback** (sync, requires Codex CLI in PATH):
```bash
codex "<BRIEF>"
```

### Step 4 — Validate Codex Result

After `/codex:rescue` or `codex` completes, inspect the output:

- If the output is empty, or contains no `RESULT:` line → output `CODEX_DELEGATION_FAILED: rescue returned no result` and return `RESULT: BLOCKED` immediately.
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
