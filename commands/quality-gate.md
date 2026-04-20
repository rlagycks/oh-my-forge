# Quality Gate Command

Run the ECC quality pipeline on demand for a file or project scope.

## Usage

`/quality-gate [path|.] [--fix] [--strict]`

- default target: current directory (`.`)
- `--fix`: allow auto-format/fix where configured
- `--strict`: fail on warnings where supported

## Pipeline

1. Detect language/tooling for target.
2. Run formatter checks.
3. Run lint/type checks when available.
4. If `.claude/ontology/index.json` exists **and** `scripts/ci/validate-ontology.js` exists — `PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}; ONTOLOGY_INDEX="$PLUGIN_ROOT/.claude/ontology/index.json"; if [ -f "$ONTOLOGY_INDEX" ] && [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ]; then node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js"; elif [ ! -f "$ONTOLOGY_INDEX" ]; then echo "Ontology: SKIPPED (.claude/ontology/index.json 없음)"; else echo "Ontology: SKIPPED (validate-ontology.js 없음 — ECC 개발 레포 전용)"; fi` 실행.
5. Produce a concise remediation list.

## Notes

This command mirrors hook behavior but is operator-invoked.

## Arguments

$ARGUMENTS:
- `[path|.]` optional target path
- `--fix` optional
- `--strict` optional
