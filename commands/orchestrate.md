---
description: Sequential and tmux/worktree orchestration guidance for multi-agent workflows.
---

# Orchestrate Command

Sequential agent workflow for complex tasks.

## Usage

`/orchestrate [workflow-type] [task-description]`

## Workflow Types

### feature
Full feature implementation workflow:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
Bug investigation and fix workflow:
```
planner -> tdd-guide -> code-reviewer
```

### refactor
Safe refactoring workflow:
```
architect -> code-reviewer -> tdd-guide
```

### security
Security-focused review:
```
security-reviewer -> code-reviewer -> architect
```

## Ontology-Aware Dispatch

워크플로우 실행 전 온톨로지 인덱스를 확인한다.

```bash
cat .claude/ontology/index.json 2>/dev/null
```

인덱스가 존재하는 경우 아래 라우팅 규칙을 적용한다:

| 상황 | 처리 |
|------|------|
| 단일 도메인에 국한된 태스크 | `/codex-delegate <domain_id> <task>`로 직접 위임 |
| 복수 도메인에 걸친 태스크 | 도메인별로 분해 후 순차 위임, 각 단계에 `HANDOFF` 포맷 사용 |
| 아키텍처/설계 결정 | Claude가 직접 처리 — Codex 위임 금지 |
| 보안 민감 코드 | 위임 후 반드시 `code-reviewer` 검수 추가 |

인덱스가 없으면 아래 에이전트 워크플로우를 그대로 실행한다.

---

## Execution Pattern

For each agent in the workflow:

1. **Invoke agent** with context from previous agent
2. **Collect output** as structured handoff document
3. **Pass to next agent** in chain
4. **Aggregate results** into final report

## Handoff Document Format

Between agents, create handoff document:

```markdown
## HANDOFF: [previous-agent] -> [next-agent]

### Context
[Summary of what was done]

### Findings
[Key discoveries or decisions]

### Files Modified
[List of files touched]

### Open Questions
[Unresolved items for next agent]

### Recommendations
[Suggested next steps]
```

## Example: Feature Workflow

```
/orchestrate feature "Add user authentication"
```

Executes:

1. **Planner Agent**
   - Analyzes requirements
   - Creates implementation plan
   - Identifies dependencies
   - Output: `HANDOFF: planner -> tdd-guide`

2. **TDD Guide Agent**
   - Reads planner handoff
   - Writes tests first
   - Implements to pass tests
   - Output: `HANDOFF: tdd-guide -> code-reviewer`

3. **Code Reviewer Agent**
   - Reviews implementation
   - Checks for issues
   - Suggests improvements
   - Output: `HANDOFF: code-reviewer -> security-reviewer`

4. **Security Reviewer Agent**
   - Security audit
   - Vulnerability check
   - Final approval
   - Output: Final Report

## Final Report Format

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Add user authentication
Agents: planner -> tdd-guide -> code-reviewer -> security-reviewer

SUMMARY
-------
[One paragraph summary]

AGENT OUTPUTS
-------------
Planner: [summary]
TDD Guide: [summary]
Code Reviewer: [summary]
Security Reviewer: [summary]

FILES CHANGED
-------------
[List all files modified]

TEST RESULTS
------------
[Test pass/fail summary]

SECURITY STATUS
---------------
[Security findings]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Parallel Execution

For independent checks, run agents in parallel:

```markdown
### Parallel Phase
Run simultaneously:
- code-reviewer (quality)
- security-reviewer (security)
- architect (design)

### Merge Results
Combine outputs into single report
```

For external tmux-pane workers with separate git worktrees, use `PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}; node "$PLUGIN_ROOT/scripts/orchestrate-worktrees.js" plan.json --execute`. The built-in orchestration pattern stays in-process; the helper is for long-running or cross-harness sessions.

When workers need to see dirty or untracked local files from the main checkout, add `seedPaths` to the plan file. ECC overlays only those selected paths into each worker worktree after `git worktree add`, which keeps the branch isolated while still exposing in-flight local scripts, plans, or docs.

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "workers": [
    { "name": "docs", "task": "Update orchestration docs." }
  ]
}
```

To export a control-plane snapshot for a live tmux/worktree session, run:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/orchestration-status.js" .claude/plan/workflow-visual-proof.json
```

The snapshot includes session activity, tmux pane metadata, worker states, objectives, seeded overlays, and recent handoff summaries in JSON form.

## Operator Command-Center Handoff

When the workflow spans multiple sessions, worktrees, or tmux panes, append a control-plane block to the final handoff:

```markdown
CONTROL PLANE
-------------
Sessions:
- active session ID or alias
- branch + worktree path for each active worker
- tmux pane or detached session name when applicable

Diffs:
- git status summary
- git diff --stat for touched files
- merge/conflict risk notes

Approvals:
- pending user approvals
- blocked steps awaiting confirmation

Telemetry:
- last activity timestamp or idle signal
- estimated token or cost drift
- policy events raised by hooks or reviewers
```

This keeps planner, implementer, reviewer, and loop workers legible from the operator surface.

## Arguments

$ARGUMENTS:
- `feature <description>` - Full feature workflow
- `bugfix <description>` - Bug fix workflow
- `refactor <description>` - Refactoring workflow
- `security <description>` - Security review workflow
- `custom <agents> <description>` - Custom agent sequence

## Custom Workflow Example

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Redesign caching layer"
```

## Tips

1. **Start with planner** for complex features
2. **Always include code-reviewer** before merge
3. **Use security-reviewer** for auth/payment/PII
4. **Keep handoffs concise** - focus on what next agent needs
5. **Run verification** between agents if needed
