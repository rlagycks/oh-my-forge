#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateStore } = require('./lib/state-store');
const { runOntologyMaintainerDryRun } = require('./lib/ontology-maintainer');
const { executeOntologyMaintainerJob } = require('./lib/ontology-maintainer-runtime');
const { readRepoHead } = require('./lib/ontology-maintainer-promotion');

function usage() {
  return [
    'Usage: node scripts/ontology-maintain.js propose --candidate <id> --provider <claude_code|codex_cli>',
    '  --binary <absolute trusted executable> --db <state.db> --repo <repository root> --idempotency-key <key>',
    '',
    'Creates a read-only semantic proposal only. Human approval and guarded promotion are separate workflows.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  if (args.shift() !== 'propose') throw new Error(`Only the foreground "propose" action is supported\n${usage()}`);
  const options = { action: 'propose' };
  const flags = new Set(['--candidate', '--provider', '--binary', '--db', '--repo', '--idempotency-key']);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flags.has(flag) || !args[index + 1]) throw new Error(`Invalid argument: ${flag}\n${usage()}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`Duplicate argument: ${flag}`);
    options[key] = args[index + 1];
    index += 1;
  }
  for (const key of ['candidate', 'provider', 'binary', 'db', 'repo', 'idempotencyKey']) {
    if (typeof options[key] !== 'string' || options[key].trim() === '') throw new Error(`Missing required --${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} argument`);
  }
  return options;
}

function createJob({ candidateId, provider, idempotencyKey, reviewPackageSha256, candidateFingerprint, repoHead }) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_job',
    id: `ontology-maintainer-job-${crypto.randomUUID()}`,
    idempotencyKey,
    provider,
    candidateId,
    reviewPackageSha256,
    candidateFingerprint,
    repoHead,
    hop: 0,
    hopLimit: 1,
    createdAt: new Date().toISOString(),
  };
}

function jobForRuntime(job) {
  return {
    schemaVersion: job.schemaVersion,
    type: job.type,
    id: job.id,
    idempotencyKey: job.idempotencyKey,
    provider: job.provider,
    candidateId: job.candidateId,
    reviewPackageSha256: job.reviewPackageSha256,
    candidateFingerprint: job.candidateFingerprint,
    repoHead: job.repoHead,
    hop: job.hop,
    hopLimit: job.hopLimit,
    createdAt: job.createdAt,
  };
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveCommandPaths({ repo, db }) {
  if (!path.isAbsolute(repo) || !path.isAbsolute(db) || db === ':memory:') {
    throw new Error('The --repo and --db paths must be absolute filesystem paths');
  }
  const repoStats = fs.lstatSync(repo);
  if (!repoStats.isDirectory() || repoStats.isSymbolicLink()) {
    throw new Error('The --repo path must be a real directory');
  }
  const repoRoot = fs.realpathSync(repo);
  const requestedDb = path.resolve(db);
  const dbParent = path.dirname(requestedDb);
  const parentStats = fs.lstatSync(dbParent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error('The --db parent directory must be a real directory');
  }
  const dbPath = path.join(fs.realpathSync(dbParent), path.basename(requestedDb));
  if (!isPathWithin(repoRoot, dbPath)) {
    throw new Error('The --db path must stay inside the repository root');
  }
  if (fs.existsSync(dbPath)) {
    const dbStats = fs.lstatSync(dbPath);
    if (!dbStats.isFile() || dbStats.isSymbolicLink()) throw new Error('The --db path must be a real file');
  }
  return { repoRoot, dbPath };
}

function acquireWorkflowLock(dbPath) {
  const lockPath = `${dbPath}.ontology-maintain.lock`;
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    return () => {
      try { fs.closeSync(descriptor); } catch (_error) { /* best effort */ }
      try { fs.unlinkSync(lockPath); } catch (_error) { /* best effort */ }
    };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return null;
  }
}

async function propose(options) {
  const { repoRoot, dbPath } = resolveCommandPaths(options);
  const currentRepoHead = readRepoHead(repoRoot);
  const releaseLock = acquireWorkflowLock(dbPath);
  if (!releaseLock) return { status: 'denied', reasonCode: 'workflow_locked' };
  let stateStore;
  try {
    stateStore = await createStateStore({ dbPath, homeDir: process.env.HOME || os.homedir() });
    const existingJob = stateStore.getOntologyMaintainerJobByIdempotencyKey(options.idempotencyKey);
    if (existingJob && (existingJob.provider !== options.provider || existingJob.candidateId !== options.candidate)) {
      return { status: 'denied', reasonCode: 'idempotency_binding_invalid' };
    }
    const existingAttempt = existingJob && stateStore.listOntologyMaintainerAttempts({ candidateId: options.candidate })
      .find(item => item.reviewPackageSha256 === existingJob.reviewPackageSha256);
    const review = existingAttempt
      ? { status: 'review_package_ready', reviewPackage: existingAttempt.reviewPackage }
      : runOntologyMaintainerDryRun({ candidateId: options.candidate, stateStore });
    if (review.status !== 'review_package_ready' || !review.reviewPackage) return review;
    const attempt = existingAttempt || stateStore.listOntologyMaintainerAttempts({ candidateId: options.candidate })
      .find(item => item.reviewPackageSha256);
    if (!attempt) throw new Error('Unable to bind the materialized review package');
    const job = existingJob || createJob({
      candidateId: options.candidate,
      provider: options.provider,
      idempotencyKey: options.idempotencyKey,
      reviewPackageSha256: attempt.reviewPackageSha256,
      candidateFingerprint: review.reviewPackage.candidate.latestContentFingerprint,
      repoHead: currentRepoHead,
    });
    return await executeOntologyMaintainerJob({
      job: jobForRuntime(job), reviewPackage: review.reviewPackage, stateStore, currentRepoHead,
      providerCapabilities: { [options.provider]: { binaryPath: options.binary } },
      spawnProcess: spawn,
    });
  } finally {
    if (stateStore) stateStore.close();
    releaseLock();
  }
}

async function main(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await propose(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { acquireWorkflowLock, createJob, jobForRuntime, main, parseArgs, propose, resolveCommandPaths, usage };
