/**
 * Tests for run() exports from converted PostToolUse/Stop hook scripts
 *
 * Verifies that 4 hook scripts (check-console-log, post-bash-build-complete,
 * post-bash-pr-created, post-edit-console-warn) export a synchronous
 * run(rawInput) function for in-process execution via run-with-flags.js.
 *
 * post-edit-typecheck.js is intentionally NOT covered here — it spawns
 * `npx tsc` via execFileSync with a 30s timeout, which is too slow/heavy to
 * run in-process on every hook dispatch, so it stays on the legacy spawn path.
 *
 * Run with: node tests/hooks/run-export-post.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hooksToTest = [
  {
    name: 'check-console-log',
    path: '../../scripts/hooks/check-console-log.js',
    realisticInput: JSON.stringify({ hook_event_name: 'Stop', session_id: 'test-session' }),
  },
  {
    name: 'post-bash-build-complete',
    path: '../../scripts/hooks/post-bash-build-complete.js',
    realisticInput: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      tool_response: { stdout: 'build finished', stderr: '', interrupted: false, isImage: false },
    }),
  },
  {
    name: 'post-bash-pr-created',
    path: '../../scripts/hooks/post-bash-pr-created.js',
    realisticInput: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --fill' },
      tool_response: {
        stdout: 'https://github.com/example/repo/pull/42',
        stderr: '',
        interrupted: false,
        isImage: false,
      },
    }),
  },
  {
    name: 'post-edit-console-warn',
    path: '../../scripts/hooks/post-edit-console-warn.js',
    realisticInput: JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: '/nonexistent/path/does-not-exist.ts' },
    }),
  },
];

function testRunExportExists(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const hookModule = require(hookPath);
  assert.ok(hookModule, `Module should load: ${hook.name}`);
  assert.strictEqual(typeof hookModule.run, 'function', `${hook.name} should export run()`);
}

function assertBenignResult(hook, result, label) {
  assert.ok(result !== undefined && result !== null, `${hook.name} run(${label}) should return a value`);
  assert.ok(
    typeof result === 'string' || (typeof result === 'object' && result !== null),
    `${hook.name} run(${label}) should return string or object`
  );
  if (typeof result === 'object') {
    if (Object.prototype.hasOwnProperty.call(result, 'exitCode')) {
      assert.strictEqual(result.exitCode, 0, `${hook.name} run(${label}) should never signal a blocking exit code`);
    }
  }
}

function testRunWithRealisticInput(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const result = run(hook.realisticInput);
  assertBenignResult(hook, result, 'realisticInput');
}

function testRunWithEmptyString(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const result = run('');
  assertBenignResult(hook, result, "''");
}

function testRunWithGarbageInput(hook) {
  const hookPath = path.resolve(__dirname, hook.path);
  const { run } = require(hookPath);
  const result = run('not-json');
  assertBenignResult(hook, result, "'not-json'");
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
    'not-json',
    'definitely not json',
    String.fromCharCode(0xfffd, 0xfffe),
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

// Extra targeted check: post-edit-console-warn should actually detect
// console.log statements and surface them via stderr (not just pass through).
function testConsoleWarnDetectsRealFile() {
  const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-edit-console-warn.js');
  const { run } = require(hookPath);

  const tmpFile = path.join(os.tmpdir(), `ecc-run-export-post-${process.pid}-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, 'function f() {\n  console.log("hi");\n}\n', 'utf8');

  try {
    const input = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: tmpFile } });
    const result = run(input);
    assert.ok(result && typeof result === 'object', 'should return an object result');
    assert.ok(typeof result.stderr === 'string' && result.stderr.includes('console.log'),
      'should report the detected console.log in stderr');
    assert.strictEqual(result.exitCode, 0, 'should never block (exitCode 0)');
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'stdout'),
      'should pass through raw input (no stdout override)');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// Extra targeted check: post-edit-typecheck.js must remain on the legacy
// spawn path — it should NOT export a synchronous run().
function testTypecheckStaysLegacy() {
  const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-edit-typecheck.js');
  delete require.cache[hookPath];
  const hookModule = require(hookPath);
  assert.strictEqual(
    typeof hookModule?.run,
    'undefined',
    'post-edit-typecheck.js should NOT export run() — tsc is too slow for in-process execution'
  );
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

console.log('\nrun-export-post.test.js\n');

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

console.log('Targeted checks:');
for (const [label, fn] of [
  ['testConsoleWarnDetectsRealFile', testConsoleWarnDetectsRealFile],
  ['testTypecheckStaysLegacy', testTypecheckStaysLegacy],
]) {
  try {
    fn();
    console.log(`  PASS ${label}`);
    totalPassed++;
  } catch (err) {
    console.error(`  FAIL ${label}: ${err.message}`);
    totalFailed++;
  }
}

console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed\n`);
if (totalFailed > 0) process.exit(1);
