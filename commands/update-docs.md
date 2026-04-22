# Update Documentation

Sync documentation with the codebase, generating from source-of-truth files.

## Step 1: Identify Sources of Truth

| Source | Generates |
|--------|-----------|
| `package.json` scripts | Available commands reference |
| `.env.example` | Environment variable documentation |
| `openapi.yaml` / route files | API endpoint reference |
| Source code exports | Public API documentation |
| `Dockerfile` / `docker-compose.yml` | Infrastructure setup docs |

## Step 2: Generate Script Reference

1. Read `package.json` (or `Makefile`, `Cargo.toml`, `pyproject.toml`)
2. Extract all scripts/commands with their descriptions
3. Generate a reference table:

```markdown
| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build with type checking |
| `npm test` | Run test suite with coverage |
```

## Step 3: Generate Environment Documentation

1. Read `.env.example` (or `.env.template`, `.env.sample`)
2. Extract all variables with their purposes
3. Categorize as required vs optional
4. Document expected format and valid values

```markdown
| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `LOG_LEVEL` | No | Logging verbosity (default: info) | `debug`, `info`, `warn`, `error` |
```

## Step 4: Update Contributing Guide

Generate or update `docs/CONTRIBUTING.md` with:
- Development environment setup (prerequisites, install steps)
- Available scripts and their purposes
- Testing procedures (how to run, how to write new tests)
- Code style enforcement (linter, formatter, pre-commit hooks)
- PR submission checklist

## Step 5: Update Runbook

Generate or update `docs/RUNBOOK.md` with:
- Deployment procedures (step-by-step)
- Health check endpoints and monitoring
- Common issues and their fixes
- Rollback procedures
- Alerting and escalation paths

## Step 6: Staleness Check

1. Find documentation files not modified in 90+ days
2. Cross-reference with recent source code changes
3. Flag potentially outdated docs for manual review

## Step 7: Ontology Sync Check

`docs/features/` 하위 파일이 변경되었거나 신규 도메인 관련 문서가 추가된 경우:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
ONTOLOGY_INDEX="$PLUGIN_ROOT/.claude/ontology/index.json"
if [ -f "$ONTOLOGY_INDEX" ] && [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ]; then
  node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" 2>/dev/null && echo "ontology OK" || echo "WARNING: ontology 불일치 — /ontology-sync 실행 권장"
elif [ ! -f "$ONTOLOGY_INDEX" ]; then
  echo "Ontology: SKIPPED (.claude/ontology/index.json 없음)"
else
  echo "Ontology: SKIPPED (validate-ontology.js 없음 — OMF 개발 레포 전용)"
fi
```

불일치가 있으면 Summary에 경고를 포함하고 `/ontology-sync` 실행을 안내한다.

## Step 8: Show Summary

```
Documentation Update
──────────────────────────────
Updated:  docs/CONTRIBUTING.md (scripts table)
Updated:  docs/ENV.md (3 new variables)
Flagged:  docs/DEPLOY.md (142 days stale)
Skipped:  docs/API.md (no changes detected)
Ontology: OK (또는 WARNING: /ontology-sync 필요)
──────────────────────────────
```

## Rules

- **Single source of truth**: Always generate from code, never manually edit generated sections
- **Preserve manual sections**: Only update generated sections; leave hand-written prose intact
- **Mark generated content**: Use `<!-- AUTO-GENERATED -->` markers around generated sections
- **Don't create docs unprompted**: Only create new doc files if the command explicitly requests it
