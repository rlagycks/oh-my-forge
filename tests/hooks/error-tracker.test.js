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

// The hook supports legacy payloads only as a defensive compatibility path.
// These tests keep that fallback from becoming a source of silent false
// negatives while retaining the documented PostToolUse semantics above.
if (test('records a legacy nested exitCode and related file paths', () => {
  setupHome();
  try {
    const command = 'node scripts/check.js src/app.js docs/plan.md config.json';
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { exitCode: 17, stdout: 'legacy runner failed' },
    });
    const { captured, stderr } = captureRun(input);

    assert.strictEqual(captured, input, 'hook stdout must remain a pass-through');
    assert.match(stderr, /Logged failure \(exit 17\)/);
    const [entry] = loadRecordedErrors();
    assert.strictEqual(entry.exitCode, 17);
    assert.strictEqual(entry.errorMessage, null);
    assert.ok(entry.relatedFiles.includes('scripts/check.js'));
    assert.ok(entry.relatedFiles.includes('src/app.js'));
    assert.ok(entry.relatedFiles.includes('plan.md'));
    assert.ok(entry.relatedFiles.includes('config.json'));
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

if (test('extracts a non-zero exit code from legacy output but ignores zero and opaque output', () => {
  setupHome();
  try {
    const failedInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test tests/unit.js' },
      tool_response: { content: 'runner stopped (exit code: 23)' },
    });
    captureRun(failedInput);
    assert.strictEqual(loadRecordedErrors()[0].exitCode, 23);

    const zeroInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { output: 'done (exit code: 0)' },
    });
    const opaqueInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stderr: 'legacy output without an exit code' },
    });
    captureRun(zeroInput);
    captureRun(opaqueInput);
    assert.strictEqual(loadRecordedErrors().length, 1, 'only the confirmed non-zero failure is recorded');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

if (test('uses a top-level error without an event name and defaults unparseable failures to one', () => {
  setupHome();
  try {
    const raw = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'node ' + 'x'.repeat(550) },
      error: 'provider reported a failure without a code',
    });
    captureRun(raw);
    const [entry] = loadRecordedErrors();
    assert.strictEqual(entry.exitCode, 1);
    assert.strictEqual(entry.command.length, 500, 'untrusted command text is capped');
    assert.strictEqual(entry.errorMessage, 'provider reported a failure without a code');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

if (test('does not let an explicit success event with an error-shaped field create a record', () => {
  setupHome();
  try {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo okay' },
      error: 'stale error field from an intermediary',
      tool_response: { stdout: 'okay\n' },
    });
    const { captured } = captureRun(raw);
    assert.strictEqual(captured, raw);
    assert.deepStrictEqual(loadRecordedErrors(), []);
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

if (test('recovers from a malformed saved error list and caps noisy file extraction', () => {
  setupHome();
  try {
    fs.mkdirSync(path.dirname(getStatePath()), { recursive: true });
    fs.writeFileSync(getStatePath(), '{bad-state', 'utf8');
    const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`).join(' ');
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: `node ${files}` },
      error: 'Command exited with code 9',
    });
    captureRun(raw);
    const [entry] = loadRecordedErrors();
    assert.strictEqual(entry.exitCode, 9);
    assert.strictEqual(entry.relatedFiles.length, 10, 'related file metadata is bounded');
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

if (test('replaces a non-array state payload and supports the cwd-derived session key', () => {
  setupHome();
  try {
    fs.mkdirSync(path.dirname(getStatePath()), { recursive: true });
    fs.writeFileSync(getStatePath(), JSON.stringify({ stale: true }), 'utf8');
    const explicitFailure = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: {},
      error: 'Command exited with code 4',
    });
    captureRun(explicitFailure);
    assert.strictEqual(loadRecordedErrors().length, 1, 'an object state file must not poison future records');
    assert.deepStrictEqual(loadRecordedErrors()[0].relatedFiles, []);

    delete process.env.CLAUDE_SESSION_ID;
    const cwdHash = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
    const cwdState = path.join(homeDir, '.claude', 'tmp', `session-errors-${cwdHash}.json`);
    const fallbackFailure = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'node index.js' },
      error: 'Command exited with code 5',
    });
    captureRun(fallbackFailure);
    assert.strictEqual(JSON.parse(fs.readFileSync(cwdState, 'utf8'))[0].exitCode, 5);
  } finally {
    cleanupHome();
  }
})) passed++; else failed++;

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exitCode = 1;
}
