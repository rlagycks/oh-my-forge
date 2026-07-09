/**
 * Cross-tool symmetry tests for the two Codex guards:
 *
 *   scripts/hooks/pre-write-edit-codex-guard.js  (Write/Edit/MultiEdit)
 *   scripts/hooks/pre-bash-codex-guard.js        (Bash shell writes)
 *
 * Both guards derive verdicts from scripts/lib/codex-guard-policy.js.
 * These tests prove the same file gets the same verdict through either
 * tool path:
 *   (a) a tracked self-repo meta file is blocked via Bash exactly when it
 *       is blocked via Edit/Write,
 *   (b) ECC_BYPASS_CODEX_GUARD=1 releases both paths,
 *   (c) untracked files pass through on both paths.
 *
 * Run with: node tests/hooks/codex-guard-symmetry.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const writeHookPath = path.resolve(__dirname, '../../scripts/hooks/pre-write-edit-codex-guard.js');
const bashHookPath = path.resolve(__dirname, '../../scripts/hooks/pre-bash-codex-guard.js');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function makeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-guard-symmetry-'));
  const projectRoot = path.join(tempRoot, 'repo');
  const metaTrackedFile = path.join(projectRoot, 'scripts', 'hooks', 'sample-hook.js');
  const srcTrackedFile = path.join(projectRoot, 'src', 'tracked.js');
  const untrackedFile = path.join(projectRoot, 'src', 'untracked.js');

  for (const file of [metaTrackedFile, srcTrackedFile, untrackedFile]) {
    mkdirp(path.dirname(file));
    fs.writeFileSync(file, 'module.exports = 1;\n', 'utf8');
  }
  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_sample: {
      summary: 'symmetry fixture domain',
      owner: 'project',
      files: ['scripts/hooks/sample-hook.js', 'src/tracked.js'],
      spec: 'docs/features/sample.md',
    },
  });
  writeJson(path.join(projectRoot, '.claude', 'settings.json'), {
    implementationEngine: 'codex',
  });

  return { tempRoot, projectRoot, metaTrackedFile, srcTrackedFile, untrackedFile };
}

// ---------------------------------------------------------------------------
// Guard runners
// ---------------------------------------------------------------------------

function freshRun(hookPath, rawInput) {
  delete require.cache[hookPath];
  const { run } = require(hookPath);
  return run(rawInput);
}

/**
 * Run the Write/Edit guard, capturing process.exit / stdout / stderr.
 * Returns { exitCode, result } — exitCode is null on pass-through.
 */
function runWriteGuard(toolName, filePath, extraToolInput = {}) {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath, ...extraToolInput },
  });

  let exitCode = null;
  let result = null;
  const origExit = process.exit;
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };
  process.stdout.write = () => true;
  process.stderr.write = () => true;

  try {
    result = freshRun(writeHookPath, input);
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) {
      process.exit = origExit;
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      throw e;
    }
  }

  process.exit = origExit;
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
  return { exitCode, result, input };
}

/**
 * Run the Bash guard for a heredoc write to targetFile.
 * Returns the raw run() result (string on pass-through, { exitCode: 2 } on block).
 */
function runBashGuard(targetFile) {
  const command = [
    `cat > ${targetFile} <<'EOF'`,
    'module.exports = 2;',
    'EOF',
  ].join('\n');
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

  const origStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return { result: freshRun(bashHookPath, input), input };
  } finally {
    process.stderr.write = origStderr;
  }
}

function inProject(fixture, sessionId, fn) {
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_SESSION_ID = sessionId;
  try {
    return fn();
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_SESSION_ID;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testMetaTrackedFileBlockedOnBothPaths() {
  const fixture = makeFixture();
  try {
    inProject(fixture, `symmetry-meta-block-${Date.now()}`, () => {
      const editVerdict = runWriteGuard('Edit', fixture.metaTrackedFile, {
        old_string: 'module.exports = 1;', new_string: 'module.exports = 2;',
      });
      assert.strictEqual(editVerdict.exitCode, 2,
        'Edit on tracked self-repo meta file should be blocked');

      const bashVerdict = runBashGuard(fixture.metaTrackedFile);
      assert.deepStrictEqual(bashVerdict.result, { exitCode: 2 },
        'Bash heredoc write to the same file should be blocked too');
    });
    console.log('  PASS testMetaTrackedFileBlockedOnBothPaths');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testBypassReleasesBothPaths() {
  const fixture = makeFixture();
  try {
    inProject(fixture, `symmetry-bypass-${Date.now()}`, () => {
      process.env.ECC_BYPASS_CODEX_GUARD = '1';
      try {
        const editVerdict = runWriteGuard('Edit', fixture.metaTrackedFile, {
          old_string: 'module.exports = 1;', new_string: 'module.exports = 2;',
        });
        assert.strictEqual(editVerdict.exitCode, null,
          'Bypass should release the Edit path');
        assert.strictEqual(editVerdict.result, editVerdict.input,
          'Edit input should pass through under bypass');

        const bashVerdict = runBashGuard(fixture.metaTrackedFile);
        assert.strictEqual(bashVerdict.result, bashVerdict.input,
          'Bypass should release the Bash path for the same file');
      } finally {
        delete process.env.ECC_BYPASS_CODEX_GUARD;
      }
    });
    console.log('  PASS testBypassReleasesBothPaths');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testWriteToolTrackedSourceBlockedOnBothPaths() {
  // Uses the Write tool (not Edit) to prove the write-side guard covers Write.
  const fixture = makeFixture();
  try {
    inProject(fixture, `symmetry-write-tool-${Date.now()}`, () => {
      const writeVerdict = runWriteGuard('Write', fixture.srcTrackedFile, {
        content: 'module.exports = 2;\n',
      });
      assert.strictEqual(writeVerdict.exitCode, 2,
        'Write tool on tracked source file should be blocked');

      const bashVerdict = runBashGuard(fixture.srcTrackedFile);
      assert.deepStrictEqual(bashVerdict.result, { exitCode: 2 },
        'Bash heredoc write to the same file should be blocked too');
    });
    console.log('  PASS testWriteToolTrackedSourceBlockedOnBothPaths');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function testUntrackedFileAllowedOnBothPaths() {
  const fixture = makeFixture();
  try {
    inProject(fixture, `symmetry-untracked-${Date.now()}`, () => {
      const writeVerdict = runWriteGuard('Write', fixture.untrackedFile, {
        content: 'module.exports = 2;\n',
      });
      assert.strictEqual(writeVerdict.exitCode, null,
        'Write to untracked file should pass through');
      assert.strictEqual(writeVerdict.result, writeVerdict.input,
        'Write input should be returned unchanged');

      const bashVerdict = runBashGuard(fixture.untrackedFile);
      assert.strictEqual(bashVerdict.result, bashVerdict.input,
        'Bash write to untracked file should pass through');
    });
    console.log('  PASS testUntrackedFileAllowedOnBothPaths');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testMetaTrackedFileBlockedOnBothPaths,
  testBypassReleasesBothPaths,
  testWriteToolTrackedSourceBlockedOnBothPaths,
  testUntrackedFileAllowedOnBothPaths,
];

let passed = 0;
let failed = 0;

console.log('\ncodex-guard-symmetry.test.js');

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
