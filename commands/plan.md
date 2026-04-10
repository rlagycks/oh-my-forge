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

### Step 1 — Detect implementation engine

```bash
node -e "const {detectImplementationEngine} = require('./scripts/lib/utils'); console.log(detectImplementationEngine())"
```

Store result as `ENGINE` ("codex" or "claude").

### Step 2 — Check for ontology index

Read `.claude/ontology/index.json`. If it does not exist → skip to **Fallback**.

### Step 3 — Map plan phases to ontology domains

Look up `files[]` in each domain entry to match the files mentioned in the confirmed plan. If no phase maps to any domain → skip to **Fallback**.

### Step 4 — Delegate per domain

**If ENGINE = "codex"**: Use the `Agent` tool to invoke `codex-delegate` for each matched domain. Respecting `dependsOn` order from the ontology. Parallel agents for independent domains.

```
Agent({
  description: "Implement domain_X",
  prompt: "Run /codex-delegate domain_X with this plan context:\n<paste the relevant phase steps, risks, file paths from the confirmed plan>"
})
```

**If ENGINE = "claude"**: Use the `Agent` tool to invoke `claude-implement` for each matched domain with the same BRIEF.

Files outside any domain: implement inline.

### Step 5 — Report delegation status

```
Implementation summary
──────────────────────────────────────────
Engine: codex | claude
domain_hooks    → /codex-delegate dispatched
domain_session  → /codex-delegate dispatched
scripts/utils.js → handled inline (not in ontology)
──────────────────────────────────────────
```

### Fallback — No ontology or no domain match

Implement directly as Claude without any delegation.
