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

const WORKFLOW_LOCK_TTL_MS = 5 * 60 * 1000;
const MAX_WORKFLOW_LOCK_CLOCK_SKEW_MS = 60 * 1000;
const DUPLICATE_LOOKUP_RETRY_COUNT = 20;
const DUPLICATE_LOOKUP_RETRY_DELAY_MS = 25;

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
  const getUid = typeof process.getuid === 'function' ? () => process.getuid() : undefined;
  const repoStats = fs.lstatSync(repo);
  if (!isPrivateDirectory(repoStats, getUid)) {
    throw new Error('The --repo path must be a real directory');
  }
  const repoRoot = fs.realpathSync(repo);
  const requestedDb = path.resolve(db);
  const dbParent = path.dirname(requestedDb);
  const parentStats = fs.lstatSync(dbParent);
  if (!isPrivateDirectory(parentStats, getUid)) {
    throw new Error('The --db parent directory must be a real directory');
  }
  const realDbParent = fs.realpathSync(dbParent);
  assertPrivateDirectoryPath(repoRoot, realDbParent, getUid);
  const dbPath = path.join(realDbParent, path.basename(requestedDb));
  if (!isPathWithin(repoRoot, dbPath)) {
    throw new Error('The --db path must stay inside the repository root');
  }
  if (fs.existsSync(dbPath)) {
    const dbStats = fs.lstatSync(dbPath);
    if (!dbStats.isFile() || dbStats.isSymbolicLink()) throw new Error('The --db path must be a real file');
  }
  return { repoRoot, dbPath };
}

function lockPathFor(dbPath) {
  return `${dbPath}.ontology-maintain.lock`;
}

function sameFileIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

function isCurrentUserOwned(stats, getUid) {
  const uid = typeof getUid === 'function' ? getUid() : null;
  return stats && stats.isFile() && !stats.isSymbolicLink()
    && (uid === null || stats.uid === uid) && (stats.mode & 0o022) === 0;
}

function isPrivateDirectory(stats, getUid) {
  const uid = typeof getUid === 'function' ? getUid() : null;
  return stats && stats.isDirectory() && !stats.isSymbolicLink()
    && (uid === null || stats.uid === uid) && (stats.mode & 0o022) === 0;
}

function assertPrivateDirectoryPath(root, target, getUid) {
  if (target !== root && !isPathWithin(root, target)) {
    throw new Error('The --db parent directory must stay inside the repository root');
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative === '' ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!isPrivateDirectory(fs.lstatSync(current), getUid)) {
      throw new Error('The --db directory path must be private and free of symlinks');
    }
  }
}

function readWorkflowLockMetadata(lockPath) {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, { encoding: 'utf8', flag: 'r' }));
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 2 || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
    return value;
  } catch (_error) {
    return null;
  }
}

function isWorkflowLockStale(lockPath, { nowMs, isPidAlive, ttlMs }) {
  const stats = fs.lstatSync(lockPath);
  const metadata = readWorkflowLockMetadata(lockPath);
  const createdAtMs = metadata ? Date.parse(metadata.createdAt) : stats.mtimeMs;
  if (createdAtMs > nowMs + MAX_WORKFLOW_LOCK_CLOCK_SKEW_MS || nowMs - createdAtMs >= ttlMs) return true;
  return Boolean(metadata) && !isPidAlive(metadata.pid);
}

