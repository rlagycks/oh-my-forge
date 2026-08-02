#!/usr/bin/env node
'use strict';

/**
 * Generate docs/evals/model-performance-tasks.json from benchmarks/fixtures/.
 *
 * The suite file is derived, never hand-edited: a fixture and its corpus entry
 * drifting apart would mean the runner scores a different task than the one
 * that passed preflight.
 *
 * Usage:
 *   node benchmarks/build-suite.js          # write
 *   node benchmarks/build-suite.js --check   # verify up to date
 */

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_FIXTURE_ROOT,
  VERIFIER_ARGV,
  computeCorpusHash,
  listFixtureIds,
  readFixture,
} = require('./lib/fixtures');

const OUTPUT_PATH = path.resolve(__dirname, '../docs/evals/model-performance-tasks.json');

function buildSuite(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const tasks = listFixtureIds(fixtureRoot).map(id => {
    const { metadata } = readFixture(id, fixtureRoot);
    return {
      id: metadata.id,
      prompt: metadata.prompt,
      provenance: metadata.provenance,
      tags: metadata.tags,
      difficulty: metadata.difficulty,
      stratum: metadata.stratum,
      omf_neutral: metadata.omf_neutral === true,
      success_criteria: metadata.success_criteria,
      verification: {
        // Resolved against the agent's cwd (the prepared workspace), so this
        // reaches the hidden verifier one level above it.
        argv: [...VERIFIER_ARGV],
        expected_exit_code: 0,
      },
    };
  });

  return {
    suite: 'model-performance',
    description: 'Baseline-failing model-performance corpus. Scored under docs/research/harness-evidence-protocol-2026-08.md. Generated from benchmarks/fixtures/ by benchmarks/build-suite.js — do not edit by hand.',
    protocol: 'docs/research/harness-evidence-protocol-2026-08.md',
    corpus_hash: computeCorpusHash(fixtureRoot),
    tasks,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const suite = buildSuite();
  const serialized = `${JSON.stringify(suite, null, 2)}\n`;

  if (check) {
    const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
    if (current !== serialized) {
      console.error('model-performance-tasks.json is out of date. Run: node benchmarks/build-suite.js');
      return 1;
    }
    console.log(`model-performance-tasks.json is up to date (${suite.tasks.length} tasks)`);
    return 0;
  }

  fs.writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${suite.tasks.length} tasks to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  console.log(`corpus_hash: ${suite.corpus_hash}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`build-model-performance-suite: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildSuite, OUTPUT_PATH };
