/**
 * Tests for run() exports from converted hook scripts
 *
 * Verifies that 5 hook scripts (pre-bash-tmux-reminder, pre-bash-git-push-reminder,
 * pre-bash-dev-server-block, pre-write-doc-warn, suggest-compact) export a
 * synchronous run(rawInput) function for in-process execution via run-with-flags.js.
 *
 * Run with: node tests/hooks/run-export-advisory.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const hooksToTest = [
  { name: 'pre-bash-tmux-reminder', path: '../../scripts/hooks/pre-bash-tmux-reminder.js' },
  { name: 'pre-bash-git-push-reminder', path: '../../scripts/hooks/pre-bash-git-push-reminder.js' },
  { name: 'pre-bash-dev-server-block', path: '../../scripts/hooks/pre-bash-dev-server-block.js' },
  { name: 'pre-write-doc-warn', path: '../../scripts/hooks/pre-write-doc-warn.js' },
  { name: 'suggest-compact', path: '../../scripts/hooks/suggest-compact.js' },
];

function testRunExportExists(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const module = require(hookPath);
  assert.ok(module, `Module should load: ${hook.name}`);
  assert.strictEqual(typeof module.run, 'function', `${hook.name} should export run()`);
}

function testRunWithRealisticInput(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install' } });
  const result = run(input);
  assert.ok(result !== undefined && result !== null, `${hook.name} run() should return a value`);
  // Should not throw, and should return string or object
  assert.ok(typeof result === 'string' || (typeof result === 'object' && result !== null),
    `${hook.name} run() should return string or object`);
}

function testRunWithEmptyString(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const result = run('');
  assert.ok(result !== undefined && result !== null, `${hook.name} run('') should return a value`);
  assert.ok(typeof result === 'string' || (typeof result === 'object' && result !== null),
    `${hook.name} run('') should return string or object`);
}

function testRunWithGarbageInput(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const result = run('not valid json at all');
  assert.ok(result !== undefined && result !== null, `${hook.name} run(garbage) should return a value`);
  // Even with garbage input, should not throw
  assert.ok(typeof result === 'string' || (typeof result === 'object' && result !== null),
    `${hook.name} run(garbage) should return string or object`);
}

function testRunNeverThrows(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const inputs = [
    '',
    'null',
    'undefined',
    '{}',
    '{"tool_input":{}}',
    'definitely not json',
    String.fromCharCode(0xfffd, 0xfffe), // invalid UTF-8
  ];

  for (const input of inputs) {
    try {
      const result = run(input);
      assert.ok(result !== undefined, `${hook.name} run() returned undefined for input: ${input.slice(0, 20)}`);
    } catch (err) {
      throw new Error(`${hook.name} run() threw with input "${input.slice(0, 20)}...": ${err.message}`);
    }
  }
}

const testNames = [
  'testRunExportExists',
  'testRunWithRealisticInput',
  'testRunWithEmptyString',
  'testRunWithGarbageInput',
  'testRunNeverThrows',
];

let totalPassed = 0;
let totalFailed = 0;

console.log('\nrun-export-advisory.test.js\n');

for (const hook of hooksToTest) {
  console.log(`Testing ${hook.name}:`);

  for (const testName of testNames) {
    try {
      if (testName === 'testRunExportExists') {
        testRunExportExists(hook);
      } else if (testName === 'testRunWithRealisticInput') {
        testRunWithRealisticInput(hook);
      } else if (testName === 'testRunWithEmptyString') {
        testRunWithEmptyString(hook);
      } else if (testName === 'testRunWithGarbageInput') {
        testRunWithGarbageInput(hook);
      } else if (testName === 'testRunNeverThrows') {
        testRunNeverThrows(hook);
      }
      console.log(`  PASS ${testName}`);
      totalPassed++;
    } catch (err) {
      console.error(`  FAIL ${testName}: ${err.message}`);
      totalFailed++;
    }
  }
  console.log('');
}

console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed\n`);
if (totalFailed > 0) process.exit(1);
