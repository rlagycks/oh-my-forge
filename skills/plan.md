---
description: Codex-first planning and delegation workflow. Plan → confirm → delegate to Codex → review diff. Enforcement hooks block direct source edits and guard session end.
---

# oh-my-forge: Plan (Codex-First Workflow)

## When to Use

Invoke `/oh-my-forge:plan` whenever you are about to implement a feature, fix, or refactor that touches ontology-tracked source files. This skill replaces ad-hoc implementation with a structured, Codex-enforced delegation pipeline.

Use this for:
- New feature implementation
- Bug fixes in tracked source files
- Refactors that span multiple ontology domains
- Any task where you would otherwise write implementation code directly

Do NOT use this for:
- Pure meta edits (agents, skills, commands, hooks, docs)
- Single-line typo fixes in documentation
- Configuration-only changes

## How It Works

### Step 1 — Plan with the Planner Agent

Invoke the `planner` subagent to produce a concrete implementation plan:

```
Agent({
  subagent_type: "planner",
  prompt: "<user's feature request>"
})
```

The plan must include:
- Requirements restatement
- Implementation phases with concrete file paths
- Dependency order between phases
- Risk assessment

**WAIT for user confirmation** before proceeding. Respond with the plan and ask: "Confirm to delegate to Codex, or modify?"

### Step 2 — Save Plan to File

When the user confirms:

```bash
node -e "
const fs=require('fs'),os=require('os'),path=require('path');
const name=process.argv[1]||'plan';
const content=process.argv[2]||'';
if(!content.trim()){process.stderr.write('No content\n');process.exit(1);}
const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'plan';
const d=new Date(),p=(n)=>String(n).padStart(2,'0');
const ts=d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes());
const dir=path.join(os.homedir(),'.claude','plans');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,slug+'-'+ts+'.md');
fs.writeFileSync(file,content,'utf8');
process.stdout.write(file+'\n');
" "<feature-name>" "<full plan markdown>"
```

Store the path as `PLAN_FILE`.

### Step 3 — Detect Engine

```bash
node -e "
const fs=require('fs'),os=require('os'),path=require('path');
const env=process.env.CLAUDE_IMPL_ENGINE;
if(env==='claude'||env==='codex'){console.log(env);process.exit(0);}
for(const f of [path.join(process.cwd(),'.claude/settings.json'),path.join(os.homedir(),'.claude/settings.json')]){
  try{const s=JSON.parse(fs.readFileSync(f,'utf8'));if(s.implementationEngine==='claude'||s.implementationEngine==='codex'){console.log(s.implementationEngine);process.exit(0);}}catch{}
}
const {execFileSync}=require('child_process');
try{execFileSync('which',['codex'],{stdio:'ignore'});console.log('codex');}catch{console.log('claude');}
"
```

### Step 4 — Delegate to Codex (ENGINE = codex)

For each ontology domain touched by the plan, in `dependsOn` order:

```
Agent({
  description: "Implement <domain_key>",
  prompt: "Run /codex-delegate <domain_key> with this plan context:\nplan_file: <PLAN_FILE>\n\n<relevant phase steps for this domain>"
})
```

For independent domains, run agents **in parallel**.

For files not matched to any domain, use a fallback delegation:

```
Agent({
  description: "Implement <feature-name> (fallback)",
  prompt: "Run /codex-delegate with this plan context:\nplan_file: <PLAN_FILE>\n\nFILES:\n<all file paths>\n\nTASK: Implement all phases."
})
```

### Step 5 — Fallback (ENGINE = claude)

If Codex is not available, implement inline as Claude directly. Use `/tdd` for test-first implementation.

### Step 6 — Review Diff (MANDATORY after Codex)

After each `codex-delegate` agent completes:

1. Run `git diff HEAD~1 HEAD` (or `git diff HEAD` if not committed)
2. Review the diff against the plan requirements
3. Run `/code-review` for automated quality checks
4. If issues found: create a new delegation to fix them
5. If clean: commit and summarize to the user

> **Note**: The `post:bash:codex-diff-inject` hook automatically injects the diff into Claude's context after Codex runs. The `stop:diff-review-guard` hook blocks session end if uncommitted Codex changes remain.

### Step 7 — Report

```
Codex-first delegation summary
───────────────────────────────────────────────
Engine : codex
Plan   : ~/.claude/plans/<name>-<ts>.md
───────────────────────────────────────────────
domain_hooks    → /codex-delegate dispatched
domain_codex    → /codex-delegate dispatched
───────────────────────────────────────────────
Diff reviewed   : yes
Code review     : /code-review complete
Status          : ready to commit
```

## Enforcement Hooks

These hooks make the Codex-first policy hard policy, not just a guideline:

| Hook | Type | Trigger | Effect |
|------|------|---------|--------|
| `pre:write-edit:codex-guard` | PreToolUse | Write\|Edit\|MultiEdit | Blocks direct edits to ontology-tracked files when ENGINE=codex. Exit 2. |
| `post:bash:codex-diff-inject` | PostToolUse | Bash | After Codex runs, injects diff + review instruction via hookSpecificOutput. |
| `stop:diff-review-guard` | Stop | Session end | Blocks session end if Codex ran + uncommitted changes remain. Exit 2. |

### Escape Hatch

To bypass the write guard for meta-level edits (hook scripts, skill docs, etc.):

```bash
ECC_BYPASS_CODEX_GUARD=1 # set in environment before running Claude
```

Or set in the terminal session:
```
export ECC_BYPASS_CODEX_GUARD=1
```

### Meta Paths (Always Allowed)

The write guard never blocks these paths regardless of engine:
- `.claude/` — config, ontology, plans
- `scripts/hooks/`, `scripts/lib/` — hook internals
- `agents/`, `skills/`, `commands/`, `hooks/` — plugin meta layer
- `tests/`, `docs/` — test and documentation files
- Root-level `*.md`, `*.json` — project-level config

## Constraints

- Never implement source files directly when ENGINE=codex — always delegate.
- Review the diff before ending any session where Codex ran.
- Do not skip /code-review even when the diff looks clean.
- Ontology domain `dependsOn` order must be respected for parallel agents.
- If a Codex delegation returns BLOCKED status, investigate and re-delegate with a clearer BRIEF.

## BRIEF Format for Codex Delegation

When invoking `/codex-delegate`, structure the BRIEF as:

```
DOMAIN    : <domain_key>
TASK      : <one-sentence description>
FILES     : <comma-separated file paths>
ENDPOINTS : <affected API routes, if any>
MODELS    : <data model names, if any>
SYMBOLS   : <key function/class names>
CONSTRAINTS: <relevant constraints from domain_*.json>
DEPENDS ON: <other domains that must complete first>
PLAN FILE : <PLAN_FILE path>
HANDOFF   : Return: RESULT / FILES CHANGED / TESTS / SUMMARY
```

## Example

**User**: /oh-my-forge:plan Add retry logic to the Codex orchestrator

**Workflow**:
1. Planner produces plan with phases: (1) update orchestrator, (2) add tests
2. User confirms
3. Plan saved to `~/.claude/plans/codex-retry-20260411-1430.md`
4. Engine detected: codex
5. Domain match: `domain_codex` → delegate via `/codex-delegate domain_codex`
6. Codex runs → post hook injects diff → Claude reviews
7. `/code-review` passes → commit → session ends cleanly
