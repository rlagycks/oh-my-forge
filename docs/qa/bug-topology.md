# Bug Topology

> Maintained by: e2e-rca skill (Phase 5, after developer approval)
> Updated: when developer approves fixes from /qa-loop report
> Purpose: Cross-workflow memory — used by code-reviewer, security-reviewer, and future QA runs

This file maps source files to known bug history.
When any agent edits a file listed here, the qa-context-inject hook surfaces the relevant history.

---

## Active Bugs (unresolved)

| ID | File | Line | Category | Root Cause Summary | Found | Owner |
|----|------|------|----------|--------------------|-------|-------|
| — | — | — | — | No active bugs recorded yet | — | — |

---

## Resolved Bugs (history)

| ID | File | Root Cause Summary | Fixed Date | Fix Commit |
|----|------|--------------------|-----------|-----------|
| — | — | No resolved bugs yet | — | — |

---

## File → Bug Map

Used by `qa-context-inject.js` hook. Format: `filepath: [bug-ids]`

```json
{}
```

---

## Adding a new bug record

After developer approves fixes from /qa-loop, update this file with:

```markdown
| QA-001 | src/components/ProtectedRoute.tsx | 12 | AUTH | Auth check uses `=== null` but initial state is `undefined` | 2026-04-05 | FRONTEND |
```

And update the JSON map:
```json
{
  "src/components/ProtectedRoute.tsx": ["QA-001"]
}
```

The hook will inject this context when any agent edits `ProtectedRoute.tsx`.

---

## Pattern Clusters

Recurring root cause patterns across multiple bugs. Used to guide future code reviews.

| Pattern | Occurrences | Affected Files | Description |
|---------|-------------|----------------|-------------|
| — | — | — | No patterns detected yet |

> Patterns are added manually after 2+ bugs share the same root cause type.
