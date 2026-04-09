[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

**English** | [한국어](README.ko.md)

# oh-my-forge

> Every time an agent makes a mistake, change the system so that mistake cannot structurally happen again.

A customized Claude Code harness built on [everything-claude-code](https://github.com/affaan-m/everything-claude-code).  
The core addition: an **ontology-driven structural error prevention system** that makes agent failures self-correcting at the harness level.

---

## Why

[everything-claude-code](https://github.com/affaan-m/everything-claude-code) is a production-ready performance optimization system for AI agent harnesses — skills, instincts, memory persistence, continuous learning, and cross-harness compatibility (Claude Code, Codex, Cowork).

`oh-my-forge` keeps all of that and adds two things on top:

**1. Ontology-driven structural error prevention**

When an agent makes a mistake, the default response is to patch the prompt. That's fragile — the same mistake resurfaces in a new session with a fresh context. `oh-my-forge` treats mistakes as system signals: each error is classified, routed, and converted into a structural change (a new constraint in the ontology, or a failure instinct in the learning pipeline) so the same failure cannot happen again.

**2. Ontology as a GPS for Codex**

Claude Code plans. Codex implements. The ontology index (`index.json`) acts as a coordinate map — Claude reads only the domain index and one spec doc (~3K tokens) instead of exploring the full source tree, then generates a structured BRIEF and hands it to Codex for implementation. This cuts context overhead and keeps Claude in the reasoning role.

Three principles:

1. **Structural prevention over prompt patching** — if a mistake can happen twice, the system is wrong, not the prompt
2. **Ontology + harness co-design** — constraints, file coordinates, and specs are defined together
3. **Every session teaches the system** — learning is automatic, not manual

---

## Core Systems

### 1. Ontology (`/.claude/ontology/`)

The central knowledge graph. Maps logical domains to their files, constraints, and feature specs.

```json
"domain_hooks": {
  "files": ["hooks/hooks.json", "scripts/hooks/..."],
  "spec": "docs/features/hooks.md",
  "constraints": [
    "블로킹 훅(PreToolUse, Stop)은 200ms 이하 — 네트워크 호출 금지",
    "신규 훅은 run-with-flags.js 래퍼를 통해서만 등록"
  ],
  "riskLevel": "high",
  "codexWorkerHint": "workspace-write"
}
```

Each `domain_*` entry defines:
- **files** — which files belong to this domain
- **spec** — the feature doc agents read to understand intent
- **constraints** — rules agents must follow, with optional machine-checkable patterns (`|pattern:keyword`)
- **codexWorkerHint** — `"read-only"` or `"workspace-write"`, tells Codex what role to take
- **riskLevel** — `"high"` triggers stronger warnings from the constraint guard

**Schema:** `/.claude/ontology/_schema.json` validates every domain entry.

---

### 2. Codex Delegation (`/commands/codex-delegate.md`)

The ontology index doubles as a **GPS for Codex**. Instead of giving Codex the full source tree, Claude reads only `index.json` and the relevant spec doc (~3K tokens total), then generates a structured BRIEF for Codex to implement.

```
/codex-delegate domain_hooks "Add ECC_DISABLED_HOOKS support to the PostToolUse handler"
```

What happens:
1. Claude reads `index.json` → finds `domain_hooks` entry (files, constraints, symbols)
2. Claude reads `docs/features/hooks.md` (~3K tokens) → understands the business intent
3. Claude generates a BRIEF with files, constraints, symbols, and handoff format
4. BRIEF is delegated to Codex (`/codex:rescue <BRIEF>` or `codex "<BRIEF>"`)

```
BRIEF
=====
DOMAIN: domain_hooks
TASK: Add ECC_DISABLED_HOOKS support to the PostToolUse handler

FILES:
hooks/hooks.json
scripts/hooks/run-with-flags.js
...

CONSTRAINTS:
블로킹 훅(PreToolUse, Stop)은 200ms 이하 — 네트워크 호출 금지
신규 훅은 run-with-flags.js 래퍼를 통해서만 등록
...

HANDOFF FORMAT:
  RESULT: DONE | BLOCKED | PARTIAL
  FILES CHANGED: <list>
  TESTS: PASS | FAIL | SKIPPED
  SUMMARY: <one paragraph>
```

**When to use:**

| Condition | Action |
|-----------|--------|
| Single-domain bug fix or feature | `/codex-delegate domain_X "task"` |
| Multi-domain task | Decompose first, then delegate each domain |
| Architecture decision | Handle in Claude directly |
| Security-sensitive code | Delegate with `codexWorkerHint: read-only`, then `/code-review` |

---

### 3. Constraint Guard (`/scripts/hooks/constraint-guard.js`)

A `PreToolUse` hook that runs before every `Write`, `Edit`, or `MultiEdit`.

When an agent edits a file in a tracked domain, this hook:
1. Looks up which `domain_*` owns that file
2. Extracts machine-checkable patterns from the domain's `constraints[]`
3. Warns to stderr if the proposed content matches a violation pattern

```
// Constraint format
"No network calls in blocking hooks — 200ms limit|pattern:require('node-fetch')|pattern:require('axios')"
//                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                                  machine-checked patterns
```

- Always exits `0` — never blocks tool execution
- Session-scoped: each warning fires at most once per session
- `riskLevel: "high"` domains get a stronger `⚠ HIGH RISK` header

---

### 3. Error Capture (`/commands/error-capture.md`)

The `/error-capture` command is the entry point for the learning loop.

When an agent makes a mistake, run:
```
/error-capture "hooks script made a direct DB call"
/error-capture scripts/hooks/my-hook.js "added network call without knowing the 200ms limit"
```

The command:
1. **Classifies** the error — ontology gap, harness gap, or both
2. **Routes to the right fix:**
   - Ontology gap → adds a new constraint to `index.json` + updates the feature spec
   - Harness gap → creates a failure instinct file for `continuous-learning-v2`
3. **Outputs a structured report** showing exactly why the same mistake won't happen again

---

### 4. Continuous Learning v2 (`/skills/continuous-learning-v2/`)

Extracts patterns from sessions and promotes them to instincts, then to structural constraints.

Pipeline:
```
session mistake
  → /error-capture
    → failure instinct (yaml)
      → evolve analysis
        → constraint candidate
          → /ontology-sync → domain constraints[]
```

---

## Project Structure

```
oh-my-forge/
├── .claude/
│   └── ontology/
│       ├── _schema.json     # Domain entry validation schema
│       └── index.json       # Domain registry (files, constraints, specs)
├── agents/                  # Specialized subagents for delegation
├── commands/                # Slash commands
│   ├── error-capture.md     # /error-capture — structural error prevention
│   ├── ontology-sync.md     # /ontology-sync — sync ontology
│   ├── evolve.md            # /evolve — promote instincts to structure
│   └── ...
├── hooks/
│   └── hooks.json           # Hook registrations
├── rules/                   # Always-follow guidelines
├── scripts/
│   └── hooks/
│       └── constraint-guard.js  # PreToolUse constraint checker
├── skills/
│   ├── continuous-learning-v2/  # Session → instinct → constraint pipeline
│   └── ...                      # 140+ workflow skills
├── mcp-configs/             # MCP server configurations
└── docs/
    └── features/            # Feature specs linked from ontology domains
```

---

## Commands

### Error Prevention & Codex Delegation

| Command | Description |
|---------|-------------|
| `/error-capture [description]` | Classify a mistake and create a structural fix |
| `/ontology-sync` | Sync ontology index with current codebase |
| `/evolve` | Promote failure instincts to skills, rules, or constraints |
| `/codex-delegate <domain> <task>` | Delegate implementation to Codex using ontology GPS |

### Development

| Command | Description |
|---------|-------------|
| `/plan` | Implementation planning |
| `/tdd` | Test-driven development workflow |
| `/code-review` | Quality review |
| `/build-fix` | Fix build errors |
| `/e2e` | Generate and run E2E tests |

### Session & Learning

| Command | Description |
|---------|-------------|
| `/save-session` | Save current session state |
| `/resume-session` | Resume a previous session |
| `/learn` | Extract patterns from the current session |
| `/skill-create` | Generate a skill from git history |
| `/instinct-status` | Show current instinct summary |

### Orchestration

| Command | Description |
|---------|-------------|
| `/orchestrate` | Multi-agent task orchestration |
| `/loop` | Run a command on a recurring interval |
| `/qa-loop` | Continuous QA loop |

> Full command list: see `/commands/` directory.

---

## Quick Start

### Option 1 — Claude Code plugin marketplace (recommended)

Inside any Claude Code session:

```
/plugin install rlagycks/oh-my-forge
```

That's it. Skills, commands, agents, and hooks are available immediately in the current session. No cloning or build step required.

### Option 2 — Manual install (for contributors or local customization)

```bash
git clone https://github.com/rlagycks/oh-my-forge.git
cd oh-my-forge
yarn install
node scripts/ecc.js install
```

### Verify

After either install method, confirm the plugin is loaded:

```
/plugin list
```

`oh-my-forge` should appear in the list. You can then run any command:

```
/plan
/tdd
/error-capture "description of what went wrong"
```

---

## Getting Started

### Adding a Domain to the Ontology

1. Edit `.claude/ontology/index.json`
2. Add a `domain_*` entry following the schema
3. Run validation:
   ```bash
   node scripts/ci/validate-ontology.js
   ```

### Capturing an Agent Error

```bash
# After an agent makes a mistake
/error-capture "description of what went wrong"

# With file context
/error-capture path/to/file.js "what the agent did wrong here"
```

---

## Based on

[everything-claude-code](https://github.com/affaan-m/everything-claude-code) by [Affaan Mustafa](https://github.com/affaan-m) — MIT License

---

## License

MIT © 2026 Hyochan Kim — see [LICENSE](LICENSE)