function unlinkWorkflowLockIfCurrent(lockPath, expectedStats, getUid, beforeUnlink) {
  try {
    const current = fs.lstatSync(lockPath);
    if (!sameFileIdentity(current, expectedStats) || !isCurrentUserOwned(current, getUid)) return false;
    if (typeof beforeUnlink === 'function') beforeUnlink();
    const finalCurrent = fs.lstatSync(lockPath);
    if (!sameFileIdentity(finalCurrent, expectedStats) || !isCurrentUserOwned(finalCurrent, getUid)) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function acquireWorkflowLock(dbPath, options = {}) {
  const lockPath = `${dbPath}.ontology-maintain.lock`;
  const nowMs = options.nowMs === undefined ? Date.now() : options.nowMs;
  const pid = options.pid === undefined ? process.pid : options.pid;
  const ttlMs = options.ttlMs === undefined ? WORKFLOW_LOCK_TTL_MS : options.ttlMs;
  const isPidAlive = options.isPidAlive || defaultIsPidAlive;
  const getUid = options.getUid || (typeof process.getuid === 'function' ? () => process.getuid() : undefined);
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(pid) || pid <= 0
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || typeof isPidAlive !== 'function') {
    throw new Error('Invalid ontology maintainer workflow lock options');
  }
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    const identity = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid, createdAt: new Date(nowMs).toISOString() })}\n`, 'utf8');
    return () => {
      try { fs.closeSync(descriptor); } catch (_error) { /* best effort */ }
      try { unlinkWorkflowLockIfCurrent(lockPath, identity, getUid, options.beforeReleaseUnlink); } catch (_error) { /* best effort */ }
    };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = fs.lstatSync(lockPath);
    if (!isCurrentUserOwned(existing, getUid) || !isWorkflowLockStale(lockPath, { nowMs, isPidAlive, ttlMs })) return null;
    if (!unlinkWorkflowLockIfCurrent(lockPath, existing, getUid, options.beforeReclaimUnlink)) return null;
    return acquireWorkflowLock(dbPath, options);
  }
}

async function findExistingJob(dbPath, idempotencyKey) {
  if (!fs.existsSync(dbPath)) return null;
  const stateStore = await createStateStore({ dbPath, homeDir: process.env.HOME || os.homedir(), readOnly: true });
  try {
    return stateStore.getOntologyMaintainerJobByIdempotencyKey(idempotencyKey);
  } finally {
    stateStore.close();
  }
}

async function findExistingJobAfterContention(dbPath, idempotencyKey) {
  for (let attempt = 0; attempt < DUPLICATE_LOOKUP_RETRY_COUNT; attempt += 1) {
    try {
      const job = await findExistingJob(dbPath, idempotencyKey);
      if (job) return job;
    } catch (_error) {
      // A concurrently published snapshot may become visible on the next bounded retry.
    }
    await new Promise(resolve => setTimeout(resolve, DUPLICATE_LOOKUP_RETRY_DELAY_MS));
  }
  return null;
}

function duplicateOrBindingDenial(existingJob, options) {
  if (!existingJob) return null;
  if (existingJob.provider !== options.provider || existingJob.candidateId !== options.candidate) {
    return { status: 'denied', reasonCode: 'idempotency_binding_invalid' };
  }
  if (existingJob.state === 'retryable_failure') return null;
  return { status: 'duplicate', job: jobForRuntime(existingJob) };
}

async function propose(options) {
  const { repoRoot, dbPath } = resolveCommandPaths(options);
  const currentRepoHead = readRepoHead(repoRoot);
  const prior = duplicateOrBindingDenial(await findExistingJob(dbPath, options.idempotencyKey), options);
  if (prior) return prior;
  const releaseLock = acquireWorkflowLock(dbPath);
  if (!releaseLock) {
    const afterContention = duplicateOrBindingDenial(
      await findExistingJobAfterContention(dbPath, options.idempotencyKey), options
    );
    return afterContention || { status: 'denied', reasonCode: 'workflow_locked' };
  }
  let stateStore;
  try {
    stateStore = await createStateStore({ dbPath, homeDir: process.env.HOME || os.homedir() });
    const existingJob = stateStore.getOntologyMaintainerJobByIdempotencyKey(options.idempotencyKey);
    const existingOutcome = duplicateOrBindingDenial(existingJob, options);
    if (existingOutcome) return existingOutcome;
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

module.exports = {
  DUPLICATE_LOOKUP_RETRY_COUNT,
  DUPLICATE_LOOKUP_RETRY_DELAY_MS,
  WORKFLOW_LOCK_TTL_MS,
  acquireWorkflowLock,
  assertPrivateDirectoryPath,
  createJob,
  duplicateOrBindingDenial,
  findExistingJob,
  findExistingJobAfterContention,
  isWorkflowLockStale,
  jobForRuntime,
  lockPathFor,
  main,
  parseArgs,
  propose,
  readWorkflowLockMetadata,
  resolveCommandPaths,
  usage,
};
