#!/usr/bin/env node
'use strict';

const {
  EVENT_TYPES,
  appendEventSync,
  createEvent,
} = require('./lib/harness-events');

function showHelp() {
  console.log(`
Usage: node scripts/record-harness-event.js --type task_outcome [options]

Records a privacy-preserving harness event for offline evaluation.

Required:
  --type <type>              Currently: task_outcome
  --episode <id>             Stable id linking injections and outcomes
  --outcome <outcome>        success, failure, or unknown

Optional:
  --task <id>                Golden task identifier
  --input-tokens <n>         Provider-reported input token count
  --output-tokens <n>        Provider-reported output token count
  --tool-calls <n>           Number of tool calls
  --duration-ms <n>          End-to-end duration
  --tests-passed <bool>      Deterministic verification result
  --human-intervention <bool>
  --session <id>             Harness session identifier
  --log <path>               Override the harness event log path
  --help                     Show this help text
`);
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseBoolean(value, flag) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} must be true or false`);
}

function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--type') options.type = requireValue(argv, index++, arg);
    else if (arg === '--episode') options.episodeId = requireValue(argv, index++, arg);
    else if (arg === '--session') options.sessionId = requireValue(argv, index++, arg);
    else if (arg === '--task') options.taskId = requireValue(argv, index++, arg);
    else if (arg === '--outcome') options.outcome = requireValue(argv, index++, arg);
    else if (arg === '--log') options.logPath = requireValue(argv, index++, arg);
    else if (arg === '--input-tokens') options.inputTokens = parseNumber(requireValue(argv, index++, arg), arg);
    else if (arg === '--output-tokens') options.outputTokens = parseNumber(requireValue(argv, index++, arg), arg);
    else if (arg === '--tool-calls') options.toolCalls = parseNumber(requireValue(argv, index++, arg), arg);
    else if (arg === '--duration-ms') options.durationMs = parseNumber(requireValue(argv, index++, arg), arg);
    else if (arg === '--tests-passed') options.testsPassed = parseBoolean(requireValue(argv, index++, arg), arg);
    else if (arg === '--human-intervention') options.humanIntervention = parseBoolean(requireValue(argv, index++, arg), arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  if (options.type !== EVENT_TYPES.TASK_OUTCOME) {
    throw new Error(`--type must be ${EVENT_TYPES.TASK_OUTCOME}`);
  }
  if (!options.episodeId) throw new Error('--episode is required');
  if (!options.outcome) throw new Error('--outcome is required');

  const event = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'record-harness-event',
    episodeId: options.episodeId,
    sessionId: options.sessionId,
    payload: {
      outcome: options.outcome,
      taskId: options.taskId,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      toolCalls: options.toolCalls,
      durationMs: options.durationMs,
      testsPassed: options.testsPassed,
      humanIntervention: options.humanIntervention,
    },
  });
  appendEventSync(event, options.logPath);
  console.log(`Recorded ${event.event_type} for episode ${event.episode_id}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
