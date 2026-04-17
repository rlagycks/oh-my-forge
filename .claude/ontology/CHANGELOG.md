# Ontology Changelog

Append-only log of changes to `.claude/ontology/`.
Newest entries appear first. Do not edit manually.

For design decisions, bug root causes, and tool usage patterns
see `decisions[]` array in each `domain_*.json` file,
and the global log at `~/.claude/decisions/index.jsonl`.

---

## 2026-04-18 — domain_hooks [updated]

**Fields**: constraints, failurePatterns, retrieval decay metadata
**Trigger**: ontology-decay-control
**Reason**: Ontology packets now exclude deprecated, stale, superseded, or
expired decisions/failure patterns and sort fresh active entries before applying
profile limits.

---

## 2026-04-14 — domain_hooks [updated]
**Fields**: files, constraints, decisions
**Trigger**: codex-engine-pin-guard
**Reason**: Added the shared implementation-engine helper, recorded session-pinned engine enforcement, and documented the direct `.claude/settings.json` engine-flip block.

---

## 2026-04-14 — domain_codex [updated]
**Fields**: files, constraints, decisions
**Trigger**: codex-handoff-write-contract
**Reason**: Registered the `write=true` handoff contract, added the shared request schema/runtime files, and recorded that dispatch must promote the request artifact to companion `--write`.

---

## 2026-04-13 — domain_codex [updated]
**Fields**: decisions
**Trigger**: dispatch-companion-hybrid-resolution
**Reason**: Recorded the hybrid companion resolution order for Codex dispatch: explicit flag, env override, bounded auto-discovery, then fail-hard.

---

## 2026-04-13 — domain_hooks [updated]
**Fields**: decisions
**Trigger**: prompt-contract-review
**Reason**: Recorded the decision to move the Codex bash guard from flag-shape validation to dispatch admission checks.

---

## 2026-04-13 — domain_codex [updated]
**Fields**: decisions
**Trigger**: prompt-contract-review
**Reason**: Recorded the decision to converge Codex handoffs on a schema-validated dispatch entrypoint.

---

## 2026-04-13 — domain_commands [updated]
**Fields**: decisions
**Trigger**: prompt-contract-review
**Reason**: Recorded the decision that command markdown must document runtime usage rather than assemble Codex handoffs.

---

## 2026-04-13 — domain_hooks [updated]
**Fields**: files, constraints, decisions
**Trigger**: hook-routing-unification
**Reason**: Added shared project-ontology routing helper and recorded the project-root-first rule for routing hooks.

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
