'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  loadOntologyMaps,
  matchFileToDomain,
} = require('./ontology-routing');

const OBSERVATION_SCHEMA_VERSION = 1;
const OBSERVATION_EVENT_TYPE = 'file_changed';
const CANDIDATE_KIND = 'observed_file_change';
const CANDIDATE_STATUS = 'pending_review';
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_RECORDS = 100;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !path.isAbsolute(value)
    && value.split(/[\\/]/).every(segment => segment !== '..' && segment !== '');
}

function validateOntologyObservation(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['observation must be an object'] };
  }
  const allowed = new Set([
    'schemaVersion', 'id', 'eventType', 'sessionId', 'projectRoot', 'domainKey',
    'filePath', 'contentFingerprint', 'observedAt',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`unsupported field: ${key}`);
  }
  if (value.schemaVersion !== OBSERVATION_SCHEMA_VERSION) errors.push('schemaVersion must be 1');
  if (value.eventType !== OBSERVATION_EVENT_TYPE) errors.push('eventType must be file_changed');
  if (typeof value.id !== 'string' || !value.id.startsWith('ontology-observation-')) errors.push('id is invalid');
  if (value.sessionId !== null && value.sessionId !== undefined && typeof value.sessionId !== 'string') errors.push('sessionId is invalid');
  if (typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot)) errors.push('projectRoot must be absolute');
  if (typeof value.domainKey !== 'string' || value.domainKey.trim() === '') errors.push('domainKey is invalid');
  if (!isSafeRelativePath(value.filePath)) errors.push('filePath must be a safe relative path');
  if (typeof value.contentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentFingerprint)) {
    errors.push('contentFingerprint must be a SHA-256 hex digest');
  }
  if (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))) {
    errors.push('observedAt must be an ISO timestamp');
  }
  return { valid: errors.length === 0, errors };
}

function readOntologyObservationSpoolSlice(logPath, options = {}) {
  const offset = Number.isSafeInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;
  const maxRecords = Number.isSafeInteger(options.maxRecords) && options.maxRecords > 0 ? options.maxRecords : DEFAULT_MAX_RECORDS;
  if (!fs.existsSync(logPath)) {
    return { entries: [], nextOffset: offset, diagnostics: [], truncated: false };
  }

  const snapshotSize = fs.statSync(logPath).size;
  if (offset >= snapshotSize) {
    return { entries: [], nextOffset: offset, diagnostics: [], truncated: false };
  }
  const bytesToRead = Math.min(maxBytes, snapshotSize - offset);
  const buffer = Buffer.alloc(bytesToRead);
  const descriptor = fs.openSync(logPath, 'r');
  let bytesRead;
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, offset);
  } finally {
    fs.closeSync(descriptor);
  }

  const entries = [];
  const diagnostics = [];
  let cursor = 0;
  let nextOffset = offset;
  let recordCount = 0;
  while (cursor < bytesRead && recordCount < maxRecords) {
    const newline = buffer.indexOf(0x0a, cursor);
    if (newline === -1 || newline >= bytesRead) break;
    const line = buffer.subarray(cursor, newline).toString('utf8').replace(/\r$/, '');
    const lineEndOffset = offset + newline + 1;
    cursor = newline + 1;
    nextOffset = lineEndOffset;
    if (line.trim() === '') continue;
    recordCount += 1;
    try {
      const observation = JSON.parse(line);
      const validation = validateOntologyObservation(observation);
      if (!validation.valid) {
        diagnostics.push({ code: 'invalid_observation', lineHash: sha256(line), lineEndOffset });
      } else {
        entries.push({ observation, lineEndOffset });
      }
    } catch {
      diagnostics.push({ code: 'malformed_json', lineHash: sha256(line), lineEndOffset });
    }
  }
  return {
    entries,
    nextOffset,
    diagnostics,
    truncated: nextOffset < snapshotSize,
  };
}

function deriveOntologyCandidate(observation, options = {}) {
  const projectRoot = path.resolve(observation.projectRoot);
  const projectKey = sha256(projectRoot);
  const candidateKey = sha256(`${projectKey}:${observation.domainKey}:${observation.filePath}:${CANDIDATE_KIND}`);
  const timestamp = options.now || observation.observedAt;
  return {
    id: `ontology-candidate-${candidateKey.slice(0, 24)}`,
    candidateKey,
    projectKey,
    domainKey: observation.domainKey,
    filePath: observation.filePath,
    kind: CANDIDATE_KIND,
    status: CANDIDATE_STATUS,
    latestContentFingerprint: observation.contentFingerprint,
    firstObservedAt: observation.observedAt,
    lastObservedAt: observation.observedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateObservationAgainstProject(observation) {
  const projectRoot = path.resolve(observation.projectRoot);
  const filePath = path.resolve(projectRoot, observation.filePath);
  if (path.relative(projectRoot, filePath).startsWith('..') || !fs.existsSync(filePath)) return false;
  const actualFingerprint = sha256(fs.readFileSync(filePath));
  if (actualFingerprint !== observation.contentFingerprint) return false;
  try {
    const { fileMap } = loadOntologyMaps(projectRoot);
    const matched = matchFileToDomain({ filePath, ontologyRoot: projectRoot, fileMap });
    return matched && matched.domainKey === observation.domainKey;
  } catch {
    return false;
  }
}

function acquireDrainLock(logPath) {
  const lockPath = `${logPath}.drain.lock`;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const descriptor = fs.openSync(lockPath, 'wx');
    return {
      release() {
        try { fs.closeSync(descriptor); } catch { /* best effort */ }
        try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
      },
    };
  } catch (error) {
    if (error && error.code === 'EEXIST') return null;
    throw error;
  }
}

async function drainOntologyObservationSpool(options = {}) {
  const logPath = path.resolve(options.logPath);
  const lock = acquireDrainLock(logPath);
  if (!lock) {
    return { status: 'locked', created: 0, updated: 0, duplicates: 0, rejected: 0, checkpointOffset: null };
  }
  try {
    const stateStore = options.stateStore;
    if (!stateStore || typeof stateStore.getOntologyObservationCursor !== 'function'
        || typeof stateStore.applyOntologyObservationDrain !== 'function') {
      throw new Error('stateStore must provide ontology observation drain APIs');
    }
    const cursor = stateStore.getOntologyObservationCursor(logPath);
    const slice = readOntologyObservationSpoolSlice(logPath, {
      offset: cursor ? cursor.byteOffset : 0,
      maxBytes: options.maxBytes,
      maxRecords: options.maxRecords,
    });
    const entries = slice.entries
      .filter(entry => validateObservationAgainstProject(entry.observation))
      .map(entry => ({ ...entry, candidate: deriveOntologyCandidate(entry.observation, { now: options.now }) }));
    const rejected = slice.diagnostics.length + (slice.entries.length - entries.length);
    const result = stateStore.applyOntologyObservationDrain({
      spoolPath: logPath,
      entries,
      checkpointOffset: slice.nextOffset,
      drainedAt: options.now,
    });
    return {
      status: 'drained',
      ...result,
      rejected: result.rejected + rejected,
      checkpointOffset: slice.nextOffset,
    };
  } finally {
    lock.release();
  }
}

module.exports = {
  CANDIDATE_KIND,
  CANDIDATE_STATUS,
  deriveOntologyCandidate,
  drainOntologyObservationSpool,
  readOntologyObservationSpoolSlice,
  validateOntologyObservation,
};
