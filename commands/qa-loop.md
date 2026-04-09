---
description: One-call E2E QA loop — auto-detects project, runs real Playwright tests, collects every failure, performs root cause analysis, and fixes the actual code defects. Not just making tests pass — fixing real bugs.
---

# /qa-loop

Invoke this command to run a complete QA investigation cycle on the current project.

**What this does:**
1. Auto-detects framework, dev server, and port
2. Discovers personas (roles + states) from codebase
3. Builds a scenario matrix (persona × critical flow)
4. Sets up Playwright if not present; generates scenario-based tests if none exist
5. Runs all tests with full tracing — no retries, no hiding
6. Collects every failure + edge cases observed in traces
7. Performs fault isolation (frontend vs backend ownership)
8. Performs root cause analysis per failure (not symptom-level)
9. Outputs a full prioritized report and STOPS

**It does NOT:**
- Modify any source code
- Apply any fixes automatically
- Re-run tests

**After the report:** Review findings, then say which fixes to apply.

## Invoke

```
/qa-loop
```

Optional — pass a target URL if the project runs externally:

```
/qa-loop BASE_URL=https://staging.example.com
```

Optional — scope to a specific flow:

```
/qa-loop --grep "auth"
```

## What the agent does

Follow the `e2e-rca` skill exactly, in order:

**Phase 0** — Detect framework, dev command, port. Read `package.json`.

**Phase 1** — Install Playwright if missing. Create `playwright.config.ts` if missing. Auto-generate `tests/e2e/smoke.spec.ts` from discovered routes if no tests exist.

**Phase 2** — Start dev server. Run full test suite with `retries: 0`, `trace: on`, `screenshot: on`. Parse `playwright-results.json` for all failures.

**Phase 3** — Triage all failures into: SELECTOR / TIMING / NETWORK / ASSERTION / JS_ERROR / AUTH / NAVIGATION.

**Phase 3.5** — Fault Isolation. For every NETWORK/ASSERTION failure, capture the actual API request/response and determine: is the bug in the **frontend**, **backend**, or is it a **contract mismatch**? Do not start fixing until ownership is clear.

**Phase 4** — For each failure:
- Read trace (last action, DOM state, network at failure)
- Search codebase for related code
- Identify root cause (not symptom)
- Check scope — same bug elsewhere?

**Phase 5** — Output full prioritized report. STOP. Do not touch any code.

## Guiding principles

- Analysis and fixing are separate steps. This command ends with a report — the developer decides what to fix.
- A test failure is a symptom. The report identifies the actual root cause, not just the symptom.
- "Element not found" is never the root cause — keep asking why.
- Test all persona × flow intersections that matter, not everything.
- Identify fault ownership (frontend vs backend) before recommending a fix.
- Edge cases observed in traces count even if the test passed.

## Reference

Full workflow defined in skill: `e2e-rca`
