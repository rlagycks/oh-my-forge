---
name: e2e-rca
description: One-call E2E test execution with persona-based scenario generation, exhaustive failure collection, root cause analysis, and a developer-reviewed fix report. Stops before making any code changes — the developer decides what to fix.
origin: ECC
---

# E2E Root Cause Analysis (e2e-rca)

Run real E2E tests, collect every failure, trace each failure back to its root cause in the codebase, and produce a full analysis report for developer review.

**Core principle:** Analysis and fixing are separate steps. This skill handles analysis only — it ends with a report that the developer reviews before any code is touched.

**Workflow boundary:**
```
[e2e-rca scope]                    [developer decides]
Auto-detect → Run → Analyze ────  Review report → Fix → Verify
                          STOP HERE ↑
```

---

## When to Use

- After implementing a feature — verify nothing broke
- When "it works on my machine" but users report bugs
- Before a release — exhaustive QA pass
- When you suspect there are hidden edge cases

---

## Phase 0: Project Auto-Detection

Before running anything, understand the project. Run these in parallel:

```bash
# Detect package manager and framework
cat package.json | grep -E '"(name|scripts|dependencies|devDependencies)"' -A 30

# Check if Playwright is already installed
ls node_modules/@playwright/test 2>/dev/null && echo "playwright: installed" || echo "playwright: missing"

# Check if test files exist
find . -name "*.spec.ts" -o -name "*.spec.js" -o -name "*.test.ts" | grep -v node_modules | head -20

# Detect dev server port
grep -r "port" vite.config.* next.config.* nuxt.config.* 2>/dev/null | head -5
```

**Framework → dev command → default port mapping:**

| Framework | Dev Command | Default Port |
|-----------|-------------|--------------|
| Next.js | `npm run dev` | 3000 |
| Vite (React/Vue/Svelte) | `npm run dev` | 5173 |
| Nuxt | `npm run dev` | 3000 |
| CRA | `npm start` | 3000 |
| Angular | `npm start` | 4200 |
| SvelteKit | `npm run dev` | 5173 |

If port is customized in config, use that instead.

---

## Phase 0.5: Persona Discovery & Scenario Matrix

Before setting up tests, understand **who uses the app and what they do**. This drives which scenarios to generate — not "cover everything" but "cover the intersections that matter."

### Step 1: Discover roles from codebase

```bash
# Find role/permission definitions
grep -rn "role\|permission\|isAdmin\|isOwner\|subscription" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\." | head -30

# Find route guards / protected routes
grep -rn "withAuth\|ProtectedRoute\|requireAuth\|middleware\|redirect.*login" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -20

# Find auth state shape
grep -rn "interface.*User\|type.*User\|userSchema" src/ --include="*.ts" | grep -v node_modules | head -10
```

From this, build a persona list. Each persona = **Role + State**:

```
DISCOVERED PERSONAS
===================
1. Guest         — not authenticated
2. New User      — authenticated, no data yet (first login)
3. Active User   — authenticated, has data
4. Expired User  — authenticated, subscription/session expired
5. Admin         — elevated permissions
(add/remove based on what the codebase actually shows)
```

### Step 2: Discover critical flows

```bash
# Find top-level routes/pages
find src -type f \( -name "page.tsx" -o -name "*.page.tsx" \) | grep -v node_modules | sed 's|src/app||;s|/page.tsx||' | sort

# Find high-risk operations (data mutation, payment, auth)
grep -rn "POST\|PUT\|DELETE\|PATCH\|mutation\|submit\|checkout\|payment" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\." | head -20
```

Critical flow priority:
```
HIGH:   Authentication (login/logout/session), Payment/checkout, Data mutation (create/delete)
MEDIUM: Core feature flows, Search/filter, Navigation
LOW:    UI details, Read-only views, Already unit-tested logic
```

### Step 3: Build the scenario matrix

Cross-reference personas × flows. Mark each cell:

