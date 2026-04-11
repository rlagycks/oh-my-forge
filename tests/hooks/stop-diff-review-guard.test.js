/**
 * Tests for stop-diff-review-guard.js
 *
 * Run with: node tests/hooks/stop-diff-review-guard.test.js
 *
 * Note: This hook has a non-standard module.exports pattern (it reads stdin on
 * require.main). We test it by importing the run() function directly and
 * mocking process.exit / stdout / stdin.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/stop-diff-review-guard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatePath() {
  const key = process.env.CLAUDE_SESSION_ID ||
    crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `ecc-codex-diff-${key}.json`);
}

function writeState(state) {
  fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf8');
}

function clearState() {
  try { fs.unlinkSync(getStatePath()); } catch { /* ok */ }
}

function makeInput() {
  return JSON.stringify({ stop_reason: 'end_turn' });
}

/**
 * Run the hook's run() function and capture exit code + stdout.
 * Mocks process.exit to throw instead of actually exiting.
 */
function captureRun(stateFn) {
  // Reload module fresh each time to reset module-level state
  delete require.cache[hookPath];
  const { run } = require(hookPath);

  if (stateFn) stateFn();

  let exitCode = null;
  let stdout = '';
  const origExit = process.exit;
  const origStdout = process.stdout.write.bind(process.stdout);

  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };
  process.stdout.write = (chunk) => { stdout += chunk; return true; };

  try {
    run(makeInput());
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) {
      process.exit = origExit;
      process.stdout.write = origStdout;
      throw e;
    }
  }

  process.exit = origExit;
  process.stdout.write = origStdout;
  return { exitCode, stdout };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testNoCodexRan() {
  clearState();
  const { exitCode } = captureRun();
  assert.strictEqual(exitCode, 0, 'Should exit 0 when Codex did not run');
  console.log('  PASS testNoCodexRan');
}

function testCodexRanCleanTree() {
  // codexRan=true but assume git status is clean in test env
  // (We can't reliably control git state, so this tests the flag-check path)
  writeState({ codexRan: true });

  // Run the hook — if git reports dirty tree, it will exit 2; if clean, exit 0.
  // Both are valid depending on environment. We just verify no crash.
  let crashed = false;
  let exitCode = null;

  const origExit = process.exit;
  const origStdout = process.stdout.write.bind(process.stdout);
  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };
  process.stdout.write = () => true;

  delete require.cache[hookPath];
  const { run } = require(hookPath);

  try {
    run(makeInput());
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) crashed = true;
  }

  process.exit = origExit;
  process.stdout.write = origStdout;
  clearState();

  assert.strictEqual(crashed, false, 'Hook should not crash');
  assert.ok(exitCode === 0 || exitCode === 2, `Exit code should be 0 or 2, got ${exitCode}`);
  console.log(`  PASS testCodexRanCleanTree (exit ${exitCode})`);
}

function testBypassEnvSkips() {
  process.env.ECC_BYPASS_CODEX_GUARD = '1';
  writeState({ codexRan: true });
  const { exitCode } = captureRun();
  delete process.env.ECC_BYPASS_CODEX_GUARD;
  clearState();
  assert.strictEqual(exitCode, 0, 'ECC_BYPASS_CODEX_GUARD=1 should allow exit 0');
  console.log('  PASS testBypassEnvSkips');
}

function testInvalidJsonPassThrough() {
  clearState();
  let exitCode = null;
  let stdout = '';

  const origExit = process.exit;
  const origStdout = process.stdout.write.bind(process.stdout);
  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };
  process.stdout.write = (chunk) => { stdout += chunk; return true; };

  delete require.cache[hookPath];
  const { run } = require(hookPath);

  try {
    run('not valid json');
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) {
      process.exit = origExit;
      process.stdout.write = origStdout;
      throw e;
    }
  }

  process.exit = origExit;
  process.stdout.write = origStdout;

  assert.strictEqual(exitCode, 0, 'Invalid JSON should exit 0');
  console.log('  PASS testInvalidJsonPassThrough');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testNoCodexRan,
  testCodexRanCleanTree,
  testBypassEnvSkips,
  testInvalidJsonPassThrough,
];

let passed = 0;
let failed = 0;

console.log('\nstop-diff-review-guard.test.js');

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
