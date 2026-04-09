---
description: Ontology-guided implementation by Claude directly (no Codex required). Reads .claude/ontology/index.json to get file coordinates, generates a structured BRIEF, then implements inline.
---

# Claude Implement

Implement a task within an ontology domain using Claude directly — no Codex CLI required. Uses the same BRIEF structure as `/codex-delegate` so plans are portable between engines.

## Usage

`/claude-implement <domain_id> <task>`

**Example:**
```
/claude-implement domain_hooks "Add ECC_DISABLED_HOOKS support to the PostToolUse event handler"
```

## When to Use

This command is automatically selected by `/plan` when:
- `codex` binary is not found in PATH (auto-detect)
- `CLAUDE_IMPL_ENGINE=claude` environment variable is set
- `implementationEngine: "claude"` is set in `.claude/settings.json` or `~/.claude/settings.json`

| Condition | Use |
|-----------|-----|
| Single-domain bug fix or feature (no Codex) | `/claude-implement domain_X "task"` |
| Multi-domain task | Decompose first, then implement each domain separately |
| Architecture decision | Do NOT use — handle in Claude directly without delegation |
| Security-sensitive code | Implement, then `/code-review` |

## Execution Steps

### Step 1 — Ontology Query

Read `.claude/ontology/index.json`.

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

### Step 2 — Build BRIEF

Construct the same BRIEF format used by `/codex-delegate`:

```
BRIEF
=====
DOMAIN: <domain_id>
TASK: <task description>

FILES:
<flat format: entry.files, one per line>
<split format: infer from domain slug convention>

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
```

### Step 3 — Implement Inline

Using the BRIEF as scope boundaries:

1. **Read only the FILES listed** — use Read/Grep/Glob to understand current state
2. **Respect CONSTRAINTS** — treat each constraint as a hard rule during implementation
3. **Check DEPENDS ON** — ensure dependent domains are already implemented before proceeding
4. **Implement changes** — use Edit/Write tools to modify only the files in FILES
5. **Run tests** after each significant change:
   ```bash
   node tests/run-all.js
   ```
   Or the project's test command if different.
6. **Report HANDOFF** on completion:

```
RESULT: DONE | BLOCKED | PARTIAL
FILES CHANGED: <list of files modified>
TESTS: PASS | FAIL | SKIPPED
SUMMARY: <one paragraph describing what was implemented>
```

### Step 4 — Scope Enforcement

- Only modify files explicitly listed in the BRIEF FILES section
- If a new file is needed and not listed, add it to `.claude/ontology/index.json` under the domain's `files[]` array
- Do not touch files belonging to other domains unless listed in DEPENDS ON

## Adding a New Domain

Before implementing, the domain must exist in the ontology:

1. Copy `docs/features/_template.md` → `docs/features/<domain>.md`
2. Add `domain_<name>` entry to `.claude/ontology/index.json`
3. Add a row to `docs/features/index.md`
4. Run `npm test` — `validate-ontology.js` enforces consistency