```
SCENARIO MATRIX
===============
                     | Login | Dashboard | Create | Delete | Admin Panel |
---------------------|-------|-----------|--------|--------|-------------|
Guest                |   ✓   |    ✗→/login|   ✗    |   ✗    |     ✗       |
New User (no data)   |   -   |  empty✓   |   ✓    |   -    |     ✗       |
Active User          |   -   |    ✓      |   ✓    |   ✓    |     ✗       |
Expired User         |   -   |    ✗→gate |   ✗    |   ✗    |     ✗       |
Admin                |   -   |    ✓      |   ✓    |   ✓    |     ✓       |

Legend:
✓  = happy path test
✗  = should be blocked — test that block works correctly
✗→ = should redirect — test redirect destination
empty✓ = empty state — this is a high-risk cell, often buggy
- = not applicable
```

### Step 4: Select scenarios to generate

**Generate tests for:**
- Every `✗` cell (access control boundary — most bugs live here)
- Every `empty✓` cell (empty state rendering — second most common bug)
- `✓` cells in HIGH priority flows only

**Skip for now:**
- `✓` cells in LOW priority flows
- Flows already covered by existing unit tests

### Step 5: Generate scenario test file

```typescript
// tests/e2e/scenarios/[persona]-[flow].spec.ts

// Example: guest-access-control.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Guest — Access Control', () => {
  test('dashboard redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('create page redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/create')
    await expect(page).toHaveURL(/\/login/)
  })
})

// Example: new-user-empty-state.spec.ts
test.describe('New User — Empty State', () => {
  test.beforeEach(async ({ page }) => {
    // Login as new user (no data)
    // Setup: use a test account with no data, or mock the API to return empty
  })

  test('dashboard shows empty state UI, not broken layout', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    // Should show empty state message, not a JS error or broken layout
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible()
  })
})
```

**Auth setup patterns (use the one that fits the project):**

```typescript
// Option A: Cookie/token injection (fast, preferred)
test.use({
  storageState: 'tests/fixtures/auth-states/active-user.json'
})
// Generate with: npx playwright codegen --save-storage=active-user.json

// Option B: Login via UI in beforeEach
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('[data-testid="email"]', process.env.TEST_USER_EMAIL!)
  await page.fill('[data-testid="password"]', process.env.TEST_USER_PASSWORD!)
  await page.click('[data-testid="submit"]')
  await page.waitForURL('/dashboard')
})

// Option C: Mock API responses (no real auth needed)
await page.route('/api/auth/me', route =>
  route.fulfill({ json: { id: '1', role: 'user', name: 'Test User' } })
)
```

---

## Phase 1: Setup (if needed)

### 1a. Install Playwright (if missing)

```bash
npm install -D @playwright/test
npx playwright install chromium  # chromium only for speed; add others if needed
```

### 1b. Create playwright.config.ts (if missing)

Generate a universal config:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,           // sequential for RCA clarity
  retries: 0,                     // no retries during RCA — failures must be real
  reporter: [
    ['json', { outputFile: 'playwright-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:PORT',  // fill in detected port
    trace: 'on',           // always trace for RCA
    screenshot: 'on',      // always screenshot
    video: 'on',           // always video
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'DETECTED_DEV_COMMAND',   // fill in detected command
    url: 'http://localhost:PORT',
    reuseExistingServer: true,
    timeout: 120000,
  },
})
```

Replace `PORT` and `DETECTED_DEV_COMMAND` with values from Phase 0.

### 1c. Auto-generate smoke tests (if no tests exist)

If there are zero E2E tests, generate baseline smoke tests by reading the project:

```bash
# Find pages/routes to generate tests from
find src -name "page.tsx" -o -name "*.page.tsx" -o -name "index.tsx" | grep -v node_modules | head -20
# OR for file-based routing:
ls src/pages/ src/app/ src/routes/ 2>/dev/null
```

Generate one smoke test per top-level route:

```typescript
// tests/e2e/smoke.spec.ts — auto-generated baseline
import { test, expect } from '@playwright/test'

