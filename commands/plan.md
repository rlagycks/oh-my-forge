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

### Step 3 — Resolve routing root and project ontology

For implementation routing, treat `process.cwd()` as the active project root.

- Check `process.cwd()/.claude/ontology/index.json` to decide whether the current project has an ontology.
- Do NOT use `CLAUDE_PLUGIN_ROOT` to decide whether the current project has an ontology. `CLAUDE_PLUGIN_ROOT` points at the installed ECC plugin copy and can create false matches.
- If the project ontology file is missing, skip domain routing and go to **Step 5 (Codex fallback)**.

### Step 4 — Build project fileMap and map plan phases to domains

Load the project-local ontology index from `process.cwd()/.claude/ontology/index.json` and build a `fileMap` from each domain's `files[]`.

- Match the file paths mentioned in the confirmed plan against that project-local `fileMap`.
- If no mentioned file maps to any domain, treat this as a routing miss and skip to **Step 5 (Codex fallback)**.
- This check prevents the failure chain `resolver mismatch → wrong root → fileMap miss → guard miss → Claude direct implementation`.
- If `ENGINE = "codex"` and you do not have a project-local ontology match, do NOT silently switch to Claude implementation.

For matched domains: delegate per domain respecting `dependsOn` order. Parallel agents for independent domains.

**If ENGINE = "codex"**:

```
Agent({
  description: "Implement domain_X",
  prompt: "Run /codex-delegate domain_X with this plan context:\nplan_file: <PLAN_FILE>\n\n<paste only the relevant phase steps for this domain>\n\nThis automatic /plan flow expects a foreground Codex result in the same control flow. Do not switch this handoff to background rescue."
})
```

**If ENGINE = "claude"**: Use the `Agent` tool to invoke `claude-implement` for each matched domain with the same BRIEF.

Files outside any matched domain:
- `ENGINE = "claude"` → implement inline
- `ENGINE = "codex"` → send them through **Step 5 (Codex fallback)** instead of implementing them inline

Skip to **Step 6**.

### Step 5 — Codex fallback (no ontology or no fileMap match)

Even without an ontology match, still delegate to the implementation engine.

**If ENGINE = "codex"**: Extract all file paths mentioned in the plan and delegate directly to Codex as a single rescue task. Do not route this case through `/codex-delegate`, because `/codex-delegate` requires a concrete domain id.

```
Agent({
  description: "Implement <feature-name>",
  prompt: "Run /codex:rescue --wait --fresh with this plan context:\nplan_file: <PLAN_FILE>\n\nFILES:\n<all file paths from the plan, one per line>\n\nTASK: Implement all phases in the plan file.\n\nThis is a fallback because the current project has no domain/fileMap route for the files above. Return the final Codex result in the same thread."
})
```

**If ENGINE = "claude"**: Implement directly inline as Claude.

If `ENGINE = "codex"` but rescue cannot be started, report `BLOCKED` clearly. Do NOT silently switch to Claude implementation after Codex routing fails.

### Step 6 — Report delegation status

Automatic `/plan` implementation must use a foreground Codex handoff. If you intentionally use `/codex:rescue --background` outside this flow, report it as `DISPATCHED` only; do not claim the implementation completed until `/codex:result` confirms it.

```
Implementation summary
──────────────────────────────────────────
State: COMPLETED | DISPATCHED | BLOCKED
Engine: codex | claude
Routing root: <process.cwd()>
Plan saved: ~/.claude/plans/<feature>-<timestamp>.md
Ontology: project-local match | none
domain_hooks    → /codex-delegate completed (ontology match)
mobile/src/...  → /codex:rescue --wait completed (fallback)
──────────────────────────────────────────
```
