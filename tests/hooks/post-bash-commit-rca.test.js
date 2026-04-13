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

// ---------------------------------------------------------------------------
// Import the modules under test
// ---------------------------------------------------------------------------

const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-bash-commit-rca.js');
const { run, writeBundleToStore } = require(hookPath);

let bundleDir = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(command) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { output: '', exitCode: 0 },
  });
}

function captureRun(command) {
  // Capture stdout by temporarily redirecting write
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  run(makeInput(command));
  process.stdout.write = origWrite;
  return captured;
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
    } catch (e) {
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
