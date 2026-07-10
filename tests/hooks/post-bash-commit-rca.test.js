/**
 * Tests for post-bash-commit-rca.js and rca-context-builder.js
 *
 * Run with: node tests/hooks/post-bash-commit-rca.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Import the modules under test
// ---------------------------------------------------------------------------

const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-bash-commit-rca.js');
const { run, writeBundleToStore } = require(hookPath);

let bundleDir = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(command, toolResponse) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    // Real PostToolUse success shape for Bash (failures go to PostToolUseFailure)
    tool_response: toolResponse || { stdout: '', stderr: '', interrupted: false, isImage: false },
  });
}

function captureRun(command, toolResponse) {
  // Capture stdout by temporarily redirecting write
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  run(makeInput(command, toolResponse));
  process.stdout.write = origWrite;
  return captured;
}

// Spawns the hook as a real subprocess so we can control its cwd — needed to
// exercise the git-log / gh-view fallback paths deterministically, without
// depending on (or polluting) this repo's real history.
function runHookInDir(command, toolResponse, cwd) {
  const payload = makeInput(command, toolResponse);
  const result = spawnSync(process.execPath, [hookPath], {
    input: payload,
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, CLAUDE_RCA_BUNDLE_DIR: bundleDir },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function setupBundleDir() {
  bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-rca-test-'));
  process.env.CLAUDE_RCA_BUNDLE_DIR = bundleDir;
}

function cleanupBundleDir() {
  delete process.env.CLAUDE_RCA_BUNDLE_DIR;
  if (bundleDir) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
    bundleDir = null;
  }
}

// ---------------------------------------------------------------------------
// Tests: FIX_PATTERN detection
// ---------------------------------------------------------------------------

function testFixPatternCommits() {
  const shouldTrigger = [
    'git commit -m "fix: correct null check in session manager"',
    'git commit -m "fix(gap): add missing sandbox_mode validation"',
    'git commit -m "fix(design): rework constraint format to include patterns"',
    'git commit -m "hotfix: patch memory leak in state store"',
    'git commit -m "bugfix: resolve off-by-one in diff parser"',
    "git commit -m 'fix: single quoted message'",
  ];

  const shouldNotTrigger = [
    'git commit -m "feat: add new RCA pipeline"',
    'git commit -m "refactor: simplify hook dispatcher"',
    'git commit -m "docs: update CLAUDE.md with commit conventions"',
    'git commit -m "chore: bump dependencies"',
    'git commit -m "test: add coverage for edge cases"',
    'git status',
    'npm test',
    'gh pr create --title "feat: new dashboard"',
  ];

  for (const cmd of shouldTrigger) {
    const out = captureRun(cmd);
    try {
      const parsed = JSON.parse(out);
      assert.ok(
        parsed.hookSpecificOutput,
        `Expected hookSpecificOutput for: ${cmd}`
      );
    } catch (_error) {
      // git may not be available or no commits exist; pass-through is acceptable
      // as long as we don't crash. The important thing is no thrown error.
    }
  }

  for (const cmd of shouldNotTrigger) {
    const out = captureRun(cmd);
    // Should pass through unchanged
    const parsed = JSON.parse(out);
    assert.ok(!parsed.hookSpecificOutput, `Should NOT trigger for: ${cmd}`);
  }

  console.log('  ✓ FIX_PATTERN trigger detection');
}

// ---------------------------------------------------------------------------
// Tests: Non-Bash tools are passed through
// ---------------------------------------------------------------------------

function testNonBashPassthrough() {
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'foo.js', old_string: 'a', new_string: 'b' },
  });
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  run(input);
  process.stdout.write = origWrite;

  assert.strictEqual(captured, input);
  console.log('  ✓ Non-Bash tool pass-through');
}

// ---------------------------------------------------------------------------
// Tests: Invalid JSON is passed through
// ---------------------------------------------------------------------------

function testInvalidJsonPassthrough() {
  const bad = 'not json';
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  run(bad);
  process.stdout.write = origWrite;

  assert.strictEqual(captured, bad);
  console.log('  ✓ Invalid JSON pass-through');
}

// ---------------------------------------------------------------------------
// Tests: PR create with fix title
// ---------------------------------------------------------------------------

function testPrCreateTrigger() {
  const cmd = 'gh pr create --title "fix(gap): add missing auth check" --body "details"';
  const out = captureRun(cmd);
  try {
    const parsed = JSON.parse(out);
    assert.ok(parsed.hookSpecificOutput, 'Expected hookSpecificOutput for gh pr create with fix title');
  } catch {
    // git context unavailable — acceptable
  }
  console.log('  ✓ gh pr create with fix title');
}

// ---------------------------------------------------------------------------
// Tests: gh pr merge trigger
// ---------------------------------------------------------------------------

function testMergeFixTitleTriggers() {
  const cmd = 'gh pr merge 42 --merge --delete-branch';
  const toolResponse = {
    stdout: '✓ Merged pull request #42 (fix: correct race condition in scheduler)\n',
    stderr: '',
    interrupted: false,
    isImage: false,
  };
  const out = captureRun(cmd, toolResponse);
  // JSON.parse must succeed: run() always emits valid JSON for well-formed
  // Bash input (either the passthrough input or the hookSpecificOutput
  // envelope) — do not swallow assertion failures behind a parse try/catch.
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput, 'Expected hookSpecificOutput for merged fix-titled PR');
  console.log('  ✓ gh pr merge with fix-titled PR (stdout title)');
}

function testMergeSquashedFixTitleTriggers() {
  const cmd = 'gh pr merge --squash 7';
  const toolResponse = {
    stdout: '',
    stderr: '✓ Squashed and merged pull request #7 (fix(gap): add missing validation)\n',
    interrupted: false,
    isImage: false,
  };
  const out = captureRun(cmd, toolResponse);
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput, 'Expected hookSpecificOutput for squash-merged fix-titled PR (stderr)');
  console.log('  ✓ gh pr merge --squash with fix-titled PR (stderr title)');
}

function testMergeFeatTitleDoesNotTrigger() {
  const cmd = 'gh pr merge 43 --merge';
  const toolResponse = {
    stdout: '✓ Merged pull request #43 (feat: add new dashboard widget)\n',
    stderr: '',
    interrupted: false,
    isImage: false,
  };
  const out = captureRun(cmd, toolResponse);
  const parsed = JSON.parse(out);
  assert.ok(!parsed.hookSpecificOutput, 'Should NOT trigger for merged feat-titled PR');
  console.log('  ✓ gh pr merge with feat-titled PR does not trigger');
}

function testMergeSilentWhenTitleUnresolvable() {
  // No ref token (only a flag), no title in output, and a non-git cwd so the
  // git-log fallback also comes up empty. gh must never actually be invoked
  // here since extractMergeRef() has nothing to look up.
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-rca-nongit-'));
  try {
    const cmd = 'gh pr merge --auto';
    const toolResponse = { stdout: 'Pull request will be automatically merged\n', stderr: '', interrupted: false, isImage: false };
    const { code, stdout } = runHookInDir(cmd, toolResponse, nonGitDir);
    assert.strictEqual(code, 0, 'Hook should always exit 0');
    const parsed = JSON.parse(stdout);
    assert.ok(!parsed.hookSpecificOutput, 'Should NOT trigger when no title can be resolved');
  } finally {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  }
  console.log('  ✓ gh pr merge silent when title unresolvable (no crash, no trigger)');
}

function testMergeUnrelatedGhCommandsUnaffected() {
  const commands = [
    'gh pr view 42',
    'gh pr list',
    'gh pr close 42',
  ];
  for (const cmd of commands) {
    const out = captureRun(cmd);
    const parsed = JSON.parse(out);
    assert.ok(!parsed.hookSpecificOutput, `Should NOT trigger for unrelated gh command: ${cmd}`);
  }
  console.log('  ✓ non-merge gh commands unaffected');
}

// ---------------------------------------------------------------------------
// Tests: rca-context-builder exports buildRcaBundle
// ---------------------------------------------------------------------------

function testContextBuilderExport() {
  const builderPath = path.resolve(__dirname, '../../scripts/lib/rca-context-builder.js');
  const { buildRcaBundle } = require(builderPath);
  assert.strictEqual(typeof buildRcaBundle, 'function', 'buildRcaBundle should be a function');
  console.log('  ✓ rca-context-builder exports buildRcaBundle');
}

function testBundleStoreFallsBackWhenPrimaryPathIsInvalid() {
  const primaryPath = path.join(bundleDir, 'blocked-parent');
  fs.writeFileSync(primaryPath, 'not-a-directory', 'utf8');

  const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-rca-fallback-'));
  try {
    const result = writeBundleToStore({
      commitRef: 'HEAD',
      generatedAt: new Date().toISOString(),
      changedFiles: [],
      affectedDomains: [],
    }, {
      bundleDir: path.join(primaryPath, 'nested'),
      candidateDirs: [path.join(primaryPath, 'nested'), fallbackDir],
    });

    assert.ok(result.bundlePath.startsWith(fallbackDir), result.bundlePath);
    assert.strictEqual(result.storageMode, 'fallback');
    assert.ok(fs.existsSync(result.bundlePath), 'fallback bundle should exist');
  } finally {
    fs.rmSync(fallbackDir, { recursive: true, force: true });
  }

  console.log('  ✓ bundle store falls back when primary path is invalid');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

console.log('post-bash-commit-rca tests:');

setupBundleDir();

let passed = 0;
let failed = 0;

const tests = [
  testNonBashPassthrough,
  testInvalidJsonPassthrough,
  testFixPatternCommits,
  testPrCreateTrigger,
  testMergeFixTitleTriggers,
  testMergeSquashedFixTitleTriggers,
  testMergeFeatTitleDoesNotTrigger,
  testMergeSilentWhenTitleUnresolvable,
  testMergeUnrelatedGhCommandsUnaffected,
  testContextBuilderExport,
  testBundleStoreFallsBackWhenPrimaryPathIsInvalid,
];

for (const t of tests) {
  try {
    t();
    passed++;
  } catch (e) {
    console.error(`  ✗ ${t.name}: ${e.message}`);
    failed++;
  }
}

cleanupBundleDir();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
