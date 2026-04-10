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
node -e "
const fs=require('fs'),os=require('os'),path=require('path');
const name=process.argv[1]||'plan';
const content=process.argv[2]||'';
if(!content.trim()){process.stderr.write('No content\n');process.exit(1);}
const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+\$/g,'').slice(0,60)||'plan';
const d=new Date(),p=(n)=>String(n).padStart(2,'0');
const ts=d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes());
const dir=path.join(os.homedir(),'.claude','plans');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,slug+'-'+ts+'.md');
fs.writeFileSync(file,content,'utf8');
process.stdout.write(file+'\n');
" "<feature-name>" "<full plan markdown>"
```

Store the returned absolute path as `PLAN_FILE`.

### Step 2 — Detect implementation engine

```bash
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const env = process.env.CLAUDE_IMPL_ENGINE;
if (env === 'claude' || env === 'codex') { console.log(env); process.exit(0); }
for (const f of [path.join(process.cwd(), '.claude/settings.json'), path.join(os.homedir(), '.claude/settings.json')]) {
  try { const s = JSON.parse(fs.readFileSync(f,'utf8')); if (s.implementationEngine === 'claude' || s.implementationEngine === 'codex') { console.log(s.implementationEngine); process.exit(0); } } catch {}
}
const {execFileSync} = require('child_process');
try { execFileSync('which', ['codex'], {stdio:'ignore'}); console.log('codex'); } catch { console.log('claude'); }
"
```

Store result as `ENGINE` ("codex" or "claude").

### Step 3 — Check for ontology index

Read `.claude/ontology/index.json`. If it does not exist → skip to **Step 5 (Fallback delegation)**.

### Step 4 — Map plan phases to ontology domains

Look up `files[]` in each domain entry to match the files mentioned in the confirmed plan. If no phase maps to any domain → skip to **Step 5 (Fallback delegation)**.

For matched domains: delegate per domain respecting `dependsOn` order. Parallel agents for independent domains.

**If ENGINE = "codex"**:

```
Agent({
  description: "Implement domain_X",
  prompt: "Run /codex-delegate domain_X with this plan context:\nplan_file: <PLAN_FILE>\n\n<paste only the relevant phase steps for this domain>"
})
```

**If ENGINE = "claude"**: Use the `Agent` tool to invoke `claude-implement` for each matched domain with the same BRIEF.

Files outside any domain: implement inline.

Skip to **Step 6**.

### Step 5 — Fallback delegation (no ontology or no domain match)

Even without an ontology match, still delegate to the implementation engine.

**If ENGINE = "codex"**: Extract all file paths mentioned in the plan and delegate as a single agent:

```
Agent({
  description: "Implement <feature-name>",
  prompt: "Run /codex-delegate with this plan context:\nplan_file: <PLAN_FILE>\n\nFILES:\n<all file paths from the plan, one per line>\n\nTASK: Implement all phases in the plan file."
})
```

**If ENGINE = "claude"**: Implement directly inline as Claude.

### Step 6 — Report delegation status

```
Implementation summary
──────────────────────────────────────────
Engine: codex | claude
Plan saved: ~/.claude/plans/<feature>-<timestamp>.md
domain_hooks    → /codex-delegate dispatched (ontology match)
mobile/src/...  → /codex-delegate dispatched (fallback)
──────────────────────────────────────────
```
