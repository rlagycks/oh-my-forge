#!/usr/bin/env node
'use strict';

const {
  EVENT_TYPES,
  appendEventSync,
  createEvent,
} = require('./lib/harness-events');
const { createVerificationReceipt } = require('./lib/evidence-contract');
const { parseInteger, requireValue } = require('./lib/cli-args');

function showHelp() {
  console.log(`
Usage: node scripts/record-harness-event.js --type <type> [options]

Records a privacy-preserving harness event for offline evaluation.

Required:
  --type <type>              task_outcome or verification_receipt
  --episode <id>             Stable id linking related events (required for task_outcome)
  --outcome <outcome>        task_outcome: success, failure, or unknown
  --verifier <id>            verification_receipt: stable verifier identifier
  --subject <id>             verification_receipt: relative target identifier
  --exit-code <n>            verification_receipt: command exit code (required unless timed out or signaled)

Optional:
  --task <id>                Golden task identifier
  --input-tokens <n>         Provider-reported input token count
  --output-tokens <n>        Provider-reported output token count
  --tool-calls <n>           Number of tool calls
  --duration-ms <n>          End-to-end duration
  --tests-passed <bool>      Deterministic verification result
  --human-intervention <bool>
  --recall-used <bool>       Whether injected recall was explicitly used
  --timed-out <bool>         verification_receipt: command timed out
  --signal <name>            verification_receipt: process signal, if any
  --snapshot-hash <sha256>   verification_receipt: immutable snapshot identifier (manual records remain unknown)
  --session <id>             Harness session identifier
  --log <path>               Override the harness event log path
  --help                     Show this help text
`);
}

function parseBoolean(value, flag) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} must be true or false`);
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
    else if (arg === '--verifier') options.verifierId = requireValue(argv, index++, arg);
    else if (arg === '--subject') options.subject = requireValue(argv, index++, arg);
    else if (arg === '--exit-code') options.exitCode = parseInteger(requireValue(argv, index++, arg), arg);
    else if (arg === '--signal') options.signal = requireValue(argv, index++, arg);
    else if (arg === '--snapshot-hash') options.snapshotHash = requireValue(argv, index++, arg);
    else if (arg === '--log') options.logPath = requireValue(argv, index++, arg);
    else if (arg === '--input-tokens') options.inputTokens = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 0 });
    else if (arg === '--output-tokens') options.outputTokens = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 0 });
    else if (arg === '--tool-calls') options.toolCalls = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 0 });
    else if (arg === '--duration-ms') options.durationMs = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 0 });
    else if (arg === '--tests-passed') options.testsPassed = parseBoolean(requireValue(argv, index++, arg), arg);
    else if (arg === '--human-intervention') options.humanIntervention = parseBoolean(requireValue(argv, index++, arg), arg);
    else if (arg === '--recall-used') options.recallUsed = parseBoolean(requireValue(argv, index++, arg), arg);
    else if (arg === '--timed-out') options.timedOut = parseBoolean(requireValue(argv, index++, arg), arg);
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
  if (![EVENT_TYPES.TASK_OUTCOME, EVENT_TYPES.VERIFICATION_RECEIPT].includes(options.type)) {
    throw new Error(`--type must be ${EVENT_TYPES.TASK_OUTCOME} or ${EVENT_TYPES.VERIFICATION_RECEIPT}`);
  }

  const event = options.type === EVENT_TYPES.TASK_OUTCOME
    ? createTaskOutcomeEvent(options)
    : createVerificationReceiptEvent(options);
  appendEventSync(event, options.logPath);
  console.log(`Recorded ${event.event_type} for episode ${event.episode_id}`);
}

function createTaskOutcomeEvent(options) {
  if (!options.episodeId) throw new Error('--episode is required for task_outcome');
  if (!options.outcome) throw new Error('--outcome is required for task_outcome');

  return createEvent({
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
      recallUsed: options.recallUsed,
    },
  });
}

function createVerificationReceiptEvent(options) {
  if (!options.verifierId) throw new Error('--verifier is required for verification_receipt');
  if (!options.subject) throw new Error('--subject is required for verification_receipt');
  if (!Number.isInteger(options.exitCode)
    && options.timedOut !== true
    && !options.signal) {
    throw new Error('--exit-code is required unless --timed-out true or --signal is provided');
  }

  const receipt = createVerificationReceipt({
    verifierId: options.verifierId,
    subject: options.subject,
    exitCode: options.exitCode,
    timedOut: options.timedOut,
    signal: options.signal,
    snapshotHash: options.snapshotHash,
  });

  return createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'record-harness-event',
    episodeId: options.episodeId,
    sessionId: options.sessionId,
    payload: { verificationReceipt: receipt },
  });
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
