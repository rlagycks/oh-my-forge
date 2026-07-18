#!/usr/bin/env node
'use strict';

const { buildReport, formatTable } = require('./lib/recall-report');
const { parseInteger } = require('./lib/cli-args');

function showHelp() {
  console.log(`
Usage: node scripts/recall-report.js [options]

Analyzes ~/.claude/logs/recall-hits.jsonl (domain-context-inject.js's
recall-hit instrumentation plus task outcome events) and reports per-domain
injection counts, recurrence rates, usefulness categories, outcome rates, and
episode-linked results. Reports use metadata only; prompts and source context
are never required.

Options:
  --log <path>      Override recall-hits.jsonl path
                     (default: ~/.claude/logs/recall-hits.jsonl)
  --since <window>  Only include hits within this window, e.g. 30m, 24h, 7d
  --max-bytes <n>   Bound the logical JSONL read (default: configured read limit)
  --max-events <n>  Bound the number of parsed events
  --json            Emit machine-readable JSON instead of a text table
  --help            Show this help text
`);
}

function requireValue(argv, index, argName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argName}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--log') {
      options.logPath = requireValue(argv, index, '--log');
      index += 1;
      continue;
    }

    if (arg === '--since') {
      options.since = requireValue(argv, index, '--since');
      index += 1;
      continue;
    }

    if (arg === '--max-bytes') {
      options.maxBytes = parseInteger(requireValue(argv, index, '--max-bytes'), arg, { minimum: 1 });
      index += 1;
      continue;
    }

    if (arg === '--max-events') {
      options.maxEvents = parseInteger(requireValue(argv, index, '--max-events'), arg, { minimum: 1 });
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    return;
  }

  const report = buildReport({
    logPath: options.logPath,
    since: options.since,
    maxBytes: options.maxBytes,
    maxEvents: options.maxEvents,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTable(report));
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
