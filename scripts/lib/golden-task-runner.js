'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  EVENT_TYPES,
  appendEventSync,
  createEvent,
} = require('./harness-events');

const DEFAULT_SUITE_PATH = path.resolve(__dirname, '../../docs/evals/golden-tasks.json');
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const ALLOWED_VERIFICATION_COMMANDS = new Set(['node']);

function readGoldenTaskSuite(suitePath = DEFAULT_SUITE_PATH) {
  const resolvedPath = path.resolve(suitePath);
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new Error('Golden task suite must contain a tasks array');
  }

  const seenIds = new Set();
  for (const task of parsed.tasks) {
    const errors = validateGoldenTask(task);
    if (errors.length > 0) throw new Error(`Invalid golden task: ${errors.join('; ')}`);
    if (seenIds.has(task.id)) throw new Error(`Duplicate golden task id: ${task.id}`);
    seenIds.add(task.id);
  }

  return { ...parsed, suite_path: resolvedPath };
}

function validateGoldenTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return ['task must be an object'];
  }
  if (typeof task.id !== 'string' || task.id.trim() === '') errors.push('id must be non-empty');
  if (!task.verification || typeof task.verification !== 'object' || Array.isArray(task.verification)) {
    errors.push('verification must be an object');
    return errors;
  }
  const argv = task.verification.argv;
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(arg => typeof arg !== 'string' || arg.length === 0)) {
    errors.push('verification.argv must be a non-empty string array');
  } else if (!ALLOWED_VERIFICATION_COMMANDS.has(argv[0])) {
    errors.push(`verification command must be one of: ${[...ALLOWED_VERIFICATION_COMMANDS].join(', ')}`);
  }
  if (!Number.isInteger(task.verification.expected_exit_code)) {
    errors.push('verification.expected_exit_code must be an integer');
  }
  return errors;
}

function findGoldenTask(suite, taskId) {
  return suite.tasks.find(task => task.id === taskId) || null;
}

function executeVerification(task, { cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const validationErrors = validateGoldenTask(task);
  if (validationErrors.length > 0) throw new Error(`Invalid golden task: ${validationErrors.join('; ')}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }

  const [, ...args] = task.verification.argv;
  const startedAt = Date.now();
  let child;
  try {
    child = spawnSync(process.execPath, args, {
      cwd: path.resolve(cwd),
      env: process.env,
      shell: false,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch (error) {
    return {
      taskId: task.id,
      expectedExitCode: task.verification.expected_exit_code,
      exitCode: null,
      outcome: 'failure',
      testsPassed: false,
      timedOut: false,
      errorCode: error.code || 'SPAWN_ERROR',
      durationMs: Date.now() - startedAt,
    };
  }

  const timedOut = child.error?.code === 'ETIMEDOUT';
  const exitCode = Number.isInteger(child.status) ? child.status : null;
  const testsPassed = !timedOut && !child.error && exitCode === task.verification.expected_exit_code;
  return {
    taskId: task.id,
    expectedExitCode: task.verification.expected_exit_code,
    exitCode,
    outcome: testsPassed ? 'success' : 'failure',
    testsPassed,
    timedOut,
    errorCode: child.error?.code || null,
    durationMs: Date.now() - startedAt,
  };
}

function recordVerificationOutcome(result, { episodeId, logPath } = {}) {
  if (typeof episodeId !== 'string' || episodeId.trim() === '') {
    throw new Error('episodeId must be a non-empty string');
  }

  const event = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'run-golden-task',
    episodeId,
    payload: {
      taskId: result.taskId,
      outcome: result.outcome,
      testsPassed: result.testsPassed,
      durationMs: result.durationMs,
      verificationExitCode: result.exitCode,
      expectedExitCode: result.expectedExitCode,
      timedOut: result.timedOut,
      errorCode: result.errorCode,
    },
  });
  appendEventSync(event, logPath);
  return event;
}

function runGoldenTask(task, options = {}) {
  const result = executeVerification(task, options);
  const event = recordVerificationOutcome(result, options);
  return { ...result, episodeId: event.episode_id };
}

module.exports = {
  ALLOWED_VERIFICATION_COMMANDS,
  DEFAULT_SUITE_PATH,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  executeVerification,
  findGoldenTask,
  readGoldenTaskSuite,
  recordVerificationOutcome,
  runGoldenTask,
  validateGoldenTask,
};
