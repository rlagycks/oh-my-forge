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
node scripts/lib/decisions.js add \
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
node scripts/lib/decisions.js query --domain domain_commands

# All bug-fixes
node scripts/lib/decisions.js query --type bug-fix

# Decisions touching a specific file
node scripts/lib/decisions.js query --file commands/plan.md

# Decisions since a date
node scripts/lib/decisions.js query --since 2026-04-01

# Free-text search
node scripts/lib/decisions.js query --q "silent failure"

# List domains that have decisions
node scripts/lib/decisions.js list-domains
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
