# Contributing to oh-my-forge

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Table of Contents

- [Project Overview](#project-overview)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Adding New Content](#adding-new-content)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting a Bug](#reporting-a-bug)

---

## Project Overview

`oh-my-forge` is a Claude Code plugin — a collection of agents, skills, commands, hooks, and rules that extend Claude Code with production-ready development workflows.

The core system is **ontology-driven structural error prevention**: agent mistakes are classified and converted into structural constraints so the same failure cannot repeat.

---

## Setup

**Prerequisites**: Node.js >= 20, Yarn

```bash
git clone https://github.com/rlagycks/oh-my-forge.git
cd oh-my-forge
yarn install
```

**Verify everything works:**

```bash
node tests/run-all.js
```

All tests should pass before you start making changes.

---

## Project Structure

```
agents/          Subagents for delegation (planner, code-reviewer, tdd-guide, ...)
commands/        Slash commands (/tdd, /plan, /error-capture, ...)
skills/          Workflow knowledge (TDD, security, code review, ...)
hooks/           hooks.json — trigger registrations
rules/           Always-follow guidelines (security, style, testing)
scripts/
  hooks/         Hook implementations (Node.js)
  lib/           Shared utilities
  ci/            CI/validation scripts
tests/           Mirrors scripts/ structure — *.test.js files
docs/
  features/      Feature specs linked from ontology domains
  qa/            Bug topology and RCA history
.claude/
  ontology/      index.json — domain map (files, constraints, specs)
.claude-plugin/  Marketplace metadata
```

---

## Development Workflow

### Branches

- `main` — stable, always green CI
- Feature branches: `feat/<short-name>`
- Bug fixes: `fix/<short-name>`

### Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add /refactor command
fix: handle empty stdin in constraint-guard
docs: update ontology setup guide
chore: bump eslint to 9.x
test: add coverage for package-manager detection
```

Do **not** add `Co-Authored-By: Claude` or any AI attribution to commits.

### Linting

```bash
npx eslint scripts/ tests/
```

ESLint covers `scripts/` and `tests/` only (Markdown files are excluded from automated lint).

---

## Adding New Content

### Agent (`agents/`)

Create a Markdown file with YAML frontmatter:

```markdown
---
name: my-agent
description: One-line description of what this agent does
tools: Read, Grep, Glob, Bash
model: sonnet
---

# My Agent

...agent instructions...
```

### Command (`commands/`)

```markdown
---
description: Short description shown in command picker
---

# /my-command

...command body...
```

### Skill (`skills/`)

```markdown
# Skill Name

## When to Use

...

## How It Works

...

## Examples

...
```

### Hook script (`scripts/hooks/`)

- Keep under 200 lines; extract helpers to `scripts/lib/`
- Always `exit 0` on non-critical errors — never block tool execution unexpectedly
- Route through `run-with-flags.js` so `ECC_HOOK_PROFILE` / `ECC_DISABLED_HOOKS` gating works
- Register the hook in `hooks/hooks.json`
- Add at least one integration test in `tests/hooks/hooks.test.js`

### Ontology domain (`.claude/ontology/index.json`)

```json
"domain_myfeature": {
  "files": ["scripts/hooks/my-hook.js"],
  "spec": "docs/features/my-feature.md",
  "owner": "your-github-handle",
  "constraints": [
    "constraint description"
  ],
  "riskLevel": "low"
}
```

Validate after editing:

```bash
node scripts/ci/validate-ontology.js
```

---

## Testing

```bash
# Run all tests
node tests/run-all.js

# Run a single test file
node tests/lib/utils.test.js
node tests/hooks/hooks.test.js
```

**Rules:**
- New scripts in `scripts/lib/` require a matching test in `tests/lib/`
- New hooks require at least one integration test in `tests/hooks/`
- All tests must pass before opening a PR

---

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `node tests/run-all.js` — all tests must pass
4. Open a PR using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md)
5. Fill in every section of the template

PRs that skip the checklist or break tests will not be merged.

---

## Reporting a Bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

Include:
- What you did
- What you expected
- What actually happened
- Relevant log output or screenshots

---

## Questions

Open a [discussion](https://github.com/rlagycks/oh-my-forge/discussions) or file an issue using the question template.
