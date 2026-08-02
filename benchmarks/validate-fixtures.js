#!/usr/bin/env node
'use strict';

/**
 * Preflight validator for the model-performance benchmark corpus.
 *
 * Enforces the corpus contract from
 * docs/research/harness-evidence-protocol-2026-08.md §5:
 *
 *   1. baseline-failing  — the verifier fails on the untouched fixture, twice,
 *                          with an identical failure signature
 *   2. reference-passing — the verifier passes with the reference fix applied
 *   3. verifier placement — the verifier is not shipped inside workspace/, so
 *                          it is absent from the tree the agent is handed
 *   4. metadata          — required fields, known stratum, neutral-stratum flag
 *
 * A fixture that fails preflight must never be scored: a task that already
 * passes on a clean checkout measures nothing.
 *
 * Usage:
 *   node benchmarks/validate-fixtures.js [--fixture <id>] [--json]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  DEFAULT_FIXTURE_ROOT,
  listFixtureIds,
  prepareEpisode,
  readFixture,
} = require('./lib/fixtures');

const VERIFIER_TIMEOUT_MS = 120000;
const REQUIRED_FIELDS = ['id', 'prompt', 'stratum', 'tags', 'difficulty', 'success_criteria', 'provenance'];
const KNOWN_STRATA = new Set([
  'seeded-defect',
  'long-horizon',
  'brownfield-ambiguous',
  'security-regression',
  'failure-replay',
]);
const KNOWN_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

function parseArgs(argv) {
  const args = { fixture: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--fixture') {
      args.fixture = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function runVerifier(episode) {
  const started = Date.now();
  const child = spawnSync(process.execPath, ['../verify.js'], {
    cwd: episode.cwd,
    env: process.env,
    shell: false,
    timeout: VERIFIER_TIMEOUT_MS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timedOut = child.error?.code === 'ETIMEDOUT';
  const exitCode = Number.isInteger(child.status) ? child.status : null;
  return {
    exitCode,
    timedOut,
    errorCode: child.error?.code || null,
    passed: !timedOut && !child.error && exitCode === 0,
    durationMs: Date.now() - started,
    // Kept local for diagnostics only; never written to the event log.
    stderr: (child.stderr || '').trim(),
  };
}

function failureSignature(result) {
  return JSON.stringify({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    errorCode: result.errorCode,
    stderr: result.stderr,
  });
}

function validateMetadata(metadata) {
  const errors = REQUIRED_FIELDS
    .filter(field => !Object.prototype.hasOwnProperty.call(metadata, field))
    .map(field => `missing required field: ${field}`);

  if (metadata.stratum && !KNOWN_STRATA.has(metadata.stratum)) {
    errors.push(`unknown stratum: ${metadata.stratum}`);
  }
  if (metadata.difficulty && !KNOWN_DIFFICULTIES.has(metadata.difficulty)) {
    errors.push(`unknown difficulty: ${metadata.difficulty}`);
  }
  if (metadata.tags && (!Array.isArray(metadata.tags) || metadata.tags.length === 0)) {
    errors.push('tags must be a non-empty array');
  }
  if (metadata.success_criteria && (!Array.isArray(metadata.success_criteria) || metadata.success_criteria.length === 0)) {
    errors.push('success_criteria must be a non-empty array');
  }
  if (typeof metadata.omf_neutral !== 'boolean') {
    errors.push('omf_neutral must be a boolean (the neutral stratum is mandatory for bias control)');
  }
  // Absolute paths and home directories leak machine identity into a corpus
  // that is meant to be publishable.
  if (typeof metadata.prompt === 'string' && /(^|\s)(\/Users\/|\/home\/|[A-Z]:\\)/.test(metadata.prompt)) {
    errors.push('prompt contains an absolute path');
  }
  return errors;
}

function validateHiddenVerifier(fixture) {
  const errors = [];
  const workspaceVerifier = path.join(fixture.workspaceDir, 'verify.js');
  if (fs.existsSync(workspaceVerifier)) {
    errors.push('verify.js must not exist inside workspace/ — it would be handed straight to the agent');
  }
  return errors;
}

function validateFixture(taskId, fixtureRoot) {
  const fixture = readFixture(taskId, fixtureRoot);
  const errors = [
    ...validateMetadata(fixture.metadata),
    ...validateHiddenVerifier(fixture),
  ];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `omf-preflight-${taskId}-`));
  const checks = {};

  try {
    // 1. Baseline must fail deterministically, twice, in independent workspaces.
    const baselineAttempts = [1, 2].map(attempt => runVerifier(
      prepareEpisode({ taskId, episodeRoot: path.join(tempRoot, `baseline-${attempt}`), fixtureRoot, includeVerifier: true })
    ));

    checks.baselineFails = baselineAttempts.every(result => !result.passed);
    checks.baselineDeterministic = failureSignature(baselineAttempts[0]) === failureSignature(baselineAttempts[1]);
    checks.baselineCleanFailure = baselineAttempts.every(result => !result.timedOut && !result.errorCode);

    if (!checks.baselineFails) {
      errors.push('baseline verifier passes on the untouched fixture (ceiling effect — task measures nothing)');
    }
    if (!checks.baselineDeterministic) {
      errors.push('baseline failure is not deterministic across two isolated attempts');
    }
    if (!checks.baselineCleanFailure) {
      errors.push('baseline failed via timeout or spawn error rather than a verifier assertion');
    }

    // 2. The reference fix must make the verifier pass.
    const referenceResult = runVerifier(
      prepareEpisode({ taskId, episodeRoot: path.join(tempRoot, 'reference'), applyReference: true, includeVerifier: true, fixtureRoot })
    );
    checks.referencePasses = referenceResult.passed;
    if (!referenceResult.passed) {
      errors.push(`reference fix does not satisfy the verifier (exit ${referenceResult.exitCode}): ${referenceResult.stderr.split('\n')[0] || 'no stderr'}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    taskId,
    ok: errors.length === 0,
    snapshotHash: fixture.snapshotHash,
    stratum: fixture.metadata.stratum,
    difficulty: fixture.metadata.difficulty,
    omfNeutral: fixture.metadata.omf_neutral === true,
    checks,
    errors,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node benchmarks/validate-fixtures.js [--fixture <id>] [--json]');
    return 0;
  }

  const fixtureRoot = DEFAULT_FIXTURE_ROOT;
  const ids = args.fixture ? [args.fixture] : listFixtureIds(fixtureRoot);

  if (ids.length === 0) {
    console.error('No fixtures found under benchmarks/fixtures/');
    return 1;
  }

  const results = ids.map(id => {
    try {
      return validateFixture(id, fixtureRoot);
    } catch (error) {
      return { taskId: id, ok: false, checks: {}, errors: [error.message] };
    }
  });

  const failed = results.filter(result => !result.ok);
  const neutral = results.filter(result => result.omfNeutral).length;

  if (args.json) {
    console.log(JSON.stringify({
      fixtureRoot,
      total: results.length,
      passed: results.length - failed.length,
      omfNeutral: neutral,
      results,
    }, null, 2));
    return failed.length === 0 ? 0 : 1;
  }

  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`${status}  ${result.taskId}  [${result.stratum || '?'}/${result.difficulty || '?'}]${result.omfNeutral ? ' neutral' : ''}`);
    for (const error of result.errors) console.log(`      - ${error}`);
  }

  console.log(`\n${results.length - failed.length}/${results.length} fixtures passed preflight (${neutral} OMF-neutral)`);
  if (results.length < 15) {
    console.log(`NOTE: the registered pilot needs >=15 tasks; corpus currently has ${results.length}.`);
  }
  return failed.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`validate-benchmark-fixtures: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateFixture, validateMetadata, KNOWN_STRATA };
