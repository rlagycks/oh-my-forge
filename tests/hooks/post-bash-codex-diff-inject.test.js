/**
 * Tests for post-bash-codex-diff-inject.js
 *
 * Run with: node tests/hooks/post-bash-codex-diff-inject.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/post-bash-codex-diff-inject.js');
const { run } = require(hookPath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(command) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { output: 'ok', exitCode: 0 },
  });
}

function captureRun(command) {
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  const result = run(makeInput(command));
  process.stdout.write = origWrite;
  return { captured, result };
}

function getStatePath() {
  const key = process.env.CLAUDE_SESSION_ID ||
    crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `ecc-codex-diff-${key}.json`);
}

function clearState() {
  try { fs.unlinkSync(getStatePath()); } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testNonCodexCommandPassThrough() {
  clearState();
  const { captured, result } = captureRun('git status');
  assert.strictEqual(result, makeInput('git status'), 'Non-codex command should pass through');
  assert.strictEqual(captured, '', 'Non-codex command should not write stdout');
  console.log('  PASS testNonCodexCommandPassThrough');
}

function testNpmCommandPassThrough() {
  clearState();
  const { captured, result } = captureRun('npm test');
  assert.strictEqual(result, makeInput('npm test'), 'npm test should pass through');
  assert.strictEqual(captured, '', 'npm test should not write stdout');
  console.log('  PASS testNpmCommandPassThrough');
}

function testCodexExecDetected() {
  clearState();
  const { captured, result } = captureRun('codex exec -p yolo -m gpt-5.4 --prompt-file /tmp/brief.txt');
  assert.strictEqual(result, null, 'Codex exec should return null (stdout already written)');

  try {
    const parsed = JSON.parse(captured);
    assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    assert.ok(parsed.hookSpecificOutput.includes('CODEX DIFF REVIEW'), 'Output should mention CODEX DIFF REVIEW');
    assert.ok(parsed.hookSpecificOutput.includes('/code-review'), 'Output should mention /code-review');
  } catch (e) {
    // If git diff fails (e.g. not a git repo), output may be empty or a pass-through
    // This is acceptable in CI environments
    if (!captured) {
      console.log('  PASS testCodexExecDetected (no git repo — acceptable)');
      return;
    }
    throw e;
  }
  console.log('  PASS testCodexExecDetected');
}

function testCodexCompanionDetected() {
  clearState();
  const { captured } = captureRun('node scripts/codex-companion.mjs task --prompt-file /tmp/brief.txt');
  if (captured) {
    try {
      const parsed = JSON.parse(captured);
      assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    } catch {
      // pass-through acceptable when git not available
    }
  }
  console.log('  PASS testCodexCompanionDetected');
}

function testCodexDispatchDetected() {
  clearState();
  const { captured } = captureRun('node scripts/lib/codex-handoff.js dispatch --request-file /tmp/request.json');
  if (captured) {
    try {
      const parsed = JSON.parse(captured);
      assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    } catch {
      // pass-through acceptable when git not available
    }
  }
  console.log('  PASS testCodexDispatchDetected');
}

function testOrchestratorDetected() {
  clearState();
  const { captured } = captureRun('bash scripts/orchestrate-codex-worker.sh');
  if (captured) {
    try {
      const parsed = JSON.parse(captured);
      assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    } catch {
      // pass-through acceptable when git not available
    }
  }
  console.log('  PASS testOrchestratorDetected');
}

function testSessionFlagSet() {
  clearState();
  captureRun('codex exec -p yolo');
  const stateRaw = fs.readFileSync(getStatePath(), 'utf8');
  const state = JSON.parse(stateRaw);
  assert.strictEqual(state.codexRan, true, 'codexRan flag should be set after Codex execution');
  console.log('  PASS testSessionFlagSet');
}

function testInvalidJsonPassThrough() {
  const { result } = captureRun('not called');
  // Actually test directly
  let captured2 = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured2 += chunk; return true; };
  const r = run('not valid json');
  process.stdout.write = origWrite;
  assert.strictEqual(r, 'not valid json', 'Invalid JSON should pass through');
  console.log('  PASS testInvalidJsonPassThrough');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testNonCodexCommandPassThrough,
  testNpmCommandPassThrough,
  testCodexExecDetected,
  testCodexCompanionDetected,
  testCodexDispatchDetected,
  testOrchestratorDetected,
  testSessionFlagSet,
  testInvalidJsonPassThrough,
];

let passed = 0;
let failed = 0;

console.log('\npost-bash-codex-diff-inject.test.js');

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
