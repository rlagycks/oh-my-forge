#!/usr/bin/env node
'use strict';

const path = require('path');

const {
  DEFAULT_REPETITIONS,
  MAX_REPETITIONS,
  formatComparison,
  runPairedBenchmark,
} = require('./lib/paired-benchmark-runner');
const { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } = require('./lib/golden-task-runner');
const { parseInteger, requireValue } = require('./lib/cli-args');

function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function showHelp() {
  console.log(`
Usage: node scripts/run-paired-benchmark.js --adapter <path> [options]

Runs each golden task with harness on and off in randomized, repeated pairs.
The adapter owns provider execution; this runner never selects a network provider.

Required:
  --adapter <path>            CommonJS adapter module/function

Options:
  --suite <path>              Golden task JSON path
  --task <id>                 Run one task instead of the full suite
  --checkpoint <path>         Append each completed pair to a JSONL ledger
  --resume <path>             Reuse completed pairs from a previous ledger
  --snapshot-id <id>          Opaque snapshot identifier
  --snapshot-hash <hash>      Opaque snapshot hash
  --repetitions <n>           Pair repetitions, 1-${MAX_REPETITIONS} (default: ${DEFAULT_REPETITIONS})
  --seed <n>                  Recorded deterministic shuffle seed
  --timeout-ms <n>            Adapter and verification timeout, 1-${MAX_TIMEOUT_MS} ms (default: ${DEFAULT_TIMEOUT_MS})
  --max-cost-usd <n>          Stop before additional pairs after this reported cost
  --require-isolation          Require adapter prepare/verify snapshot proof for every condition
  --require-comparable         Require identical provider, model, and generation config for every condition
  --require-failing-baseline   Require every isolated episode to start with a deterministic verification failure
  --cwd <path>                Verification working directory
  --log <path>                Harness event log path
  --json                      Emit machine-readable JSON
  --help                      Show this help text
`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--adapter') options.adapterPath = requireValue(argv, index++, arg);
    else if (arg === '--suite') options.suitePath = requireValue(argv, index++, arg);
    else if (arg === '--task') options.taskId = requireValue(argv, index++, arg);
    else if (arg === '--snapshot-id') options.snapshotId = requireValue(argv, index++, arg);
    else if (arg === '--snapshot-hash') options.snapshotHash = requireValue(argv, index++, arg);
    else if (arg === '--repetitions') options.repetitions = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 1, maximum: MAX_REPETITIONS });
    else if (arg === '--seed') options.seed = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 0, maximum: 0xffffffff });
    else if (arg === '--timeout-ms') options.timeoutMs = parseInteger(requireValue(argv, index++, arg), arg, { minimum: 1, maximum: MAX_TIMEOUT_MS });
    else if (arg === '--max-cost-usd') options.maxCostUsd = parseNumber(requireValue(argv, index++, arg), arg);
    else if (arg === '--require-isolation') options.requireIsolation = true;
    else if (arg === '--require-comparable') options.requireComparable = true;
    else if (arg === '--require-failing-baseline') options.requireFailingBaseline = true;
    else if (arg === '--cwd') options.cwd = requireValue(argv, index++, arg);
    else if (arg === '--log') options.logPath = requireValue(argv, index++, arg);
    else if (arg === '--checkpoint') options.checkpointPath = requireValue(argv, index++, arg);
    else if (arg === '--resume') options.resumeFrom = requireValue(argv, index++, arg);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function loadAdapter(adapterPath) {
  if (!adapterPath) throw new Error('--adapter is required');
  const loaded = require(path.resolve(adapterPath));
  const adapter = loaded?.default || loaded;
  if (typeof adapter !== 'function' && typeof adapter?.run !== 'function') {
    throw new Error('Adapter module must export a function or an object with run');
  }
  return adapter;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  const report = await runPairedBenchmark({
    ...options,
    adapter: loadAdapter(options.adapterPath),
  });
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatComparison(report));
  const operationalFailure = report.limits.costExceeded
    || report.limits.timeoutCount > 0
    || report.comparison.pairs < report.pairs.length
    || report.results.some(result => result.errorCode);
  if (operationalFailure) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  // A run can abort after several pairs have already been paid for. If a
  // ledger was being written, say how to continue instead of losing them.
  const checkpointPath = process.argv[process.argv.indexOf('--checkpoint') + 1];
  if (process.argv.includes('--checkpoint') && checkpointPath) {
    console.error(`\nCompleted pairs were checkpointed to ${checkpointPath}.`);
    console.error(`Re-run the same command with --resume ${checkpointPath} to continue without paying for them again.`);
  }
  process.exit(1);
});
