/**
 * Tests for scripts/lib/shell-write-detect.js — shell-command tokenizer and
 * shell-write detection extracted from pre-bash-codex-guard.js (PR #50
 * follow-up F3).
 *
 * The hook-level integration tests (tests/hooks/pre-bash-codex-guard.test.js)
 * already exercise findTrackedShellMutation end-to-end through run(); these
 * tests cover the extracted primitives directly.
 *
 * Run with: node tests/lib/shell-write-detect.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  tokenise,
  isShellRedirection,
  redirectionNeedsTarget,
  containsShellVariable,
  collectExplicitMutationTargets,
  collectQuotedPathCandidates,
  isInterpreterMutation,
  isInPlaceEditorMutation,
  commandMentionsPath,
  findTrackedShellMutation,
  findEngineFlipShellMutation,
} = require('../../scripts/lib/shell-write-detect');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function testTokenise() {
  assert.deepStrictEqual(
    tokenise('cp -v src.js dest.js').tokens,
    ['cp', '-v', 'src.js', 'dest.js'],
  );
  assert.deepStrictEqual(
    tokenise("echo 'hello world'").tokens,
    ['echo', 'hello world'],
  );
  const quoted = tokenise("cmd '/tmp/a b'");
  assert.ok(quoted.singleQuotedIndices.has(1), 'single-quoted token index should be tracked');
  console.log('  PASS testTokenise');
}

function testIsShellRedirection() {
  assert.strictEqual(isShellRedirection('>'), true);
  assert.strictEqual(isShellRedirection('>>'), true);
  assert.strictEqual(isShellRedirection('2>&1'), true);
  assert.strictEqual(isShellRedirection('1>/dev/null'), true);
  assert.strictEqual(isShellRedirection('foo'), false);
  console.log('  PASS testIsShellRedirection');
}

function testRedirectionNeedsTarget() {
  assert.strictEqual(redirectionNeedsTarget('>'), true);
  assert.strictEqual(redirectionNeedsTarget('2>'), true);
  assert.strictEqual(redirectionNeedsTarget('2>&1'), false, 'embedded target needs no extra token');
  assert.strictEqual(redirectionNeedsTarget('1>/dev/null'), false);
  console.log('  PASS testRedirectionNeedsTarget');
}

function testContainsShellVariable() {
  assert.strictEqual(containsShellVariable('$HOME/file'), true);
  assert.strictEqual(containsShellVariable('$HOME/file', true), false, 'single-quoted values are literal');
  assert.strictEqual(containsShellVariable('/plain/path'), false);
  console.log('  PASS testContainsShellVariable');
}

function testCollectExplicitMutationTargets() {
  assert.deepStrictEqual(
    collectExplicitMutationTargets('cat > /tmp/out.txt'),
    ['/tmp/out.txt'],
  );
  assert.deepStrictEqual(
    collectExplicitMutationTargets('mv /tmp/a.js /tmp/b.js'),
    ['/tmp/a.js', '/tmp/b.js'],
  );
  assert.deepStrictEqual(
    collectExplicitMutationTargets('cp /tmp/a.js /tmp/b.js'),
    ['/tmp/b.js'],
    'cp only reports the final (destination) target',
  );
  assert.deepStrictEqual(
    collectExplicitMutationTargets('sudo mv /tmp/a.js /tmp/b.js'),
    ['/tmp/a.js', '/tmp/b.js'],
    'sudo prefix should be skipped, not treated as a mutation target',
  );
  console.log('  PASS testCollectExplicitMutationTargets');
}

function testCollectQuotedPathCandidates() {
  const command = "python3 -c \"open('/tmp/a/b.js', 'w').write('x')\"";
  assert.deepStrictEqual(collectQuotedPathCandidates(command), ['/tmp/a/b.js']);
  console.log('  PASS testCollectQuotedPathCandidates');
}

function testIsInterpreterMutation() {
  assert.strictEqual(isInterpreterMutation("python3 -c \"open('/tmp/a.js', 'w').write('x')\""), true);
  assert.strictEqual(isInterpreterMutation('python3 -c "print(1)"'), false, 'read-only interpreter call');
  assert.strictEqual(isInterpreterMutation('cat /tmp/a.js'), false, 'no interpreter present');
  console.log('  PASS testIsInterpreterMutation');
}

function testIsInPlaceEditorMutation() {
  assert.strictEqual(isInPlaceEditorMutation("sed -i 's/a/b/' /tmp/a.js"), true);
  assert.strictEqual(isInPlaceEditorMutation("sed 's/a/b/' /tmp/a.js"), false, 'sed without -i is not in-place');
  assert.strictEqual(isInPlaceEditorMutation("perl -pi -e 's/a/b/' /tmp/a.js"), true);
  console.log('  PASS testIsInPlaceEditorMutation');
}

function testCommandMentionsPath() {
  assert.strictEqual(commandMentionsPath('cat src/tracked.js', 'src/tracked.js'), true);
  assert.strictEqual(commandMentionsPath('cat src/tracked.js.bak', 'src/tracked.js'), false,
    'must respect word boundaries, not just substring containment');
  console.log('  PASS testCommandMentionsPath');
}

function makeTrackedProjectFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-write-detect-'));
  const projectRoot = path.join(tempRoot, 'project');
  const trackedFile = path.join(projectRoot, 'src', 'tracked.js');

  mkdirp(path.dirname(trackedFile));
  mkdirp(path.join(projectRoot, '.claude', 'ontology'));
  fs.writeFileSync(trackedFile, 'module.exports = 1;\n', 'utf8');
  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_project: {
      summary: 'project-owned domain',
      owner: 'project',
      files: ['src/tracked.js'],
      spec: 'docs/features/project.md',
    },
  });
  writeJson(path.join(projectRoot, '.claude', 'settings.json'), {
    implementationEngine: 'codex',
  });

  return { tempRoot, projectRoot, trackedFile };
}

function testFindTrackedShellMutationDetectsExplicitTarget() {
  const fixture = makeTrackedProjectFixture();
  try {
    const command = `cat > ${fixture.trackedFile} <<'EOF'\nmodule.exports = 2;\nEOF`;
    const match = findTrackedShellMutation(command, fixture.projectRoot);
    assert.ok(match, 'explicit redirection target to a tracked file should be detected');
    assert.strictEqual(match.domainKey, 'domain_project');
    assert.strictEqual(match.detector, 'explicit-target');
    console.log('  PASS testFindTrackedShellMutationDetectsExplicitTarget');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testFindTrackedShellMutationIgnoresUntrackedFile() {
  const fixture = makeTrackedProjectFixture();
  try {
    const untracked = path.join(fixture.projectRoot, 'src', 'untracked.js');
    const command = `cat > ${untracked} <<'EOF'\nmodule.exports = 2;\nEOF`;
    const match = findTrackedShellMutation(command, fixture.projectRoot);
    assert.strictEqual(match, null, 'untracked file writes should not match');
    console.log('  PASS testFindTrackedShellMutationIgnoresUntrackedFile');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testFindTrackedShellMutationNullWhenMissingArgs() {
  assert.strictEqual(findTrackedShellMutation('', '/tmp'), null);
  assert.strictEqual(findTrackedShellMutation('cat foo', ''), null);
  console.log('  PASS testFindTrackedShellMutationNullWhenMissingArgs');
}

function makeSettingsProjectFixture(initialEngine = 'codex') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-write-detect-settings-'));
  const projectRoot = path.join(tempRoot, 'project');
  mkdirp(path.join(projectRoot, '.claude'));
  writeJson(path.join(projectRoot, '.claude', 'settings.json'), { implementationEngine: initialEngine });
  return { tempRoot, projectRoot };
}

function testFindEngineFlipShellMutationDetectsFlip() {
  const fixture = makeSettingsProjectFixture('codex');
  try {
    const command = [
      `cat > ${fixture.projectRoot}/.claude/settings.json <<'EOF'`,
      '{"implementationEngine": "claude"}',
      'EOF',
    ].join('\n');
    const match = findEngineFlipShellMutation(command, fixture.projectRoot);
    assert.ok(match, 'a settings.json write referencing implementationEngine should be detected');
    assert.strictEqual(match.relPath, '.claude/settings.json');
    assert.strictEqual(match.current, 'codex');
    assert.strictEqual(match.proposed, 'claude');
    console.log('  PASS testFindEngineFlipShellMutationDetectsFlip');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testFindEngineFlipShellMutationIgnoresUnrelatedSettingsWrite() {
  const fixture = makeSettingsProjectFixture('codex');
  try {
    const command = [
      `cat > ${fixture.projectRoot}/.claude/settings.json <<'EOF'`,
      '{"someOtherSetting": true}',
      'EOF',
    ].join('\n');
    const match = findEngineFlipShellMutation(command, fixture.projectRoot);
    assert.strictEqual(match, null, 'settings.json writes that never mention implementationEngine must not match');
    console.log('  PASS testFindEngineFlipShellMutationIgnoresUnrelatedSettingsWrite');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testFindEngineFlipShellMutationIgnoresOtherFile() {
  const fixture = makeSettingsProjectFixture('codex');
  try {
    const otherFile = path.join(fixture.projectRoot, 'notes.txt');
    const command = [
      `cat > ${otherFile} <<'EOF'`,
      'implementationEngine notes: codex vs claude',
      'EOF',
    ].join('\n');
    const match = findEngineFlipShellMutation(command, fixture.projectRoot);
    assert.strictEqual(match, null, 'mentioning implementationEngine while writing a different file must not match');
    console.log('  PASS testFindEngineFlipShellMutationIgnoresOtherFile');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

const tests = [
  testTokenise,
  testIsShellRedirection,
  testRedirectionNeedsTarget,
  testContainsShellVariable,
  testCollectExplicitMutationTargets,
  testCollectQuotedPathCandidates,
  testIsInterpreterMutation,
  testIsInPlaceEditorMutation,
  testCommandMentionsPath,
  testFindTrackedShellMutationDetectsExplicitTarget,
  testFindTrackedShellMutationIgnoresUntrackedFile,
  testFindTrackedShellMutationNullWhenMissingArgs,
  testFindEngineFlipShellMutationDetectsFlip,
  testFindEngineFlipShellMutationIgnoresUnrelatedSettingsWrite,
  testFindEngineFlipShellMutationIgnoresOtherFile,
];

let passed = 0;
let failed = 0;

console.log('\nshell-write-detect.test.js');

for (const test of tests) {
  try {
    test();
    passed++;
  } catch (err) {
    console.error(`  FAIL ${test.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
