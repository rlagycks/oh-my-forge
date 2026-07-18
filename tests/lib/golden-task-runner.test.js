'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  executeVerification,
  findGoldenTask,
  recordVerificationOutcome,
  readGoldenTaskSuite,
  runGoldenTask,
  validateGoldenTask,
} = require('../../scripts/lib/golden-task-runner');
const { readEvents } = require('../../scripts/lib/harness-events');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-task-runner-'));
  const suitePath = path.join(dir, 'suite.json');
  const logPath = path.join(dir, 'events.jsonl');
  const suite = {
    version: 1,
    suite: 'test-suite',
    tasks: [
      {
        id: 'pass-task',
        prompt: 'This prompt must never be written to the event log.',
        provenance: { source: 'tests/lib/golden-task-runner.test.js', incident: 'shell safety regression fixture' },
        tags: ['test', 'security'],
        difficulty: 'easy',
        success_criteria: ['The verification exits with the expected code'],
        verification: {
          argv: ['node', '-e', 'process.exit(process.argv[1] === "safe;touch" ? 0 : 1)', 'safe;touch'],
          expected_exit_code: 0,
        },
      },
      {
        id: 'expected-failure-task',
        prompt: 'Run a deterministic expected-failure fixture.',
        provenance: { source: 'tests/lib/golden-task-runner.test.js', incident: 'exit-code mismatch fixture' },
        tags: ['test', 'verification'],
        difficulty: 'easy',
        success_criteria: ['The mismatch is recorded as a failure'],
        verification: { argv: ['node', '-e', 'process.exit(2)'], expected_exit_code: 0 },
      },
      {
        id: 'timeout-task',
        prompt: 'Run a deterministic timeout fixture.',
        provenance: { source: 'tests/lib/golden-task-runner.test.js', incident: 'timeout handling fixture' },
        tags: ['test', 'timeout'],
        difficulty: 'easy',
        success_criteria: ['The timeout is recorded as a failure'],
        verification: { argv: ['node', '-e', 'setTimeout(() => {}, 200)'], expected_exit_code: 0 },
      },
    ],
  };
  fs.writeFileSync(suitePath, `${JSON.stringify(suite)}\n`, 'utf8');
  return { dir, suitePath, logPath };
}

test('loads the checked-in suite and validates node-only verification argv', () => {
  const suite = readGoldenTaskSuite(path.resolve(__dirname, '../../docs/evals/golden-tasks.json'));
  assert.ok(suite.tasks.length >= 10);
  assert.deepStrictEqual(validateGoldenTask(suite.tasks[0]), []);
  assert.ok(validateGoldenTask({ id: 'shell', verification: { argv: ['sh', '-c', 'echo unsafe'], expected_exit_code: 0 } }).length > 0);
  assert.strictEqual(findGoldenTask(suite, 'missing-task'), null);
});

