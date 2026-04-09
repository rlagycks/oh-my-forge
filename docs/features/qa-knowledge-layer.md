# QA Knowledge Layer

> Domain: `domain_qa`
> Load policy: **on-demand** — not always in context
> Load triggers: `/qa-loop`, `e2e-rca` skill, `qa-context-inject` hook (file match)

The QA knowledge layer is a shared memory system across all workflows. It stores persona definitions, bug history, and RCA records that any agent can read when working on components with known issues.

---

## Architecture

```
/qa-loop (runs 2-3x/month)
    │
    ├── Phase 0.5: Discover personas → writes docs/qa/personas.md
    ├── Phase 3.5: Fault isolation → classifies FRONTEND/BACKEND/CONTRACT
    ├── Phase 5: Final report → developer reviews
    │
    └── [After developer approves fixes]
         └── Update docs/qa/bug-topology.md
             └── qa-context-inject hook activates for future edits
```

```
[Any workflow editing source files]
    │
    └── PreToolUse:Edit fires qa-context-inject.js
         ├── Reads docs/qa/bug-topology.md (JSON map)
         ├── If file has bug history → injects context via stderr
         └── Always exits 0 — never blocks
```

---

## Files

### `docs/qa/personas.md`

Living registry of discovered personas. Rebuilt by Phase 0.5 of `e2e-rca` each run.
Contains the Role × State matrix and auth fixture locations.

### `docs/qa/bug-topology.md`

Maps source files to bug IDs. Two sections:
- **Active bugs** — unresolved, found in last QA run
- **Resolved bugs** — history with fix commit
- **File → Bug map** — JSON block consumed by `qa-context-inject.js`
- **Pattern clusters** — recurring root causes across multiple bugs

### `docs/qa/rca-history/`

One file per `/qa-loop` run. Full Phase 5 report preserved here.
Naming: `YYYY-MM-DD-[project].md`

### `scripts/hooks/qa-context-inject.js`

PreToolUse hook (Write|Edit|MultiEdit). On-demand context injection.

**How it works:**
1. Reads `tool_input.file_path` from stdin JSON
2. Loads `docs/qa/bug-topology.md` and parses the JSON file→bug map
3. If the edited file has known bugs → writes a warning to stderr
4. Always exits 0, always passes through the input unchanged

**Token cost:** ~0 when no match. ~200-400 tokens when match found (bug summary injected as context). Not loaded unless a file in the bug map is edited.

### `tests/fixtures/api-capture.ts`

Playwright fixture for API traffic capture during tests. Used in Phase 3.5 for fault isolation. Logs all `/api/*` requests/responses to `playwright-test-results/api-log-[timestamp].json`.

---

## Cross-Workflow Intelligence

The QA knowledge layer is readable by other agents — but only when relevant:

### code-reviewer

When reviewing files that appear in `bug-topology.md`, the code-reviewer should:
1. Check if the fix correctly addresses the root cause (not just the symptom)
2. Verify scope — did the fix address all instances found in Phase 4d?
3. Confirm the bug pattern cluster hasn't reappeared elsewhere

To trigger: reference `domain_qa` spec when reviewing files with QA history.

### security-reviewer

Contract mismatch bugs (FRONTEND/BACKEND ownership unclear) often indicate auth boundary issues. When `bug-topology.md` has AUTH-category bugs in the file being reviewed, load `domain_qa` spec for context.

### codex-delegate

After developer approves fixes from the report, delegate bounded tasks to Codex with:
- The specific finding (ID, file, line, root cause)
- The recommended fix from Phase 5
- The scope check result (how many files to touch)

Codex reads `domain_qa` spec to understand the full context.

---

## Ontology Integration

Entry in `.claude/ontology/index.json`:

```json
"domain_qa": {
  "files": [...],
  "spec": "docs/features/qa-knowledge-layer.md",
  "owner": "qa",
  "loadPolicy": "on-demand",
  "loadTriggers": ["/qa-loop", "e2e-rca skill", "file matches bug-topology entries"]
}
```

`loadPolicy: on-demand` means this domain is NOT injected in every session.
It only surfaces when:
- `/qa-loop` is invoked (e2e-rca skill reads it explicitly)
- `qa-context-inject` hook fires because a file in the bug map is being edited

---

## Maintenance

### After each /qa-loop run

1. Save the Phase 5 report to `docs/qa/rca-history/YYYY-MM-DD-[project].md`
2. For each confirmed bug (developer approved), add a row to `docs/qa/bug-topology.md`
3. Update the File → Bug JSON map in `bug-topology.md`
4. For resolved bugs, move them from Active to Resolved section with fix commit

### When to regenerate personas.md

- When new roles are added to the application
- When auth flow changes significantly
- Automatically on each `/qa-loop` run (Phase 0.5 rewrites it)

### When to trim rca-history/

Keep the last 6 months. Archive older files to `docs/qa/rca-history/archive/` if needed.
The hook only reads `bug-topology.md` — not history files — so trimming is safe.

---

## Token Budget

| Event | Tokens consumed | Frequency |
|-------|----------------|-----------|
| /qa-loop run (full e2e-rca) | ~4,200 | 2-3×/month |
| qa-context-inject hit (file match) | ~200-400 | Per edit of buggy file |
| qa-context-inject miss (no match) | ~0 | All other edits |
| code-reviewer reading domain_qa spec | ~800 | When reviewing QA-flagged files |
| index.json overhead (domain_qa entry) | +85 tokens | Every session |

The 85-token overhead in `index.json` is the only always-on cost.
All other loading is triggered by actual usage.
