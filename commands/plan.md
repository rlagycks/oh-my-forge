---
description: Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# Plan Command

This command invokes the **planner** agent to create a comprehensive implementation plan before writing any code.

## What This Command Does

1. **Restate Requirements** - Clarify what needs to be built
2. **Identify Risks** - Surface potential issues and blockers
3. **Create Step Plan** - Break down implementation into phases
4. **Wait for Confirmation** - MUST receive user approval before proceeding

## When to Use

Use `/plan` when:
- Starting a new feature
- Making significant architectural changes
- Working on complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## How It Works

The planner agent will:

1. **Analyze the request** and restate requirements in clear terms
2. **Break down into phases** with specific, actionable steps
3. **Identify dependencies** between components
4. **Assess risks** and potential blockers
5. **Estimate complexity** (High/Medium/Low)
6. **Present the plan** and WAIT for your explicit confirmation

## Example Usage

```
User: /plan I need to add real-time notifications when markets resolve

Agent (planner):
# Implementation Plan: Real-Time Market Resolution Notifications

## Requirements Restatement
- Send notifications to users when markets they're watching resolve
- Support multiple notification channels (in-app, email, webhook)
- Ensure notifications are delivered reliably
- Include market outcome and user's position result

## Implementation Phases

### Phase 1: Database Schema
- Add notifications table with columns: id, user_id, market_id, type, status, created_at
- Add user_notification_preferences table for channel preferences
- Create indexes on user_id and market_id for performance

### Phase 2: Notification Service
- Create notification service in lib/notifications.ts
- Implement notification queue using BullMQ/Redis
- Add retry logic for failed deliveries
- Create notification templates

### Phase 3: Integration Points
- Hook into market resolution logic (when status changes to "resolved")
- Query all users with positions in market
- Enqueue notifications for each user

### Phase 4: Frontend Components
- Create NotificationBell component in header
- Add NotificationList modal
- Implement real-time updates via Supabase subscriptions
- Add notification preferences page

## Dependencies
- Redis (for queue)
- Email service (SendGrid/Resend)
- Supabase real-time subscriptions

## Risks
- HIGH: Email deliverability (SPF/DKIM required)
- MEDIUM: Performance with 1000+ users per market
- MEDIUM: Notification spam if markets resolve frequently
- LOW: Real-time subscription overhead

## Estimated Complexity: MEDIUM
- Backend: 4-6 hours
- Frontend: 3-4 hours
- Testing: 2-3 hours
- Total: 9-13 hours

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
```

## Important Notes

**CRITICAL**: The planner agent will **NOT** write any code until you explicitly confirm the plan with "yes" or "proceed" or similar affirmative response.

If you want changes, respond with:
- "modify: [your changes]"
- "different approach: [alternative]"
- "skip phase 2 and do phase 3 first"

## Integration with Other Commands

- Use `/tdd` to implement with test-driven development (when not delegating)
- Use `/build-fix` if build errors occur
- Use `/code-review` to review completed implementation

> **Need deeper planning?** Use `/prp-plan` for artifact-producing planning with PRD integration, codebase analysis, and pattern extraction. Use `/prp-implement` to execute those plans with rigorous validation loops.

## Related Agents

This command invokes the `planner` agent provided by ECC.

For manual installs, the source file lives at:
`agents/planner.md`

## Post-Confirmation: Claude Delegation Protocol

**IMPORTANT**: The planner sub-agent terminates after presenting the plan. When the user confirms, YOU (the main Claude reading this command) must execute delegation — not the planner agent.

When the user responds with "yes", "proceed", "승인", or similar affirmative:

### Step 1 — Save plan to file

Extract the feature name from the plan title (e.g. "Implementation Plan: Real-Time Notifications" → "real-time-notifications") and save the full plan content to `~/.claude/plans/`:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/lib/save-plan.js" "<feature-name>" --content "<full plan markdown>"
```

Store the returned absolute path as `PLAN_FILE`.

### Step 2 — Detect implementation engine

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node -e "const { detectImplementationEngine } = require(process.argv[1]); console.log(detectImplementationEngine())" "$PLUGIN_ROOT/scripts/lib/utils.js"
```

