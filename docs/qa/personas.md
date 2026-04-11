# QA Personas Registry

> Maintained by: e2e-rca skill (Phase 0.5)
> Updated: each time /qa-loop runs
> Format: Role × State matrix — auto-discovered from codebase

This file is the living registry of personas used in QA test generation.
Each persona represents a real user archetype with a specific role and state.

---

## Project: [PROJECT_NAME]

Last updated: [DATE]
Discovered from: [REPO_PATH]

---

## Discovered Personas

| # | Persona | Role | State | Auth | Key Characteristics |
|---|---------|------|-------|------|---------------------|
| 1 | Guest | anonymous | unauthenticated | none | No session, no data, should see public content only |
| 2 | New User | user | authenticated, empty | token | First login, no data yet — empty state paths |
| 3 | Active User | user | authenticated, has data | token | Normal usage, populated data |
| 4 | Admin | admin | authenticated, has data | token+elevated | Access to all areas including admin panel |

> Add/remove rows based on what the codebase actually reveals.
> Run Phase 0.5 of e2e-rca to regenerate.

---

## Auth Fixtures

Location: `tests/fixtures/auth-states/`

| Persona | Fixture File | How to Regenerate |
|---------|-------------|-------------------|
| Guest | (none) | — |
| New User | `new-user.json` | `npx playwright codegen --save-storage=tests/fixtures/auth-states/new-user.json` |
| Active User | `active-user.json` | `npx playwright codegen --save-storage=tests/fixtures/auth-states/active-user.json` |
| Admin | `admin.json` | `npx playwright codegen --save-storage=tests/fixtures/auth-states/admin.json` |

---

## Scenario Matrix

Last run: [DATE]
Tool: e2e-rca Phase 0.5

```
                    | Login | Dashboard | Create | Delete | Settings | Admin |
--------------------|-------|-----------|--------|--------|----------|-------|
Guest               |   ✓   |    ✗→     |   ✗→   |   ✗→   |    ✗→    |   ✗→  |
New User (empty)    |   -   |  empty✓   |   ✓    |   -    |    ✓     |   ✗   |
Active User         |   -   |    ✓      |   ✓    |   ✓    |    ✓     |   ✗   |
Admin               |   -   |    ✓      |   ✓    |   ✓    |    ✓     |   ✓   |

Legend:
✓  = happy path
✗  = should be blocked
✗→ = should redirect
empty✓ = empty state (high-risk)
- = not applicable
```

> Regenerate this matrix by running /qa-loop
