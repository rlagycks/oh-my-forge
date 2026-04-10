# Ontology Changelog

Append-only log of changes to `.claude/ontology/`.
Newest entries appear first. Do not edit manually.

For design decisions, bug root causes, and tool usage patterns
see `decisions[]` array in each `domain_*.json` file,
and the global log at `~/.claude/decisions/index.jsonl`.

---

## 2026-04-10 — _schema.json, decisions system [new]
**Files**: `_schema.json`, `domain_commands.json`, `domain_codex.json`, `scripts/lib/decisions.js`, `commands/decide.md`
**Trigger**: architectural gap — ontology had no mechanism for decision records
**Change**: Added `decisions[]` array schema to each domain (type, summary, why, files, ref). Added query library `scripts/lib/decisions.js`. Recorded 4 bug-fix/design decisions from today's session.
**Query**: `node scripts/lib/decisions.js query --domain domain_commands`

---

## 2026-04-10 — index.json [restructured]
**Fields**: $schema, spec, detail, codexWorkerHint (all 13 domains)
**Trigger**: manual fix (CI validation failure)
**Reason**: index.json had $version instead of $schema; all spec fields pointed to domain_*.json instead of docs/features/*.md; codexWorkerHint was missing on all domains. Root cause: 6 new domains were added manually without running validate-ontology.js or reading _schema.json.

---

