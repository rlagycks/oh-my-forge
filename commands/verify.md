# Verification Command

Run comprehensive verification on current codebase state.

## Instructions

Execute verification in this exact order:

1. **Build Check**
   - Run the build command for this project
   - If it fails, report errors and STOP

2. **Type Check**
   - Run TypeScript/type checker
   - Report all errors with file:line

3. **Lint Check**
   - Run linter
   - Report warnings and errors

4. **Test Suite**
   - Run all tests
   - Report pass/fail count
   - Report coverage percentage

5. **Ontology Validation** (`.claude/ontology/index.json`이 있는 경우)
   - `PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}; if [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ]; then node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js"; else echo "Ontology: SKIPPED (validate-ontology.js 없음 — ECC 개발 레포 전용)"; fi` 실행
   - `index.json`  `docs/features/*.md`  실제 파일 정합성 확인
   - 실패 시 `/ontology-sync --check`로 원인 파악 안내

6. **Console.log Audit**
   - Search for console.log in source files
   - Report locations

7. **Git Status**
   - Show uncommitted changes
   - Show files modified since last commit

## Output

Produce a concise verification report:

```
VERIFICATION: [PASS/FAIL]

Build:     [OK/FAIL]
Types:     [OK/X errors]
Lint:      [OK/X issues]
Tests:     [X/Y passed, Z% coverage]
Ontology:  [OK/FAIL/SKIPPED]
Secrets:   [OK/X found]
Logs:      [OK/X console.logs]

Ready for PR: [YES/NO]
```

If any critical issues, list them with fix suggestions.

## Arguments

$ARGUMENTS can be:
- `quick` - Only build + types
- `full` - All checks (default)
- `pre-commit` - Checks relevant for commits
- `pre-pr` - Full checks plus security scan
