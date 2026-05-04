---
name: verification-loop
description: "A comprehensive verification system for Claude Code sessions."
origin: ECC
---

# Verification Loop Skill

A comprehensive verification system for Claude Code sessions.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

### Phase 1: Build Verification
```bash
# Check if project builds
npm run build 2>&1 | tail -20
# OR
pnpm build 2>&1 | tail -20
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
# TypeScript projects
npx tsc --noEmit 2>&1 | head -30

# Python projects
pyright . 2>&1 | head -30
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### Phase 4: Test Suite
```bash
# Run tests with coverage
npm run test -- --coverage 2>&1 | tail -50

# Check coverage threshold
# Target: 80% minimum
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 4.5: Ontology Validation

`.claude/ontology/index.json`이 있는 경우(옵션):

```bash
if [ -f .claude/ontology/index.json ] && [ -f scripts/ci/validate-ontology.js ]; then
  PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
  node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" && echo "ontology OK" || echo "FAIL: ontology 불일치"
elif [ ! -f .claude/ontology/index.json ]; then
  echo "Ontology: SKIPPED (.claude/ontology/index.json not present)"
else
  echo "Ontology: SKIPPED (validator not installed in this repo)"
fi
```

실패 시 `/ontology-sync --check`를 실행하고 불일치를 보고한다. (`scripts/ci/validate-ontology.js`는 ECC 개발 레포에만 존재할 수 있으므로, 파일이 없으면 실패로 간주하지 않는다.)

### Phase 5: Security Scan
```bash
# Check for secrets
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# Check for console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### Phase 6: Diff Review
```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Ontology:  [PASS/FAIL/SKIPPED]
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Run: /verify
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.