test.describe('Smoke Tests — Auto-generated', () => {
  // Add one test block per discovered route:
  test('/ loads without error', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    const networkFailures: string[] = []
    page.on('response', res => {
      if (res.status() >= 400) networkFailures.push(`${res.status()} ${res.url()}`)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page must load
    expect(page.url()).not.toContain('error')
    expect(await page.title()).not.toBe('')

    // No critical JS errors
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics')
    )
    expect(criticalErrors, `Console errors on /: ${criticalErrors.join(', ')}`).toHaveLength(0)

    // No 5xx errors
    const serverErrors = networkFailures.filter(f => f.startsWith('5'))
    expect(serverErrors, `Server errors on /: ${serverErrors.join(', ')}`).toHaveLength(0)
  })

  // Repeat for /login, /dashboard, etc. — one block per discovered route
})
```

---

## Phase 2: Execute — Full Collection Mode

**Critical settings for RCA:**
- `retries: 0` — real failures only, no lucky retries hiding bugs
- `trace: 'on'` — full trace always, not just on retry
- `screenshot: 'on'` — capture at every step
- Run sequentially — easier to read results

```bash
# Kill any stale dev server first
pkill -f "next dev\|vite\|npm run dev" 2>/dev/null; sleep 1

# Run all tests, capture everything, don't stop on first failure
npx playwright test --reporter=json 2>&1 | tee playwright-run.log

# Parse results immediately
cat playwright-results.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
suites = data.get('suites', [])
def walk(suite, results=[]):
    for spec in suite.get('specs', []):
        for test in spec.get('tests', []):
            status = test['status']
            if status != 'passed':
                results.append({
                    'title': spec['title'],
                    'file': spec['file'],
                    'line': spec['line'],
                    'status': status,
                    'error': test.get('results', [{}])[0].get('error', {}).get('message', ''),
                    'trace': test.get('results', [{}])[0].get('attachments', []),
                })
    for s in suite.get('suites', []):
        walk(s, results)
    return results
failures = walk({'suites': suites})
print(f'Total failures: {len(failures)}')
for i, f in enumerate(failures, 1):
    print(f'\n--- Failure {i} ---')
    print(f'Test: {f[\"title\"]}')
    print(f'File: {f[\"file\"]}:{f[\"line\"]}')
    print(f'Status: {f[\"status\"]}')
    print(f'Error: {f[\"error\"][:300]}')
"
```

---

## Phase 3: Triage — Categorize All Failures

For each failure, classify before analyzing:

### Failure Categories

| Category | Symptom Pattern | Typical Root Cause |
|----------|----------------|-------------------|
| **SELECTOR** | `locator('...') resolved to 0 elements` | Component restructured, class/id changed, data-testid missing |
| **TIMING** | `Timeout exceeded waiting for...` | Async operation not awaited, race condition, slow API |
| **NETWORK** | `net::ERR_*`, `status 4xx/5xx` | API endpoint changed, auth broken, CORS, missing env var |
| **ASSERTION** | `Expected: X, Received: Y` | Logic bug — data wrong, state wrong, rendering wrong |
| **JS_ERROR** | `TypeError`, `ReferenceError` in console | Runtime crash in component |
| **AUTH** | `403`, redirected to `/login` | Session handling broken, token expired |
| **NAVIGATION** | `page.goto` timeout, wrong URL | Route changed, redirect loop |

Build a triage table before diving into RCA:

```
TRIAGE SUMMARY
==============
[SELECTOR]  tests/e2e/login.spec.ts:23  — locator('[data-testid="submit"]') not found
[ASSERTION] tests/e2e/dashboard.spec.ts:45 — Expected "Welcome" got ""
[NETWORK]   tests/e2e/profile.spec.ts:12  — GET /api/user returned 401
...
```

---

## Phase 3.5: Fault Isolation — Frontend vs Backend

Before doing RCA, determine **whose fault it is** for each NETWORK/ASSERTION failure.

This is critical when frontend and backend are in separate repos — you need to know which codebase to fix.

### Step 1: Capture API traffic during tests

Add an API interceptor fixture to collect every request/response:

```typescript
// tests/fixtures/api-capture.ts
import { test as base } from '@playwright/test'

type ApiCall = {
  method: string
  url: string
  requestBody: unknown
  status: number
  responseBody: unknown
  duration: number
}