test('rejects malformed task definitions and duplicate ids', () => {
  assert.ok(validateGoldenTask(null).length > 0);
  assert.ok(validateGoldenTask([]).length > 0);
  assert.ok(validateGoldenTask({ id: '', verification: null }).length > 0);
  assert.ok(validateGoldenTask({
    id: 'bad-argv',
    verification: { argv: ['node', ''], expected_exit_code: '0' },
  }).length > 0);

  const fixture = makeFixture();
  try {
    const parsed = JSON.parse(fs.readFileSync(fixture.suitePath, 'utf8'));
    parsed.tasks.push({ ...parsed.tasks[0] });
    fs.writeFileSync(fixture.suitePath, JSON.stringify(parsed), 'utf8');
    assert.throws(() => readGoldenTaskSuite(fixture.suitePath), /Duplicate golden task id/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('rejects tasks missing required corpus metadata', () => {
  const baseTask = {
    id: 'metadata-task',
    prompt: 'A complete deterministic task.',
    provenance: { source: 'docs/qa/bug-topology.md', incident: 'documented failure pattern' },
    tags: ['qa'],
    difficulty: 'medium',
    success_criteria: ['A deterministic check passes'],
    verification: { argv: ['node', '--version'], expected_exit_code: 0 },
  };

  for (const field of ['prompt', 'provenance', 'tags', 'difficulty', 'success_criteria', 'verification']) {
    const task = { ...baseTask };
    delete task[field];
    assert.ok(validateGoldenTask(task).some(error => error.startsWith(field)), `missing ${field} should be rejected`);
  }
  assert.ok(validateGoldenTask({ ...baseTask, provenance: { source: '' } }).some(error => error.includes('provenance')));
  assert.ok(validateGoldenTask({ ...baseTask, tags: ['qa', ''] }).some(error => error.includes('tags')));
  assert.ok(validateGoldenTask({ ...baseTask, difficulty: 'trivial' }).some(error => error.includes('difficulty')));
  assert.ok(validateGoldenTask({ ...baseTask, success_criteria: [''] }).some(error => error.includes('success_criteria')));
});

test('metadata cannot overwrite verification outcome fields', () => {
  const fixture = makeFixture();
  try {
    const event = recordVerificationOutcome({
      taskId: 'pass-task',
      outcome: 'success',
      testsPassed: true,
      durationMs: 12,
      exitCode: 0,
      expectedExitCode: 0,
      timedOut: false,
      errorCode: null,
    }, {
      episodeId: 'episode-metadata',
      logPath: fixture.logPath,
      metadata: { outcome: 'failure', taskId: 'spoofed-task', testsPassed: false },
    });
    assert.strictEqual(event.payload.outcome, 'success');
    assert.strictEqual(event.payload.task_id, 'pass-task');
    assert.strictEqual(event.payload.tests_passed, true);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('runs argv without shell interpolation and records no prompt or output text', () => {
  const fixture = makeFixture();
  try {
    const result = runGoldenTask(readGoldenTaskSuite(fixture.suitePath).tasks[0], {
      episodeId: 'episode-safe',
      logPath: fixture.logPath,
      cwd: fixture.dir,
      timeoutMs: 1000,
    });
    assert.strictEqual(result.outcome, 'success');
    assert.strictEqual(result.testsPassed, true);
    assert.strictEqual(fs.existsSync(path.join(fixture.dir, 'safe;touch')), false);
    const logText = fs.readFileSync(fixture.logPath, 'utf8');
    assert.ok(!logText.includes('This prompt must never be written'));
    assert.ok(!logText.includes('safe;touch'));
    const { events } = readEvents(fixture.logPath);
    assert.strictEqual(events[0].payload.task_id, 'pass-task');
    assert.strictEqual(events[0].payload.tests_passed, true);
    assert.strictEqual(events[0].episode_id, 'episode-safe');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('records expected failures and timeout failures with safe metadata', () => {
  const fixture = makeFixture();
  try {
    const suite = readGoldenTaskSuite(fixture.suitePath);
    const failedResult = runGoldenTask(suite.tasks[1], {
      episodeId: 'episode-failed', logPath: fixture.logPath, cwd: fixture.dir, timeoutMs: 1000,
    });
    const timeoutResult = runGoldenTask(suite.tasks[2], {
      episodeId: 'episode-timeout', logPath: fixture.logPath, cwd: fixture.dir, timeoutMs: 20,
    });
    assert.strictEqual(failedResult.outcome, 'failure');
    assert.strictEqual(timeoutResult.outcome, 'failure');
    assert.strictEqual(timeoutResult.timedOut, true);
    const { events } = readEvents(fixture.logPath);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].payload.timed_out, true);
    assert.strictEqual(events[1].payload.error_code, 'ETIMEDOUT');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('returns a non-success result when the expected exit code does not match', () => {
  const result = executeVerification({
    id: 'mismatch',
    prompt: 'Run a deterministic mismatch fixture.',
    provenance: { source: 'tests/lib/golden-task-runner.test.js', incident: 'exit-code mismatch fixture' },
    tags: ['test', 'verification'],
    difficulty: 'easy',
    success_criteria: ['The mismatch is reported as failure'],
    verification: { argv: ['node', '-e', 'process.exit(3)'], expected_exit_code: 0 },
  }, { timeoutMs: 1000 });
  assert.strictEqual(result.outcome, 'failure');
  assert.strictEqual(result.exitCode, 3);
  assert.strictEqual(result.errorCode, null);
});

test('handles invalid timeout, missing episode, and spawn errors without output capture', () => {
  const task = {
    id: 'error-paths',
    prompt: 'Exercise timeout and spawn error handling.',
    provenance: { source: 'tests/lib/golden-task-runner.test.js', incident: 'verification error-path fixture' },
    tags: ['test', 'errors'],
    difficulty: 'medium',
    success_criteria: ['Invalid execution inputs fail safely'],
    verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
  };
  assert.throws(() => executeVerification(task, { timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => recordVerificationOutcome({ taskId: 'error-paths' }, { episodeId: '' }), /episodeId/);

  const result = executeVerification(task, {
    cwd: path.join(os.tmpdir(), 'missing-golden-task-cwd'),
    timeoutMs: 1000,
  });
  assert.strictEqual(result.outcome, 'failure');
  assert.strictEqual(result.errorCode, 'ENOENT');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
