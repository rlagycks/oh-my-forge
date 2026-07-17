'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENT_SCHEMA_VERSION = 1;
const EVENT_TYPES = Object.freeze({
  CONTEXT_INJECTION: 'context_injection',
  TASK_OUTCOME: 'task_outcome',
});
const OUTCOMES = new Set(['success', 'failure', 'unknown']);

function getDefaultEventLogPath() {
  return process.env.OMF_HARNESS_EVENT_LOG
    ? path.resolve(process.env.OMF_HARNESS_EVENT_LOG)
    : path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl');
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

function validateEvent(event) {
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
  if (event.episode_id !== null && typeof event.episode_id !== 'string') {
    errors.push('episode_id must be a string or null');
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    errors.push('payload must be an object');
  }

  if (event.event_type === EVENT_TYPES.CONTEXT_INJECTION) {
    if (typeof event.payload?.domain !== 'string' || event.payload.domain.trim() === '') {
      errors.push('context_injection payload.domain must be a non-empty string');
    }
  }

  if (event.event_type === EVENT_TYPES.TASK_OUTCOME) {
    if (!OUTCOMES.has(event.payload?.outcome)) {
      errors.push('task_outcome payload.outcome must be success, failure, or unknown');
    }
  }

  return { valid: errors.length === 0, errors };
}

function assertValidEvent(event) {
  const result = validateEvent(event);
  if (!result.valid) {
    throw new Error(`Invalid harness event: ${result.errors.join('; ')}`);
  }
  return event;
}

function appendEventSync(event, logPath = getDefaultEventLogPath()) {
  assertValidEvent(event);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function appendEventAsync(event, logPath = getDefaultEventLogPath()) {
  try {
    assertValidEvent(event);
    fs.mkdir(path.dirname(logPath), { recursive: true }, error => {
      if (error) return;
      fs.appendFile(logPath, `${JSON.stringify(event)}\n`, () => {});
    });
  } catch {
    // Instrumentation must never affect the hook path.
  }
}

function normalizeLegacyRecallRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.event_type) return record;
  if (typeof record.domain !== 'string' || typeof record.ts !== 'string') return null;

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
      chars: Number(record.chars) || 0,
      tokenEstimate: Number(record.token_estimate) || 0,
    },
  });
}

function readEvents(logPath = getDefaultEventLogPath()) {
  if (!fs.existsSync(logPath)) return { events: [], skipped: 0 };

  const events = [];
  let skipped = 0;
  for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    const event = normalizeLegacyRecallRecord(parsed);
    if (!event || !validateEvent(event).valid) {
      skipped += 1;
      continue;
    }
    events.push(event);
  }

  return { events, skipped };
}

module.exports = {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  OUTCOMES,
  appendEventAsync,
  appendEventSync,
  assertValidEvent,
  createEvent,
  getDefaultEventLogPath,
  normalizeLegacyRecallRecord,
  readEvents,
  validateEvent,
};