Store result as `ENGINE` ("codex" or "claude").

### Step 3 — Build a Route with the Shared Handoff Runtime

Use `scripts/lib/codex-handoff.js` as the single source of truth for plan routing and request construction.

This runtime owns:
- `createPlanRoute` — route the confirmed file list against the project-local ontology
- `validateHandoff` — reject malformed requests before delegation
- `buildBrief` — generate the shared BRIEF format
- `dispatchHandoff` / `dispatch --request-file` — generate the BRIEF, invoke Codex, and parse the result inside the runtime
- `parseCodexResult` — reject Codex output that does not contain `RESULT:`
- `formatImplementationSummary` — produce the final status report

The shared handoff contract also carries:
- `problemOneLine`, `successCriteria`, `completionChecks`
- result-side `EVIDENCE`, `FALSE NORMAL CHECKS`, `OPEN RISKS`, `NEXT ACTION`

For routing, treat `process.cwd()` as the active project root.

- Do NOT use `CLAUDE_PLUGIN_ROOT` to decide whether the current project has an ontology.
- Extract the file paths mentioned in the confirmed plan, then pass them into `createPlanRoute`.
- If `validateHandoff` fails for any generated request, stop and report `BLOCKED`.
- Codex implementation handoffs must validate with `write = true`; read-only request artifacts are invalid for this flow.
- `domain-less `/codex-delegate` calls are invalid`; use fallback rescue instead.
- If `ENGINE = "codex"` and you do not have a routable Codex handoff, do NOT silently switch to Claude implementation.

Example CLI usage:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/lib/codex-handoff.js" route \
  --engine "$ENGINE" \
  --routing-root "$PWD" \
  --plan-file "$PLAN_FILE" \
  --task "<one-sentence implementation task>" \
  --files "src/a.js,src/b.js"
```

### Step 4 — Execute the Generated Route via Dispatch

If `createPlanRoute` returns `route = "claude-inline"`:
- implement inline as Claude

If `createPlanRoute` returns Codex handoffs:
- write each handoff request JSON to a temp file
- dispatch it through the shared runtime:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/lib/codex-handoff.js" dispatch \
  --request-file "<handoff-request.json>"
```

- `source = "plan-auto"` handoffs must stay foreground
- dispatch adds `--write` from the validated request artifact; do not craft or run a read-only Codex implementation handoff
- do NOT call `codex-companion.mjs task ...` directly from this flow
- if the default companion resolution is wrong in your environment, override it with `--companion-path`
- do NOT treat `TESTS: PASS` alone as completion; require the result-side `EVIDENCE`, `FALSE NORMAL CHECKS`, and `NEXT ACTION`

For matched domains, respect `dependsOn` order from `createPlanRoute`. Files outside any matched domain must go through fallback rescue rather than a domain-less `/codex-delegate`.

If `ENGINE = "codex"` but the route state is `BLOCKED`, report `BLOCKED` clearly. Do NOT silently switch to Claude implementation after Codex routing fails.

### Step 5 — Validate Result and Report Status

Automatic `/plan` implementation must use a foreground Codex handoff. Background mode is manual-only. If you intentionally use `/codex:rescue --background` outside this flow, report it as `DISPATCHED` only; do not claim the implementation completed until `/codex:result` confirms it.

```
Implementation summary
──────────────────────────────────────────
State: COMPLETED | DISPATCHED | BLOCKED
Engine: codex | claude
Routing root: <process.cwd()>
Plan saved: ~/.claude/plans/<feature>-<timestamp>.md
Ontology: project-local match | none
domain_hooks    → /codex-delegate completed (ontology match)
mobile/src/...  → /codex:rescue completed (fallback)
──────────────────────────────────────────
```
