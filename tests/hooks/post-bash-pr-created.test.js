/**
 * Tests for post-bash-pr-created.js
 *
 * Verifies the hook reads the real PostToolUse Bash payload shape
 * ({ tool_response: { stdout, stderr, interrupted, isImage } }) and still
 * tolerates legacy shapes (tool_output.output) as a fallback.
 *
 * Run with: node tests/hooks/post-bash-pr-created.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-bash-pr-created.js');

const PR_URL = 'https://github.com/example/repo/pull/42';

function runHook(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [hookPath], {
    input,
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function testDetectsPrUrlInStdout() {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "feat: dashboard" --body "details"' },
    tool_response: {
      stdout: `Creating pull request...\n${PR_URL}\n`,
      stderr: '',
      interrupted: false,
      isImage: false,
    },
  };
  const { code, stdout, stderr } = runHook(payload);
  assert.strictEqual(code, 0, 'Should exit 0');
  assert.strictEqual(stdout, JSON.stringify(payload), 'Should pass payload through unchanged');
  assert.ok(stderr.includes(PR_URL), 'Should log the detected PR URL to stderr');
  assert.ok(stderr.includes('gh pr review 42 --repo example/repo'), 'Should suggest a review command');
  console.log('  PASS testDetectsPrUrlInStdout');
}

function testDetectsPrUrlInStderrField() {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
    tool_response: {
      stdout: '',
      stderr: `Warning: 1 uncommitted change\n${PR_URL}\n`,
      interrupted: false,
      isImage: false,
    },
  };
  const { code, stderr } = runHook(payload);
  assert.strictEqual(code, 0, 'Should exit 0');
  assert.ok(stderr.includes(PR_URL), 'Should detect PR URL from tool_response.stderr');
  console.log('  PASS testDetectsPrUrlInStderrField');
}

function testLegacyToolOutputFallback() {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
    tool_output: { output: `${PR_URL}\n` },
  };
  const { code, stderr } = runHook(payload);
  assert.strictEqual(code, 0, 'Should exit 0');
  assert.ok(stderr.includes(PR_URL), 'Should detect PR URL from legacy tool_output.output');
  console.log('  PASS testLegacyToolOutputFallback');
}

function testNonPrCommandIsQuiet() {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
    tool_response: { stdout: PR_URL, stderr: '', interrupted: false, isImage: false },
  };
  const { code, stdout, stderr } = runHook(payload);
  assert.strictEqual(code, 0, 'Should exit 0');
  assert.strictEqual(stdout, JSON.stringify(payload), 'Should pass payload through unchanged');
  assert.ok(!stderr.includes('PR created'), 'Should not log for non-PR commands');
  console.log('  PASS testNonPrCommandIsQuiet');
}

function testNoUrlInOutput() {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
    tool_response: { stdout: 'something went sideways', stderr: '', interrupted: false, isImage: false },
  };
  const { code, stderr } = runHook(payload);
  assert.strictEqual(code, 0, 'Should exit 0');
  assert.ok(!stderr.includes('PR created'), 'Should not log when no PR URL is present');
  console.log('  PASS testNoUrlInOutput');
}

function testInvalidJsonPassThrough() {
  const { code, stdout } = runHook('not valid json');
  assert.strictEqual(code, 0, 'Invalid JSON should exit 0');
  assert.strictEqual(stdout, 'not valid json', 'Invalid JSON should pass through');
  console.log('  PASS testInvalidJsonPassThrough');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testDetectsPrUrlInStdout,
  testDetectsPrUrlInStderrField,
  testLegacyToolOutputFallback,
  testNonPrCommandIsQuiet,
  testNoUrlInOutput,
  testInvalidJsonPassThrough,
];

let passed = 0;
let failed = 0;

console.log('\npost-bash-pr-created.test.js');

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
