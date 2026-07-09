/**
 * Tests for error-tracker.js
 *
 * Ground truth for Claude Code's real hook payload shapes (see docs at
 * https://code.claude.com/docs/en/hooks, "PostToolUse" / "PostToolUseFailure"
 * sections):
 *
 *   - PostToolUse fires only after a tool call SUCCEEDS. For Bash, the
 *     success `tool_response` shape is `{ stdout, stderr, interrupted, isImage }`
 *     — there is no `exitCode`, `output`, or `content` field.
 *   - Bash commands that exit non-zero fire `PostToolUseFailure` instead,
 *     with the tool call's own error surfaced as a TOP-LEVEL `error` string
 *     field (not nested under `tool_response`), e.g.:
 *       { hook_event_name: "PostToolUseFailure", tool_name: "Bash",
 *         tool_input: { command: "npm test" },
 *         error: "Command exited with non-zero status code 1",
 *         is_interrupt: false }
 *
 * Run with: node tests/hooks/error-tracker.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/error-tracker.js');
const { run } = require(hookPath);

let homeDir = null;

function setupHome() {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-tracker-test-'));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.CLAUDE_SESSION_ID = `test-${crypto.randomBytes(4).toString('hex')}`;
}

function cleanupHome() {
  delete process.env.CLAUDE_SESSION_ID;
  if (homeDir) {
    fs.rmSync(homeDir, { recursive: true, force: true });
    homeDir = null;
  }
}

function getStatePath() {
  return path.join(homeDir, '.claude', 'tmp', `session-errors-${process.env.CLAUDE_SESSION_ID}.json`);
}

function loadRecordedErrors() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return [];
  }
}

function captureRun(rawInput) {
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  let stderr = '';
  const origErrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    run(rawInput);
  } finally {
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
  }
  return { captured, stderr };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\n=== error-tracker.js ===\n');

// ---------------------------------------------------------------------------
// The regression test: a real PostToolUseFailure payload for a failed Bash
// command must be recorded. This is the shape Claude Code actually sends —
// error-tracker.js's old exitCode-from-tool_response detection never sees
// this payload shape.
// ---------------------------------------------------------------------------
if (test('records a real PostToolUseFailure Bash failure payload', () => {
  setupHome();
  try {
    const input = JSON.stringify({
      session_id: 'abc123',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'toolu_01ABC123',
      error: 'Command exited with non-zero status code 1',
      is_interrupt: false,
      duration_ms: 4187,
    });

    captureRun(input);

    const errors = loadRecordedErrors();
    assert.strictEqual(errors.length, 1, 'should record exactly one error entry');
    assert.strictEqual(errors[0].command, 'npm test');
    assert.ok(
      Number.isInteger(errors[0].exitCode) && errors[0].exitCode !== 0,
      `exitCode should be a non-zero integer, got ${JSON.stringify(errors[0].exitCode)}`
    );
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

// ---------------------------------------------------------------------------
// A real PostToolUse success payload (Bash's actual success shape) must
// never be recorded as an error — guards against false positives.
// ---------------------------------------------------------------------------
if (test('does not record a real PostToolUse success payload', () => {
  setupHome();
  try {
    const input = JSON.stringify({
      session_id: 'abc123',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_response: {
        stdout: 'hello\n',
        stderr: '',
        interrupted: false,
        isImage: false,
      },
      tool_use_id: 'toolu_01XYZ',
      duration_ms: 12,
    });

    captureRun(input);

    const errors = loadRecordedErrors();
    assert.strictEqual(errors.length, 0, 'should not record any error for a successful command');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

// ---------------------------------------------------------------------------
// A user-interrupted (Ctrl-C) Bash call is technically a "failure" event but
// is not a bug — it should not force a /decide root-cause recording.
// ---------------------------------------------------------------------------
if (test('does not record a user-interrupted Bash call as a bug', () => {
  setupHome();
  try {
    const input = JSON.stringify({
      session_id: 'abc123',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'sleep 100' },
      error: 'Command was interrupted',
      is_interrupt: true,
    });

    captureRun(input);

    const errors = loadRecordedErrors();
    assert.strictEqual(errors.length, 0, 'user interruption should not be tracked as an error');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

// ---------------------------------------------------------------------------
// Non-Bash tool failures must be ignored.
// ---------------------------------------------------------------------------
if (test('ignores PostToolUseFailure for non-Bash tools', () => {
  setupHome();
  try {
    const input = JSON.stringify({
      session_id: 'abc123',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/missing.txt' },
      error: 'File not found',
    });

    captureRun(input);

    const errors = loadRecordedErrors();
    assert.strictEqual(errors.length, 0, 'non-Bash tool failures should not be tracked');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

// ---------------------------------------------------------------------------
// Malformed stdin must never crash the hook (always exit 0 / pass through).
// ---------------------------------------------------------------------------
if (test('passes through unparsable input without throwing', () => {
  setupHome();
  try {
    const { captured } = captureRun('not json');
    assert.strictEqual(captured, 'not json');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exitCode = 1;
}
