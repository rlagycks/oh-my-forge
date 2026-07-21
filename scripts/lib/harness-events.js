'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { validateVerificationReceipt } = require('./evidence-contract');

const EVENT_SCHEMA_VERSION = 1;
const DEFAULT_EVENT_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_EVENT_LOG_RETENTION = 5;
const DEFAULT_EVENT_LOG_READ_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_EVENT_LOG_READ_MAX_EVENTS = 100000;
const EVENT_LOG_READ_CHUNK_BYTES = 64 * 1024;
const MAX_RETENTION_FILES = 100;
const ROTATION_LOCK_STALE_MS = 30 * 1000;
const EVENT_TYPES = Object.freeze({
  CONTEXT_INJECTION: 'context_injection',
  TASK_OUTCOME: 'task_outcome',
  VERIFICATION_RECEIPT: 'verification_receipt',
});
const OUTCOMES = new Set(['success', 'failure', 'unknown']);

function getDefaultEventLogPath() {
  return process.env.OMF_HARNESS_EVENT_LOG
    ? path.resolve(process.env.OMF_HARNESS_EVENT_LOG)
    : path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl');
}

function parseConfiguredInteger(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function parseExplicitInteger(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function getEventLogConfig(options = {}) {
  const maxBytes = options.maxBytes !== undefined
    ? options.maxBytes === null
      ? null
      : parseExplicitInteger(options.maxBytes, 'maxBytes')
    : parseConfiguredInteger(
      process.env.OMF_HARNESS_EVENT_LOG_MAX_BYTES,
      DEFAULT_EVENT_LOG_MAX_BYTES,
      { maximum: Number.MAX_SAFE_INTEGER }
    );
  const retention = options.retention !== undefined
    ? parseConfiguredInteger(options.retention, DEFAULT_EVENT_LOG_RETENTION, { maximum: MAX_RETENTION_FILES })
    : parseConfiguredInteger(
      process.env.OMF_HARNESS_EVENT_LOG_RETENTION,
      DEFAULT_EVENT_LOG_RETENTION,
      { maximum: MAX_RETENTION_FILES }
    );
  return { maxBytes, retention };
}

function getEventLogReadConfig(options = {}) {
  const maxBytes = options.maxBytes !== undefined
    ? parseConfiguredInteger(options.maxBytes, null, { maximum: Number.MAX_SAFE_INTEGER })
    : parseConfiguredInteger(
      process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES,
      DEFAULT_EVENT_LOG_READ_MAX_BYTES,
      { maximum: Number.MAX_SAFE_INTEGER }
    );
  const maxEvents = options.maxEvents !== undefined
    ? parseConfiguredInteger(options.maxEvents, null, { minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
    : parseConfiguredInteger(
      process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS,
      DEFAULT_EVENT_LOG_READ_MAX_EVENTS,
      { minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
    );
  return { maxBytes, maxEvents };
}

function toSnakeCaseKey(key) {
  return String(key).replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
}

function normalizePayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [toSnakeCaseKey(key), value])
  );
}

function createEvent({ eventType, source, episodeId = null, sessionId = null, payload = {}, ts } = {}) {
  return {
    schema_version: EVENT_SCHEMA_VERSION,
    event_type: eventType,
    ts: ts || new Date().toISOString(),
    source: String(source || 'unknown'),
    episode_id: episodeId || null,
    session_id: sessionId || null,
    payload: normalizePayload(payload),
  };
}

function validateEvent(event, options = {}) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, errors: ['event must be an object'] };
  }
  if (event.schema_version !== EVENT_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${EVENT_SCHEMA_VERSION}`);
  }
  if (!Object.values(EVENT_TYPES).includes(event.event_type)) {
    errors.push(`event_type must be one of ${Object.values(EVENT_TYPES).join(', ')}`);
  }
  if (typeof event.ts !== 'string' || !Number.isFinite(Date.parse(event.ts))) {
    errors.push('ts must be an ISO-8601 timestamp');
  }
  if (typeof event.source !== 'string' || event.source.trim() === '') {
    errors.push('source must be a non-empty string');
  }
  if (Object.prototype.hasOwnProperty.call(event, 'episode_id')
      && event.episode_id !== null
      && typeof event.episode_id !== 'string') {
    errors.push('episode_id must be a string or null');
  }
  if (Object.prototype.hasOwnProperty.call(event, 'session_id')
      && event.session_id !== null
      && typeof event.session_id !== 'string') {
    errors.push('session_id must be a string or null');
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    errors.push('payload must be an object');
  }

  if (event.event_type === EVENT_TYPES.CONTEXT_INJECTION) {
    if (typeof event.payload?.domain !== 'string' || event.payload.domain.trim() === '') {
      errors.push('context_injection payload.domain must be a non-empty string');
    }
    for (const field of ['constraint_ids', 'memory_ids']) {
      if (event.payload?.[field] === undefined) continue;
      const values = event.payload[field];
      if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.trim() === '')
          || new Set(values).size !== values.length) {
        errors.push(`context_injection payload.${field} must be a unique string array`);
      }
    }
    for (const field of ['constraint_id', 'memory_id']) {
      if (event.payload?.[field] !== undefined
          && (typeof event.payload[field] !== 'string' || event.payload[field].trim() === '')) {
        errors.push(`context_injection payload.${field} must be a non-empty string`);
      }
    }
  }

  if (event.event_type === EVENT_TYPES.TASK_OUTCOME) {
    if (!OUTCOMES.has(event.payload?.outcome)) {
      errors.push('task_outcome payload.outcome must be success, failure, or unknown');
    }
    if (event.payload?.recall_used !== undefined && typeof event.payload.recall_used !== 'boolean') {
      errors.push('task_outcome payload.recall_used must be boolean');
    }
  }

  if (event.event_type === EVENT_TYPES.VERIFICATION_RECEIPT) {
    const payloadKeys = Object.keys(event.payload || {});
    if (payloadKeys.length !== 1 || payloadKeys[0] !== 'verification_receipt') {
      errors.push('verification_receipt payload may contain only verification_receipt');
    }
    const receiptResult = validateVerificationReceipt(event.payload?.verification_receipt, options);
    if (!receiptResult.valid) {
      errors.push(...receiptResult.errors.map(error => `verification_receipt ${error}`));
    }
  }

  return { valid: errors.length === 0, errors };
}

function assertValidEvent(event) {
  const result = validateEvent(event, { verifySignature: true });
  if (!result.valid) {
    throw new Error(`Invalid harness event: ${result.errors.join('; ')}`);
  }
  return event;
}

function getRotatedLogPath(logPath, generation) {
  return `${logPath}.${generation}`;
}

function createRotationLockToken() {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function openRotationLockSync(lockPath) {
  const fd = fs.openSync(lockPath, 'wx');
  const token = createRotationLockToken();
  try {
    fs.writeSync(fd, token, null, 'utf8');
    return { fd, lockPath, token };
  } catch (error) {
    try { fs.closeSync(fd); } catch (_cleanupError) { /* best effort */ }
    try { fs.unlinkSync(lockPath); } catch (_cleanupError) { /* best effort */ }
    throw error;
  }
}

function acquireRotationLock(logPath) {
  const lockPath = `${logPath}.lock`;
  try {
    return openRotationLockSync(lockPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (ageMs > ROTATION_LOCK_STALE_MS) {
        try {
          fs.unlinkSync(lockPath);
        } catch (unlinkError) {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        }
        try {
          return openRotationLockSync(lockPath);
        } catch (openError) {
          if (openError.code !== 'EEXIST') throw openError;
        }
      }
    } catch (staleLockError) {
      if (staleLockError.code !== 'EEXIST' && staleLockError.code !== 'ENOENT') throw staleLockError;
    }
    return null;
  }
}

function ownsRotationLockSync(lock) {
  try {
    return fs.readFileSync(lock.lockPath, 'utf8') === lock.token;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function releaseRotationLock(lock) {
  if (!lock) return;
  let closeError = null;
  let unlinkError = null;
  try {
    fs.closeSync(lock.fd);
  } catch (error) {
    closeError = error;
  }
  try {
    if (ownsRotationLockSync(lock)) fs.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') unlinkError = error;
  }
  if (closeError) throw closeError;
  if (unlinkError) throw unlinkError;
}

async function openRotationLockAsync(lockPath) {
  const handle = await fs.promises.open(lockPath, 'wx');
  const token = createRotationLockToken();
  try {
    await handle.writeFile(token, 'utf8');
    return { handle, lockPath, token };
  } catch (error) {
    try { await handle.close(); } catch (_cleanupError) { /* best effort */ }
    try { await fs.promises.unlink(lockPath); } catch (_cleanupError) { /* best effort */ }
    throw error;
  }
}

async function acquireRotationLockAsync(logPath) {
  const lockPath = `${logPath}.lock`;
  try {
    return await openRotationLockAsync(lockPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const stat = await fs.promises.stat(lockPath);
      if (Date.now() - stat.mtimeMs > ROTATION_LOCK_STALE_MS) {
        await fs.promises.unlink(lockPath).catch(unlinkError => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
        try {
          return await openRotationLockAsync(lockPath);
        } catch (openError) {
          if (openError.code !== 'EEXIST') throw openError;
        }
      }
    } catch (staleLockError) {
      if (staleLockError.code !== 'EEXIST' && staleLockError.code !== 'ENOENT') throw staleLockError;
    }
    return null;
  }
}

async function ownsRotationLockAsync(lock) {
  try {
    return await fs.promises.readFile(lock.lockPath, 'utf8') === lock.token;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function releaseRotationLockAsync(lock) {
  if (!lock) return;
  let closeError = null;
  let unlinkError = null;
  try {
    await lock.handle.close();
  } catch (error) {
    closeError = error;
  }
  try {
    if (await ownsRotationLockAsync(lock)) await fs.promises.unlink(lock.lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') unlinkError = error;
  }
  if (closeError) throw closeError;
  if (unlinkError) throw unlinkError;
}

function assertRotationLockOwnershipSync(lock) {
  if (lock && !ownsRotationLockSync(lock)) {
    const error = new Error('Rotation lock ownership was lost');
    error.code = 'ELOCKLOST';
    throw error;
  }
}

async function assertRotationLockOwnershipAsync(lock) {
  if (lock && !(await ownsRotationLockAsync(lock))) {
    const error = new Error('Rotation lock ownership was lost');
    error.code = 'ELOCKLOST';
    throw error;
  }
}

function replaceRenameSync(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    try {
      fs.unlinkSync(targetPath);
    } catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    }
    fs.renameSync(sourcePath, targetPath);
  }
}

async function replaceRenameAsync(sourcePath, targetPath) {
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    await fs.promises.unlink(targetPath).catch(unlinkError => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    await fs.promises.rename(sourcePath, targetPath);
  }
}

function rotateEventLogSync(logPath, incomingBytes, options = {}) {
  const { maxBytes, retention } = getEventLogConfig(options);
  if (!maxBytes || retention < 1 || !fs.existsSync(logPath)) return false;
  const currentBytes = fs.statSync(logPath).size;
  if (currentBytes === 0 || currentBytes + incomingBytes <= maxBytes) return false;

  for (let generation = retention - 1; generation >= 1; generation -= 1) {
    const olderPath = getRotatedLogPath(logPath, generation);
    const newerPath = getRotatedLogPath(logPath, generation + 1);
    if (!fs.existsSync(olderPath)) continue;
    try {
      replaceRenameSync(olderPath, newerPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  replaceRenameSync(logPath, getRotatedLogPath(logPath, 1));
  return true;
}

async function rotateEventLogAsync(logPath, incomingBytes, options = {}) {
  const { maxBytes, retention } = getEventLogConfig(options);
  let current;
  try {
    current = await fs.promises.stat(logPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!maxBytes || retention < 1 || current.size === 0 || current.size + incomingBytes <= maxBytes) return false;

  for (let generation = retention - 1; generation >= 1; generation -= 1) {
    const olderPath = getRotatedLogPath(logPath, generation);
    const newerPath = getRotatedLogPath(logPath, generation + 1);
    try {
      await replaceRenameAsync(olderPath, newerPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  await replaceRenameAsync(logPath, getRotatedLogPath(logPath, 1));
  return true;
}

function shouldAttemptRotationSync(logPath, incomingBytes, config) {
  if (!config.maxBytes || config.retention < 1) return false;
  try {
    const currentBytes = fs.statSync(logPath).size;
    return currentBytes > 0 && currentBytes + incomingBytes > config.maxBytes;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function shouldAttemptRotationAsync(logPath, incomingBytes, config) {
  if (!config.maxBytes || config.retention < 1) return false;
  try {
    const currentBytes = (await fs.promises.stat(logPath)).size;
    return currentBytes > 0 && currentBytes + incomingBytes > config.maxBytes;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function appendEventSync(event, logPath = getDefaultEventLogPath(), options = {}) {
  assertValidEvent(event);
  const resolvedPath = path.resolve(logPath);
  const line = `${JSON.stringify(event)}\n`;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const config = getEventLogConfig(options);
  const rotationCandidate = shouldAttemptRotationSync(resolvedPath, Buffer.byteLength(line), config);
  const lock = rotationCandidate ? acquireRotationLock(resolvedPath) : null;
  let rotated = false;
  try {
    assertRotationLockOwnershipSync(lock);
    if (lock) rotated = rotateEventLogSync(resolvedPath, Buffer.byteLength(line), config);
    assertRotationLockOwnershipSync(lock);
    fs.appendFileSync(resolvedPath, line, { encoding: 'utf8', flag: 'a' });
  } finally {
    releaseRotationLock(lock);
  }

  return { logPath: resolvedPath, rotated, rotationSkipped: rotationCandidate && !lock };
}

function appendEventAsync(event, logPath = getDefaultEventLogPath(), options = {}) {
  return (async () => {
    try {
      assertValidEvent(event);
      const resolvedPath = path.resolve(logPath);
      const line = `${JSON.stringify(event)}\n`;
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      const config = getEventLogConfig(options);
      const rotationCandidate = await shouldAttemptRotationAsync(resolvedPath, Buffer.byteLength(line), config);
      const lock = rotationCandidate ? await acquireRotationLockAsync(resolvedPath) : null;
      let rotated = false;
      try {
        await assertRotationLockOwnershipAsync(lock);
        if (lock) rotated = await rotateEventLogAsync(resolvedPath, Buffer.byteLength(line), config);
        await assertRotationLockOwnershipAsync(lock);
        await fs.promises.appendFile(resolvedPath, line, { encoding: 'utf8', flag: 'a' });
      } finally {
        await releaseRotationLockAsync(lock);
      }
      return { logPath: resolvedPath, rotated, rotationSkipped: rotationCandidate && !lock };
    } catch {
      // Instrumentation must never affect the hook path.
      return undefined;
    }
  })();
}

function normalizeLegacyRecallRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.event_type) return record;
  if (typeof record.domain !== 'string' || typeof record.ts !== 'string') return null;

  const chars = Number(record.chars);
  const normalizedChars = Number.isFinite(chars) && chars >= 0 ? chars : 0;
  const tokenEstimate = Number(record.token_estimate);
  const normalizedTokenEstimate = Object.prototype.hasOwnProperty.call(record, 'token_estimate')
    && Number.isFinite(tokenEstimate)
    && tokenEstimate >= 0
    ? tokenEstimate
    : Math.ceil(normalizedChars / 4);

  return createEvent({
    eventType: EVENT_TYPES.CONTEXT_INJECTION,
    source: 'legacy-recall-log',
    episodeId: record.episode_id || null,
    sessionId: record.session_id || null,
    ts: record.ts,
    payload: {
      domain: record.domain,
      itemCounts: {
        constraints: Number(record.kinds?.constraints) || 0,
        decisions: Number(record.kinds?.decisions) || 0,
        instincts: Number(record.kinds?.instincts) || 0,
      },
      chars: normalizedChars,
      tokenEstimate: normalizedTokenEstimate,
    },
  });
}

function listEventLogSegments(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const directory = path.dirname(logPath);
  const baseName = path.basename(logPath);
  const segmentPattern = new RegExp(`^${escapeRegExp(baseName)}\\.(\\d+)$`);
  const rotated = fs.readdirSync(directory)
    .map(name => {
      const match = segmentPattern.exec(name);
      return match ? { generation: Number(match[1]), path: path.join(directory, name) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.generation - left.generation);
  return [...rotated.map(segment => segment.path).reverse(), logPath];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectReadSegments(logPath, maxBytes) {
  const segments = listEventLogSegments(logPath);
  if (maxBytes === null || segments.length === 0) {
    return { segments: segments.map(segmentPath => ({ path: segmentPath, start: 0, maxBytes: null })), limited: false };
  }

  const totalBytes = segments.reduce((total, segmentPath) => total + fs.statSync(segmentPath).size, 0);
  if (totalBytes <= maxBytes) {
    return { segments: segments.map(segmentPath => ({ path: segmentPath, start: 0, maxBytes: null })), limited: false };
  }

  let remaining = maxBytes;
  const selected = [];
  for (let index = segments.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const segmentPath = segments[index];
    const size = fs.statSync(segmentPath).size;
    if (size <= remaining) {
      selected.push({ path: segmentPath, start: 0, maxBytes: size });
      remaining -= size;
    } else {
      selected.push({ path: segmentPath, start: Math.max(0, size - remaining), maxBytes: remaining });
      remaining = 0;
    }
  }
  selected.sort((left, right) => segments.indexOf(left.path) - segments.indexOf(right.path));
  return { segments: selected, limited: selected.length < segments.length || remaining === 0 };
}

function addDiagnostic(state, code, segmentPath, lineNumber = null, extra = {}) {
  state.diagnostics.push({ code, path: segmentPath, line: lineNumber, ...extra });
}

function processEventLine(line, segment, lineNumber, state, terminated) {
  if (!line) return;
  state.linesRead += 1;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    state.skipped += 1;
    if (terminated) {
      state.malformedRecords += 1;
      addDiagnostic(state, 'malformed_json', segment, lineNumber);
    } else {
      state.truncatedRecords += 1;
      addDiagnostic(state, 'truncated_record', segment, lineNumber);
    }
    return;
  }

  const event = normalizeLegacyRecallRecord(parsed);
  if (!event || !validateEvent(event).valid) {
    state.skipped += 1;
    state.invalidRecords += 1;
    addDiagnostic(state, 'invalid_event', segment, lineNumber);
    return;
  }
  state.eventsRead += 1;
  state.onEvent(event);
}

function scanSegmentSync(segment, selection, state) {
  const fileSize = fs.statSync(segment).size;
  const start = selection.start || 0;
  const readLimit = selection.maxBytes !== null && fileSize > start + selection.maxBytes;
  const fd = fs.openSync(segment, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(EVENT_LOG_READ_CHUNK_BYTES);
  let pending = '';
  let lineNumber = 0;
  let offset = start;
  const startsMidRecord = start > 0 && (() => {
    try {
      const previousByte = Buffer.alloc(1);
      const bytesRead = fs.readSync(fd, previousByte, 0, 1, start - 1);
      return bytesRead === 1 && previousByte[0] !== 0x0a;
    } catch {
      return true;
    }
  })();
  let skippedPartialLine = !startsMidRecord;
  try {
    while (offset < fileSize) {
      const remaining = selection.maxBytes === null
        ? buffer.length
        : Math.min(buffer.length, start + selection.maxBytes - offset);
      if (remaining <= 0) break;
      const bytes = fs.readSync(fd, buffer, 0, remaining, offset);
      if (bytes === 0) break;
      offset += bytes;
      state.readBytes += bytes;
      pending += decoder.write(buffer.subarray(0, bytes));
      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex).replace(/\r$/, '');
        pending = pending.slice(newlineIndex + 1);
        lineNumber += 1;
        if (startsMidRecord && !skippedPartialLine) {
          skippedPartialLine = true;
          addDiagnostic(state, 'read_limit', segment, lineNumber, { detail: 'partial_record_skipped' });
        } else {
          processEventLine(line, segment, lineNumber, state, true);
        }
        if (state.maxEvents !== null && state.eventsRead >= state.maxEvents) {
          state.truncated = true;
          addDiagnostic(state, 'read_limit', segment, lineNumber, { detail: 'max_events' });
          return;
        }
        newlineIndex = pending.indexOf('\n');
      }
    }

    pending += decoder.end();
    if (readLimit) {
      state.truncated = true;
      addDiagnostic(state, 'read_limit', segment, lineNumber, { detail: 'max_bytes' });
      return;
    }
    if (pending && !(startsMidRecord && !skippedPartialLine)) {
      lineNumber += 1;
      processEventLine(pending.replace(/\r$/, ''), segment, lineNumber, state, false);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function scanEventsSync(logPath = getDefaultEventLogPath(), options = {}) {
  const resolvedPath = path.resolve(logPath);
  const { maxBytes, maxEvents } = getEventLogReadConfig(options);
  const state = {
    eventsRead: 0,
    linesRead: 0,
    readBytes: 0,
    skipped: 0,
    malformedRecords: 0,
    invalidRecords: 0,
    truncatedRecords: 0,
    truncated: false,
    diagnostics: [],
    maxEvents,
    onEvent: typeof options.onEvent === 'function' ? options.onEvent : () => {},
  };
  if (!fs.existsSync(resolvedPath)) {
    return { ...state, segments: [], onEvent: undefined };
  }

  const selection = selectReadSegments(resolvedPath, maxBytes);
  if (selection.limited) {
    state.truncated = true;
    addDiagnostic(state, 'read_limit', resolvedPath, null, { detail: 'max_bytes' });
  }
  for (const segment of selection.segments) {
    if (state.truncated && state.maxEvents !== null && state.eventsRead >= state.maxEvents) break;
    scanSegmentSync(segment.path, segment, state);
  }
  return { ...state, segments: selection.segments.map(segment => segment.path), onEvent: undefined };
}

function readEvents(logPath = getDefaultEventLogPath(), options = {}) {
  const events = [];
  const result = scanEventsSync(logPath, {
    ...options,
    onEvent: event => events.push(event),
  });
  return { ...result, events };
}

module.exports = {
  DEFAULT_EVENT_LOG_MAX_BYTES,
  DEFAULT_EVENT_LOG_READ_MAX_BYTES,
  DEFAULT_EVENT_LOG_READ_MAX_EVENTS,
  DEFAULT_EVENT_LOG_RETENTION,
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  OUTCOMES,
  appendEventAsync,
  appendEventSync,
  assertValidEvent,
  createEvent,
  getEventLogConfig,
  getEventLogReadConfig,
  getDefaultEventLogPath,
  normalizeLegacyRecallRecord,
  readEvents,
  rotateEventLogSync,
  scanEventsSync,
  validateEvent,
};
