#!/usr/bin/env node
'use strict';

const {
  DEFAULT_TIMEOUT_MS,
  findGoldenTask,
  readGoldenTaskSuite,
  runGoldenTask,
} = require('./lib/golden-task-runner');

function showHelp() {
  console.log(`
Usage: node scripts/run-golden-task.js (--task <id> | --all) [options]

Runs deterministic golden-task verification argv without a shell and records
privacy-preserving task_outcome events.

Required:
  --task <id>                 Run one golden task
  --all                       Run every golden task sequentially

Options:
  --episode <id>              Episode id for a single task
  --episode-prefix <prefix>   Prefix for generated ids in --all mode
  --suite <path>              Golden task JSON path
  --cwd <path>                Verification working directory
  --timeout-ms <n>            Child timeout, 1-${600000} ms (default: ${DEFAULT_TIMEOUT_MS})
  --log <path>                Harness event log path
  --json                      Emit machine-readable results
  --help                      Show this help text
`);
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer`);
  return parsed;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--all') options.all = true;
    else if (arg === '--task') options.taskId = requireValue(argv, index++, arg);
    else if (arg === '--episode') options.episodeId = requireValue(argv, index++, arg);
    else if (arg === '--episode-prefix') options.episodePrefix = requireValue(argv, index++, arg);
    else if (arg === '--suite') options.suitePath = requireValue(argv, index++, arg);
    else if (arg === '--cwd') options.cwd = requireValue(argv, index++, arg);
    else if (arg === '--log') options.logPath = requireValue(argv, index++, arg);
    else if (arg === '--timeout-ms') options.timeoutMs = parseInteger(requireValue(argv, index++, arg), arg);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function createEpisodeId(options, taskId, runStartedAt) {
  if (options.episodeId) return options.episodeId;
  const prefix = options.episodePrefix || `golden-run-${runStartedAt}`;
  return `${prefix}:${taskId}`;
}

function formatHumanResult(result) {
  const status = result.outcome === 'success' ? 'PASS' : 'FAIL';
  const timeout = result.timedOut ? ' timeout=true' : '';
  return `${status} ${result.taskId} episode=${result.episodeId} exit=${result.exitCode ?? 'n/a'} duration_ms=${result.durationMs}${timeout}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  if (Boolean(options.taskId) === Boolean(options.all)) {
    throw new Error('Choose exactly one of --task or --all');
  }
  if (options.taskId && options.episodePrefix) {
    throw new Error('--episode-prefix is only valid with --all');
  }
  if (options.all && options.episodeId) {
    throw new Error('--episode is only valid with --task');
  }

  const suite = readGoldenTaskSuite(options.suitePath);
  const tasks = options.all ? suite.tasks : [findGoldenTask(suite, options.taskId)];
  if (!tasks[0]) throw new Error(`Unknown golden task: ${options.taskId}`);

  const runStartedAt = Date.now();
  const results = tasks.map(task => runGoldenTask(task, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    logPath: options.logPath,
    episodeId: createEpisodeId(options, task.id, runStartedAt),
  }));
  const report = {
    suite: suite.suite || null,
    total: results.length,
    passed: results.filter(result => result.outcome === 'success').length,
    failed: results.filter(result => result.outcome !== 'success').length,
    results,
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else results.forEach(result => console.log(formatHumanResult(result)));
  if (report.failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