export const test = base.extend<{ apiLog: ApiCall[] }>({
  apiLog: async ({ page }, use) => {
    const log: ApiCall[] = []

    page.on('request', req => {
      if (req.url().includes('/api/')) {
        req['_startTime'] = Date.now()
      }
    })

    page.on('response', async res => {
      if (!res.url().includes('/api/')) return
      let body: unknown = null
      try { body = await res.json() } catch { body = await res.text().catch(() => null) }
      log.push({
        method: res.request().method(),
        url: res.url(),
        requestBody: (() => { try { return JSON.parse(res.request().postData() || '') } catch { return null } })(),
        status: res.status(),
        responseBody: body,
        duration: Date.now() - (res.request()['_startTime'] ?? 0),
      })
    })

    await use(log)

    // Dump log to file for analysis
    const fs = await import('fs')
    fs.writeFileSync(
      `playwright-test-results/api-log-${Date.now()}.json`,
      JSON.stringify(log, null, 2)
    )
  },
})
```

### Step 2: Run fault isolation analysis

After test execution, read the captured API logs:

```bash
# Find all captured API logs
ls playwright-test-results/api-log-*.json

# Analyze for anomalies
cat playwright-test-results/api-log-*.json | python3 -c "
import json, sys
logs = json.load(sys.stdin)
print(f'Total API calls: {len(logs)}')
print()
for call in logs:
    status = call['status']
    icon = '✓' if status < 400 else ('WARNING:' if status < 500 else '✗')
    print(f'{icon} {call[\"method\"]} {call[\"url\"]} → {status} ({call[\"duration\"]}ms)')
    if status >= 400:
        print(f'  Request body: {json.dumps(call[\"requestBody\"])[:200]}')
        print(f'  Response: {json.dumps(call[\"responseBody\"])[:300]}')
"
```

### Step 3: Classify each API failure

For each failing API call, determine which side owns the bug:

| Signal | Owner | Evidence |
|--------|-------|----------|
| Status 4xx + response matches API spec | **Frontend** | Frontend sent wrong data / wrong auth header |
| Status 4xx + response doesn't match spec | **Backend** | Backend returning wrong error format |
| Status 5xx any | **Backend** | Server-side crash or unhandled case |
| Status 200 + response shape wrong | **Backend** | Wrong fields, missing fields, wrong types |
| Status 200 + response shape correct + UI wrong | **Frontend** | Frontend parsing/rendering bug |
| CORS error | **Backend** (or infra) | Missing CORS headers |
| Timeout / no response | **Backend** or **infra** | Slow query, deadlock, cold start |

### Step 4: Contract mismatch detection

When status is 200 but data looks wrong, compare against the TypeScript types:

```bash
# Find the TypeScript interface/type for this API response
grep -rn "interface.*Response\|type.*Response\|ApiResponse" src/types/ src/api/ --include="*.ts" | grep -i "ENDPOINT_NAME"

# Compare expected shape vs actual response
# Expected (from types):
cat src/types/api.ts | grep -A 20 "UserProfile"

# Actual (from API log):
cat playwright-test-results/api-log-*.json | python3 -c "
import json, sys
logs = json.load(sys.stdin)
for call in logs:
    if 'ENDPOINT_PATH' in call['url'] and call['status'] == 200:
        print('Actual response shape:', list(call['responseBody'].keys()) if isinstance(call['responseBody'], dict) else type(call['responseBody']).__name__)
"
```

**Contract mismatch report format:**

```
CONTRACT MISMATCH: GET /api/user/profile
Frontend expects (TypeScript type):
  { id: string, email: string, name: string, avatar_url: string, notification_settings: object }

Backend returns (actual):
  { id: string, email: string, name: string }

Missing fields: avatar_url, notification_settings
Owner: BACKEND — fields missing from API response
Fix location: backend repo → handler for GET /api/user/profile
```

### Step 5: Output fault isolation summary

Before starting RCA, produce this table:

```
FAULT ISOLATION SUMMARY
========================
Failure 1: tests/e2e/profile.spec.ts:45 — assertion on avatar
  API call: GET /api/user/profile → 200
  Contract match: NO — missing fields: avatar_url, notification_settings
  Owner: BACKEND
  Action: File bug in backend repo / fix backend handler

