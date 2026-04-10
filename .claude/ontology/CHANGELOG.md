# Ontology Changelog

Append-only log of changes to `.claude/ontology/index.json`.
Newest entries appear first. Do not edit manually.

---

## 2026-04-10 — index.json [restructured]
**Fields**: $schema, spec, detail, codexWorkerHint (all 13 domains)
**Trigger**: manual fix (CI validation failure)
**Reason**: index.json had $version instead of $schema; all spec fields pointed to domain_*.json instead of docs/features/*.md; codexWorkerHint was missing on all domains. Root cause: 6 new domains were added manually without running validate-ontology.js or reading _schema.json.

---

