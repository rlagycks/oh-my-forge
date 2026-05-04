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
   - `PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require(`path`),f=require(`fs`),h=require(`os`).homedir(),a=[p.join(h,`.claude`),p.join(h,`.codex`)],q=p.join(`scripts`,`lib`,`utils.js`);for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],`plugins`,`oh-my-forge`),p.join(a[j],`plugins`,`oh-my-forge@rlagycks`),p.join(a[j],`plugins`,`marketplace`,`oh-my-forge`),p.join(a[j],`plugins`,`everything-claude-code`),p.join(a[j],`plugins`,`everything-claude-code@everything-claude-code`),p.join(a[j],`plugins`,`marketplace`,`everything-claude-code`))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of [`oh-my-forge`,`everything-claude-code`]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],`plugins`,`cache`,n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"; ONTOLOGY_INDEX="$PLUGIN_ROOT/.claude/ontology/index.json"; if [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ] && [ -f "$ONTOLOGY_INDEX" ]; then node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js"; elif [ ! -f "$ONTOLOGY_INDEX" ]; then echo "Ontology: SKIPPED (.claude/ontology/index.json 없음)"; else echo "Ontology: SKIPPED (validate-ontology.js 없음 — OMF 개발 레포 전용)"; fi` 실행
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