Failure 2: tests/e2e/login.spec.ts:23 — form submit fails
  API call: POST /api/auth/login → 422
  Contract match: YES — 422 is correct for invalid input
  Actual cause: Frontend sending { username } but API expects { email }
  Owner: FRONTEND
  Action: Fix frontend form field name

Failure 3: tests/e2e/feed.spec.ts:67 — items not rendered
  API call: GET /api/feed → 200, returns correct shape
  UI: items array present but component renders empty state
  Owner: FRONTEND
  Action: RCA in feed component rendering logic
```

### When the bug is in the backend repo

If `Owner: BACKEND`, do not attempt to fix it by patching the frontend. Instead:

1. Document the exact contract mismatch with request/response evidence
2. Identify the backend endpoint: `grep -rn "ENDPOINT_PATH" backend-repo/`
3. If you have access to the backend repo, fix it there
4. If not, output a **backend bug report**:

```markdown
## Backend Bug Report

**Endpoint:** GET /api/user/profile
**Repo:** [backend repo name]
**Evidence:** API log showing missing fields
**Expected:** { id, email, name, avatar_url, notification_settings }
**Actual:** { id, email, name }
**Test failing because of this:** tests/e2e/profile.spec.ts:45
**Suggested fix:** Add avatar_url and notification_settings to SELECT query / response serializer
```

---

## Phase 4: Root Cause Analysis Loop

**For each failure, in order of severity (NETWORK/AUTH > JS_ERROR > ASSERTION > SELECTOR > TIMING):**

### 4a. Read the trace

```bash
# Find trace file for the failing test
ls playwright-test-results/*/trace.zip

# Extract and read the trace actions log
npx playwright show-trace playwright-test-results/test-name/trace.zip
# OR read the raw data:
unzip -p playwright-test-results/test-name/trace.zip trace.trace | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        event = json.loads(line)
        if event.get('type') in ('action', 'log', 'error'):
            print(event)
    except: pass
" 2>/dev/null | head -100
```

Extract from trace:
- Last successful action before failure
- DOM snapshot at failure point
- Network requests made (URLs, status codes, payloads)
- Console errors at failure moment

### 4b. Search the codebase

Based on the failure, search for the relevant code:

```bash
# For SELECTOR failures — find where the element should be
grep -r 'data-testid="TESTID"' src/ --include="*.tsx" --include="*.jsx" --include="*.html"

# For NETWORK failures — find the API handler
grep -r '"ENDPOINT_PATH"' src/ --include="*.ts" --include="*.tsx" | grep -v node_modules

# For ASSERTION failures — find where the data is set/fetched
grep -r 'EXPECTED_TEXT\|FIELD_NAME' src/ --include="*.ts" --include="*.tsx" | grep -v node_modules

# For AUTH failures — find auth middleware/guards
grep -r 'middleware\|withAuth\|ProtectedRoute\|useAuth' src/ --include="*.ts" --include="*.tsx"
```

### 4c. Determine root cause (not symptom)

**RCA template for each failure:**

```
FAILURE: tests/e2e/login.spec.ts:23
SYMPTOM: locator('[data-testid="submit-btn"]') not found
TRACE SHOWS: Page loaded, form visible, but button element absent
CODE SEARCH: src/components/LoginForm.tsx — button has class="submit" but no data-testid
ROOT CAUSE: data-testid was never added to LoginForm's submit button
SCOPE CHECK: Are other forms also missing data-testid? [grep result]
FIX: Add data-testid="submit-btn" to button in LoginForm.tsx
```

Do NOT accept shallow root causes:
- BAD: "element not found" → GOOD: "element not found because component refactor removed the attribute"
- BAD: "timeout" → GOOD: "timeout because API call awaits a missing environment variable on dev"
- BAD: "401 unauthorized" → GOOD: "401 because token refresh logic has a race condition when two requests fire simultaneously"

### 4d. Check scope — same bug elsewhere?

Before fixing, check if the root cause pattern exists in other places:

```bash
# Example: if root cause is missing data-testid on interactive elements
grep -rn "onClick\|onSubmit\|type=\"button\"\|type=\"submit\"" src/ --include="*.tsx" | grep -v "data-testid" | grep -v node_modules | head -20

# Example: if root cause is unhandled API error
grep -rn "fetch\|axios\|useQuery" src/ --include="*.ts" --include="*.tsx" | grep -v "catch\|onError\|error:" | grep -v node_modules | head -20
```

Scope check result goes into the report. Do not fix anything yet.

---

## Phase 5: Final Report — STOP FOR DEVELOPER REVIEW

**This is where the skill ends.** No code is modified. Output the full analysis report and wait for developer decision.

```markdown
# E2E QA Analysis Report — [Project] — [Date]

> Status: ANALYSIS COMPLETE — awaiting developer review
> No code has been changed. Review findings below and decide what to fix.

---

## Execution Summary

- Personas tested: X
- Scenarios run: Y
- Passed: Z (W%)
- Failed: A
- Edge cases observed (tests passed but anomalies found): B

---

## Scenario Matrix Results

|                  | Login | Dashboard | Create | Delete | Admin |
|------------------|-------|-----------|--------|--------|-------|
| Guest            |  ✓    |  FAIL     |  ✓     |   -    |  ✓    |
| New User         |  -    |  FAIL     |  ✓     |   -    |   -   |
| Active User      |  -    |  ✓        |  ✓     |  FAIL  |   -   |
| Admin            |  -    |  ✓        |  ✓     |  ✓     |  FAIL |

---

## Findings — Prioritized

### [CRITICAL] [1] [Short title]

- **Test:** `tests/e2e/scenarios/guest-access.spec.ts:34`
- **Persona:** Guest
- **Symptom:** Dashboard accessible without authentication
- **Fault owner:** FRONTEND
- **Root cause:** `ProtectedRoute` component checks `user !== null` but initial state is `undefined`, not `null` — window between app load and auth check allows access
- **Affected code:** `src/components/ProtectedRoute.tsx:12`
- **Scope:** Same pattern in 3 other routes: `/create`, `/settings`, `/profile`
- **Recommended fix:** Change check to `user != null` (loose equality) or add loading state guard
- **Effort:** Low — single line change, 4 files

---

### [HIGH] [2] [Short title]

- **Test:** `tests/e2e/scenarios/new-user-empty.spec.ts:18`
- **Persona:** New User (no data)
- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'map')` — blank screen
- **Fault owner:** FRONTEND
- **Root cause:** `DashboardList` component assumes `items` is always an array, but API returns `null` on first load for new users
- **Affected code:** `src/components/DashboardList.tsx:24`
- **Scope:** Isolated to this component
- **Recommended fix:** Add null guard: `(items ?? []).map(...)`
- **Effort:** Low

---

### [HIGH] [3] [Short title]

- **Test:** `tests/e2e/scenarios/active-user-delete.spec.ts:52`
- **Persona:** Active User
- **Symptom:** Delete action returns 200 but item remains in UI
- **Fault owner:** BACKEND
- **Root cause:** `DELETE /api/items/:id` returns 200 even when item not found (soft fail) — frontend interprets as success
- **API evidence:** Request: `DELETE /api/items/999`, Response: `{ success: true }`, but item still exists in subsequent GET
- **Affected code (backend):** `api/handlers/items.go:89` (or equivalent)
- **Recommended fix:** Backend should return 404 when item not found; frontend should handle non-2xx as failure
- **Effort:** Medium — requires backend repo change + frontend error handling

---

### [MEDIUM] [4] ...

---

## Edge Cases Observed (tests passed, but anomalies in trace)

These did NOT fail tests but were spotted in traces/console logs:

- `[WARN]` Console shows `Warning: Each child in a list should have a unique "key" prop` on `/dashboard` — won't cause a user-visible bug now, but indicates a latent issue
- `[PERF]` `GET /api/feed` takes 2.8s on first load — above the 2.5s LCP threshold, though no test asserts on it
- `[AUTH]` Token refresh fires twice simultaneously on page load — race condition that currently works by luck

---

## Backend Bug Reports (for backend repo)

### Bug B-1: DELETE /api/items/:id soft-fails silently
**Endpoint:** `DELETE /api/items/:id`
**Expected behavior:** 404 when item not found
**Actual behavior:** 200 with `{ success: true }` regardless
**Evidence:** API log from test run — `playwright-test-results/api-log-[timestamp].json`
**Impact:** Active users cannot delete items; UI shows success but item persists
**Suggested fix:** Add existence check before delete, return 404 if not found

---

## Fix Recommendations — Ordered by Priority

| # | Priority | Owner | File | Change | Effort |
|---|----------|-------|------|--------|--------|
| 1 | CRITICAL | Frontend | `ProtectedRoute.tsx:12` | Fix auth check for `undefined` state | Low |
| 2 | CRITICAL | Frontend | `ProtectedRoute.tsx` (×4 routes) | Same fix in `/create`, `/settings`, `/profile` | Low |
| 3 | HIGH | Frontend | `DashboardList.tsx:24` | Null guard on `items` | Low |
| 4 | HIGH | Backend | `api/handlers/items.go:89` | Return 404 on missing item | Medium |
| 5 | HIGH | Frontend | `ItemList.tsx` | Handle non-2xx delete response | Low |
| 6 | MEDIUM | Frontend | `FeedList.tsx` | Add unique keys to list items | Low |

---

## What to do next

1. Review this report
2. Confirm, modify, or reject each recommended fix
3. Decide ownership for backend items (file ticket or fix directly)
4. Say "apply fix #1, #2, #3" or "apply all frontend fixes" to proceed

**Nothing has been changed yet.**

---

## After developer approves fixes — Update QA Knowledge Layer

Once the developer has reviewed the report and approved fixes, update the persistent knowledge layer so future sessions benefit from this run's findings.

### Step 1: Save this report

```bash
mkdir -p docs/qa/rca-history
# Save this full report to:
# docs/qa/rca-history/YYYY-MM-DD-[project-name].md
```

### Step 2: Update bug-topology.md

For each confirmed bug (developer approved to fix):

1. Add a row to the **Active Bugs** table in `docs/qa/bug-topology.md`:
   ```
   | QA-NNN | src/path/to/File.tsx | LINE | CATEGORY | One-line root cause | DATE | OWNER |
   ```

2. Update the **File → Bug JSON map**:
   ```json
   {
     "src/path/to/File.tsx": ["QA-NNN"]
   }
   ```

3. For each bug the developer decides NOT to fix now, still add it with a note — it's still a known issue.

### Step 3: Update personas.md (if new personas discovered)

If Phase 0.5 found roles not previously in `docs/qa/personas.md`, update the persona table and scenario matrix.

### Step 4: Mark bugs resolved (after fixes are merged)

When a fix is confirmed merged, move the bug from **Active** to **Resolved** in `bug-topology.md` and add the fix commit hash.

---

**After this update:** Future edits to any file in the bug map will automatically surface the relevant bug history via the `qa-context-inject` hook. The code-reviewer and security-reviewer agents will have access to this history when reviewing those files.
```

---

## Universal Compatibility Notes

This skill works across frameworks. Common gotchas by framework:

### Next.js
- Dev server may take 30–60s for cold start — set `webServer.timeout: 120000`
- API routes at `/api/*` — check `pages/api/` or `app/api/`
- Hydration errors appear in console but don't fail navigation

### Vite (React/Vue/Svelte)
- Default port 5173, not 3000
- HMR websocket errors in console — filter these out in smoke tests
- `import.meta.env` variables — ensure `VITE_*` prefix for client-side vars

### Nuxt
- Server-side rendering — check both SSR errors (terminal) and client errors (console)
- `useAsyncData` failures may not throw in test — check response data

### SPA without SSR
- All routes serve `index.html` — navigation errors may silently succeed
- Add explicit URL assertion after every `goto()`

---

## Quick Reference

```bash
# Full RCA run (use this)
npx playwright test --reporter=json && cat playwright-results.json

# Investigate specific failure
npx playwright test --grep "test name" --trace on

# View trace interactively
npx playwright show-trace test-results/*/trace.zip

# Run smoke tests only
npx playwright test tests/e2e/smoke.spec.ts

# Check for console errors across all pages
npx playwright test --grep "smoke"
```
