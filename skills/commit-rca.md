---
description: Root-cause analysis for fix commits. Reads the RCA bundle, identifies why the issue was missed in the original design, then updates ontology constraints and proposes enforcement hooks.
---

# Commit RCA (Root Cause Analysis)

## When to Use

Invoked automatically via `hookSpecificOutput` after Claude detects a fix-type commit or PR:
- `fix:` — bug fix
- `fix(gap):` — missing design element that caused a bug
- `fix(design):` — design mistake corrected
- `hotfix:` — urgent patch

**Always run in an isolated Agent** (isolation: worktree) — never inline in the main session.

## How It Works

### Step 1 — Load the RCA Bundle

Read the bundle file path provided in the hookSpecificOutput:

```bash
cat <bundle-path>
```

The bundle contains:
- `commitMessage` — the fix commit or PR title
- `gitDiff` — the full unified diff
- `changedFiles` — list of modified files
- `recentDecisions` — last 20 entries from `~/.claude/decisions/index.jsonl`
- `affectedDomains` — matched ontology domains with their current `constraints[]`
- `gitLog` — recent commit history

### Step 2 — Root Cause Analysis

Answer these questions using the bundle:

1. **What broke?** — Describe the symptom from the diff and commit message.
2. **Where in the design was this missed?** — Which domain owned this code? What was missing from `constraints[]` or the spec?
3. **Why was it missed?** — Classification:
   - `spec-gap` — the domain spec never mentioned this requirement
   - `constraint-gap` — spec existed but no machine-checkable constraint enforced it
   - `harness-gap` — no hook/guard existed to catch the pattern at write-time
   - `decision-gap` — the design decision was made but not recorded
   - `test-gap` — no test covered this path
4. **What would have caught it?** — A constraint pattern, a new hook, a test, or a spec addition?

### Step 3 — Update Ontology Constraints

For each affected domain in `affectedDomains`:

```bash
# Read the current domain file
cat .claude/ontology/domain_<name>.json
```

Add to `constraints[]` in the domain file. Use the machine-checkable format when possible:

```json
{
  "constraints": [
    "existing constraint",
    "new human-readable constraint description|pattern:keyword_to_detect"
  ]
}
```

- The text before `|pattern:` is the human-readable rule.
- Each `|pattern:keyword` is checked by `constraint-guard.js` at write-time.
- Add multiple `|pattern:` suffixes if multiple keywords indicate the violation.

### Step 4 — Record the Decision

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/lib/decisions.js" add \
  --domain <domain_key> \
  --type bug-fix \
  --summary "<one-line: what was wrong>" \
  --why "<root cause classification + explanation>" \
  --files "<comma-separated changed files>" \
  --prevention "<constraint or hook that would have caught this>"
```

### Step 5 — Propose Enforcement (if harness-gap)

If the root cause is `harness-gap` (no hook existed to catch the pattern), create a proposal file:

```bash
# Create proposal at docs/rca/hooks/<domain>-<date>.md
```

The proposal should include:
- What pattern to detect (PreToolUse or PostToolUse)
- Which tool event to match
- Draft implementation sketch
- Link to the fix commit

### Step 6 — Summary Output

Write a brief summary to stderr:

```
[commit-rca] RCA complete
  Commit: <message>
  Root cause: <classification>
  Domains updated: <list>
  New constraints: <count>
  Decision recorded: <id>
  Hook proposal: <path or "none needed">
```

## Constraints

- Never modify `index.json` directly — only update `domain_*.json` files.
- Constraint patterns must be lowercase and match exact substrings (case-insensitive check).
- Do not add constraints that are already present.
- Exit cleanly even if git commands fail (repo may be in detached HEAD state).
- This skill runs in an isolated worktree — do not push changes; leave them for the main session to review and commit.

## Example

**Commit**: `fix(gap): add sandbox_mode validation before codex agent spawn`

**RCA output**:
- Root cause: `constraint-gap` — `domain_codex` had no constraint preventing sandbox_mode omission
- New constraint added to `domain_codex.json`:
  ```
  "codex 에이전트 spawn 시 sandbox_mode 필드 필수|pattern:sandbox_mode"
  ```
- Decision recorded: `dec-20260411-x7k`
