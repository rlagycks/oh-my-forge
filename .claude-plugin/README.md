# .claude-plugin — Claude Code Plugin Metadata for oh-my-forge

This directory contains the Claude Code plugin metadata that is published with
`oh-my-forge`.

## Structure

```text
.claude-plugin/
├── plugin.json       Claude Code plugin manifest
└── marketplace.json  Marketplace metadata and published plugin version
```

## What This Provides

- Shared `skills/`, `commands/`, `agents/`, and `hooks/` content from the repo root
- Marketplace metadata that stays version-aligned with `package.json`
- Claude Code plugin install metadata without duplicating the source content

## Notes

- The plugin content lives at the repository root; this directory only contains
  Claude-specific manifest metadata.
- `.codex-plugin/` carries the parallel Codex-native packaging metadata.
- Release validation checks this README because `package.json` includes it in the
  published file list.
