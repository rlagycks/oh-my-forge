# .codex-plugin — Codex Native Plugin for oh-my-forge

This directory contains the **Codex plugin manifest** for oh-my-forge.

## Structure

```text
.codex-plugin/
├── plugin.json        — Codex plugin manifest (name, version, skills ref, default MCP ref)
├── mcp.default.json   — minimal default MCP surface used by the shipped plugin manifest
└── mcp.full.json      — full opt-in MCP bundle for users who want all packaged servers

.mcp.json              — project/root MCP config used outside the default Codex plugin install
```

## What This Provides

- **125 skills** from `./skills/` — reusable Codex workflows for TDD, security,
  code review, architecture, and more
- **Minimal default MCP surface** — the shipped plugin manifest enables no MCP servers by default
- **Opt-in full MCP bundle** — packaged separately for users who want GitHub, Context7, Exa, Memory, Playwright, and Sequential Thinking

## Installation

Codex plugin support is currently in preview. Once generally available:

```bash
# Install from Codex CLI
codex plugin install rlagycks/oh-my-forge

# Or reference locally during development
codex plugin install ./
```

Run this from the repository root so `./` points to the repo root and bundled manifest paths resolve correctly.

## Default vs Opt-In MCP

- `plugin.json` points to `.codex-plugin/mcp.default.json`, which intentionally ships with an empty `mcpServers` object. This reduces the default Codex plugin privilege surface and avoids silently enabling networked or stateful tools on install.
- Users who want the previous bundled behavior can opt into `.codex-plugin/mcp.full.json` from their Codex config or by copying those entries into their own MCP config.

## Full MCP Bundle

| Server | Purpose |
|---|---|
| `github` | GitHub API access |
| `context7` | Live documentation lookup |
| `exa` | Neural web search |
| `memory` | Persistent memory across sessions |
| `playwright` | Browser automation and E2E testing |
| `sequential-thinking` | Step-by-step reasoning |

## Notes

- The `skills/` directory at the repo root is shared between Claude Code (`.claude-plugin/`)
  and Codex (`.codex-plugin/`) — same source of truth, no duplication
- MCP server credentials are inherited from the launching environment (env vars)
- The default plugin manifest does **not** override `~/.codex/config.toml` settings
- The root `.mcp.json` remains available for repo-local workflows and other installers; changing the Codex plugin default does not remove that full config from the repository
