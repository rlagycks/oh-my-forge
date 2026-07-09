---
name: prune
description: Delete pending instincts older than 30 days that were never promoted
command: true
---

# Prune Pending Instincts

Remove expired pending instincts that were auto-generated but never reviewed or promoted.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-$(cat "$HOME/.claude/.omf-root" 2>/dev/null || echo "$HOME/.claude")}}"
python3 "$PLUGIN_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" prune
```

## Usage

```
/prune                    # Delete instincts older than 30 days
/prune --max-age 60      # Custom age threshold (days)
/prune --dry-run         # Preview without deleting
```
