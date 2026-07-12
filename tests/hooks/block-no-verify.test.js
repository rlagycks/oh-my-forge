/**
 * Tests for pre-bash-block-no-verify.js — git hook-bypass guard
 *
 * Run with: node tests/hooks/block-no-verify.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/pre-bash-block-no-verify.js');
const { run } = require(hookPath);

function makeInput(command) {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

function testBlocksCommitLongFlag() {
  const raw = makeInput('git commit ' + '--no-verify' + ' -m "x"');
  const result = run(raw);
  assert.strictEqual(typeof result, 'object', 'Should return an object result');
  assert.strictEqual(result.exitCode, 2, 'git commit --no-verify should be blocked');
  assert.ok(typeof result.stderr === 'string' && result.stderr.length > 0, 'Should explain the block');
  console.log('  PASS testBlocksCommitLongFlag');
}

function testBlocksCommitDashN() {
  const raw = makeInput('git commit -n -m "x"');
  const result = run(raw);
  assert.deepStrictEqual(
    { exitCode: result.exitCode },
    { exitCode: 2 },
    'git commit -n should be blocked (shorthand for --no-verify on commit)'
  );
  console.log('  PASS testBlocksCommitDashN');
}

function testAllowsPlainCommit() {
  const raw = makeInput('git commit -m "x"');
  const result = run(raw);
  assert.strictEqual(result, raw, 'Plain git commit should pass through unchanged');
  console.log('  PASS testAllowsPlainCommit');
}

function testAllowsEchoOfFlagText() {
  const raw = makeInput('echo "' + '--no-verify' + '"');
  const result = run(raw);
  assert.strictEqual(result, raw, 'Non-git command that merely echoes the flag text should be allowed');
  console.log('  PASS testAllowsEchoOfFlagText');
}

function testAllowsGrepOfFlagText() {
  const raw = makeInput('grep -- ' + '--no-verify' + ' notes.txt');
  const result = run(raw);
  assert.strictEqual(result, raw, 'grep searching for the flag text should be allowed');
  console.log('  PASS testAllowsGrepOfFlagText');
}

function testAllowsGarbageStdin() {
  const result = run('not valid json');
  assert.strictEqual(result, 'not valid json', 'Invalid JSON should pass through and never block');
  console.log('  PASS testAllowsGarbageStdin');
}

function testAllowsEmptyStdin() {
  const result = run('');
  assert.strictEqual(result, '', 'Empty stdin should pass through and never block');
  console.log('  PASS testAllowsEmptyStdin');
}

function testAllowsPushDryRun() {
  // -n on `git push` means --dry-run, not --no-verify — must not be blocked.
  const raw = makeInput('git push -n');
  const result = run(raw);
  assert.strictEqual(result, raw, 'git push -n (dry-run) should not be treated as a hook bypass');
  console.log('  PASS testAllowsPushDryRun');
}

function testBlocksPushLongFlag() {
  const raw = makeInput('git push ' + '--no-verify');
  const result = run(raw);
  assert.strictEqual(result.exitCode, 2, 'git push --no-verify should be blocked');
  console.log('  PASS testBlocksPushLongFlag');
}

function testBlocksMergeDashN() {
  const raw = makeInput('git merge -n');
  const result = run(raw);
  assert.strictEqual(result.exitCode, 2, 'git merge -n should be blocked (shorthand for --no-verify on merge)');
  console.log('  PASS testBlocksMergeDashN');
}

function testAllowsRebaseDashN() {
  // -n is not a --no-verify shorthand on git rebase.
  const raw = makeInput('git rebase -n');
  const result = run(raw);
  assert.strictEqual(result, raw, 'git rebase -n should not be treated as a hook bypass');
  console.log('  PASS testAllowsRebaseDashN');
}

function testAllowsFlagInsideCommitMessage() {
  const raw = makeInput('git commit -m "please do not add ' + '--no-verify' + ' here"');
  const result = run(raw);
  assert.strictEqual(result, raw, 'A commit message that merely mentions the flag should be allowed');
  console.log('  PASS testAllowsFlagInsideCommitMessage');
}

function testBlocksChainedCommand() {
  const raw = makeInput('npm test && git commit ' + '--no-verify' + ' -m "x"');
  const result = run(raw);
  assert.strictEqual(result.exitCode, 2, 'Bypass flag in a later chained segment should still be blocked');
  console.log('  PASS testBlocksChainedCommand');
}

function testAllowsNonGitCommandWithoutCommand() {
  const raw = JSON.stringify({ tool_name: 'Bash', tool_input: {} });
  const result = run(raw);
  assert.strictEqual(result, raw, 'Missing command field should pass through');
  console.log('  PASS testAllowsNonGitCommandWithoutCommand');
}

const tests = [
  testBlocksCommitLongFlag,
  testBlocksCommitDashN,
  testAllowsPlainCommit,
  testAllowsEchoOfFlagText,
  testAllowsGrepOfFlagText,
  testAllowsGarbageStdin,
  testAllowsEmptyStdin,
  testAllowsPushDryRun,
  testBlocksPushLongFlag,
  testBlocksMergeDashN,
  testAllowsRebaseDashN,
  testAllowsFlagInsideCommitMessage,
  testBlocksChainedCommand,
  testAllowsNonGitCommandWithoutCommand,
];

let passed = 0;
let failed = 0;

console.log('\nblock-no-verify.test.js');

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
