'use strict';

const assert = require('assert');
const Ajv = require('ajv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const eventSchema = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../schemas/harness-event.schema.json'),
  'utf8'
));

const {
  EVENT_TYPES,
  appendEventSync,
  assertValidEvent,
  createEvent,
  getDefaultEventLogPath,
  getEventLogConfig,
  getEventLogReadConfig,
  normalizeLegacyRecallRecord,
  readEvents,
  rotateEventLogSync,
  scanEventsSync,
  validateEvent,
} = require('../../scripts/lib/harness-events');
const {
  persistVerificationArtifact,
  createVerificationReceipt,
} = require('../../scripts/lib/evidence-contract');

process.env.OMF_EVIDENCE_ATTESTATION_SECRET = 'unit-test-attestation-secret-that-is-at-least-32-bytes';
const evidenceStore = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-evidence-store-'));
process.env.OMF_EVIDENCE_STORE = evidenceStore;
let receiptSequence = 0;

let passed = 0;
let failed = 0;

function createVerifiedReceipt(overrides = {}) {
  const sequence = receiptSequence += 1;
  const executionId = `run-harness-events-${sequence}`;
  const persisted = persistVerificationArtifact({
    verifierId: 'node-test',
    subject: 'tests/lib/harness-events.test.js',
    executionId,
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    artifactId: `snapshot-${sequence}`,
    persistedAt: '2026-07-21T00:00:00.000Z',
    artifact: 'harness-events-fixture',
  });
  const snapshotHash = persisted.snapshotHash;
  return createVerificationReceipt({
    verifierId: 'node-test',
    subject: 'tests/lib/harness-events.test.js',
    executionId,
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    snapshotHash,
    persistenceAttestation: persisted.persistenceAttestation,
    ...overrides,
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

test('creates a valid context injection event without raw context text', () => {
  const event = createEvent({
    eventType: EVENT_TYPES.CONTEXT_INJECTION,
    source: 'domain-context-inject',
    episodeId: 'episode-1',
    sessionId: 'session-1',
    payload: {
      domain: 'domain_hooks',
      itemCounts: { constraints: 2, decisions: 1, instincts: 0 },
      chars: 120,
      tokenEstimate: 42,
    },
    ts: '2026-07-17T00:00:00.000Z',
  });

  assert.strictEqual(validateEvent(event).valid, true);
  assert.strictEqual(event.event_type, 'context_injection');
  assert.strictEqual(event.episode_id, 'episode-1');
  assert.strictEqual(event.payload.token_estimate, 42);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(event.payload, 'text'), false);
});

test('creates a valid task outcome event with measurable fields', () => {
  const event = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'record-harness-event',
    episodeId: 'episode-1',
    payload: {
      outcome: 'success',
      taskId: 'golden-001',
      inputTokens: 1000,
      outputTokens: 250,
      toolCalls: 4,
      durationMs: 8000,
      testsPassed: true,
      humanIntervention: false,
    },
    ts: '2026-07-17T00:00:01.000Z',
  });

  assert.strictEqual(validateEvent(event).valid, true);
  assert.strictEqual(event.payload.outcome, 'success');
  assert.strictEqual(event.payload.input_tokens, 1000);
  assert.strictEqual(event.payload.tests_passed, true);
});

test('creates a valid verification receipt event with a durable receipt', () => {
  const receipt = createVerifiedReceipt();
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    episodeId: 'episode-1',
    payload: { verificationReceipt: receipt },
    ts: '2026-07-17T00:00:02.000Z',
  });

  assert.strictEqual(validateEvent(event).valid, true);
  assert.deepStrictEqual(event.payload.verification_receipt, receipt);
});

test('rejects verification receipt events with raw durable evidence fields through the core contract', () => {
  const receipt = createVerifiedReceipt();
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: { verificationReceipt: { ...receipt, prompt: 'npm test', rawOutput: 'secret output' } },
  });

  const result = validateEvent(event);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('prompt is not allowed in a durable verification receipt')));
  assert.ok(result.errors.some(error => error.includes('rawOutput is not allowed in a durable verification receipt')));
});

test('rejects sibling raw evidence fields from verification receipt payloads', () => {
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: {
      verificationReceipt: createVerifiedReceipt(),
      rawOutput: 'do not persist',
    },
  });

  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);

  assert.strictEqual(validateEvent(event).valid, false);
  assert.strictEqual(validateSchema(event), false);
});

test('keeps structural validation separate from authenticated persistence', () => {
  const forgedReceipt = {
    ...createVerifiedReceipt(),
    persistenceAttestation: {
      ...createVerifiedReceipt().persistenceAttestation,
      signature: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  };
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: { verificationReceipt: forgedReceipt },
  });
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);

  assert.strictEqual(validateEvent(event).valid, true);
  assert.strictEqual(validateSchema(event), true);
  assert.throws(() => assertValidEvent(event), /signature must bind/);
});

test('offline readers retain signed receipts without the attestation secret', () => {
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: { verificationReceipt: createVerifiedReceipt() },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-offline-'));
  const logPath = path.join(dir, 'events.jsonl');
  const secret = process.env.OMF_EVIDENCE_ATTESTATION_SECRET;

  try {
    fs.writeFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
    delete process.env.OMF_EVIDENCE_ATTESTATION_SECRET;
    const result = readEvents(logPath);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.skipped, 0);
  } finally {
    process.env.OMF_EVIDENCE_ATTESTATION_SECRET = secret;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('authenticated readers skip receipts with forged signatures', () => {
  const receipt = createVerifiedReceipt();
  const forgedEvent = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: {
      verificationReceipt: {
        ...receipt,
        persistenceAttestation: {
          ...receipt.persistenceAttestation,
          signature: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      },
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-authenticated-'));
  const logPath = path.join(dir, 'events.jsonl');

  try {
    fs.writeFileSync(logPath, `${JSON.stringify(forgedEvent)}\n`, 'utf8');
    assert.strictEqual(readEvents(logPath).events.length, 1);
    const authenticated = readEvents(logPath, { verifySignature: true });
    assert.strictEqual(authenticated.events.length, 0);
    assert.strictEqual(authenticated.invalidRecords, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects unknown event types and invalid outcome values', () => {
  const unknown = validateEvent({
    schema_version: 1,
    event_type: 'unknown',
    ts: '2026-07-17T00:00:00.000Z',
    source: 'test',
    payload: {},
  });
  assert.strictEqual(unknown.valid, false);

  const invalidOutcome = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'test',
    episodeId: 'episode-1',
    payload: { outcome: 'maybe' },
  });
  assert.strictEqual(validateEvent(invalidOutcome).valid, false);
});

test('treats optional linkage fields as optional and validates session_id when present', () => {
  const withoutLinkage = {
    schema_version: 1,
    event_type: EVENT_TYPES.TASK_OUTCOME,
    ts: '2026-07-17T00:00:00.000Z',
    source: 'test',
    payload: { outcome: 'unknown' },
  };
  assert.strictEqual(validateEvent(withoutLinkage).valid, true);

  const invalidSession = { ...withoutLinkage, session_id: 42 };
  assert.strictEqual(validateEvent(invalidSession).valid, false);
});

test('validates event-specific linkage, recall, and context identifier boundaries', () => {
  assert.strictEqual(validateEvent(null).valid, false);
  assert.strictEqual(validateEvent([]).valid, false);

  const invalidRecall = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'test',
    payload: { outcome: 'success', recallUsed: 'yes' },
  });
  assert.strictEqual(validateEvent(invalidRecall).valid, false);

  const duplicateContextIds = createEvent({
    eventType: EVENT_TYPES.CONTEXT_INJECTION,
    source: 'test',
    payload: { domain: 'domain', constraintIds: ['same', 'same'], memoryId: '' },
  });
  const result = validateEvent(duplicateContextIds);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('constraint_ids')));
  assert.ok(result.errors.some(error => error.includes('memory_id')));
});

test('reports every invalid base and event-specific contract field together', () => {
  const invalidBase = validateEvent({
    schema_version: 2,
    event_type: 'unknown',
    ts: 'not-a-date',
    source: ' ',
    episode_id: 1,
    session_id: 2,
    payload: [],
  });
  assert.strictEqual(invalidBase.valid, false);
  assert.ok(invalidBase.errors.some(error => error.includes('schema_version')));
  assert.ok(invalidBase.errors.some(error => error.includes('event_type')));
  assert.ok(invalidBase.errors.some(error => error.includes('timestamp')));
  assert.ok(invalidBase.errors.some(error => error.includes('source')));
  assert.ok(invalidBase.errors.some(error => error.includes('episode_id')));
  assert.ok(invalidBase.errors.some(error => error.includes('session_id')));
  assert.ok(invalidBase.errors.some(error => error.includes('payload')));

  const invalidContext = createEvent({
    eventType: EVENT_TYPES.CONTEXT_INJECTION,
    source: 'test',
    payload: { domain: ' ', constraintIds: 'not-an-array', memoryIds: ['valid', ' '] },
  });
  const contextResult = validateEvent(invalidContext);
  assert.strictEqual(contextResult.valid, false);
  assert.ok(contextResult.errors.some(error => error.includes('payload.domain')));
  assert.strictEqual(contextResult.errors.filter(error => error.includes('unique string array')).length, 2);

  const invalidOutcome = createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'test',
    payload: { outcome: 'nope', recallUsed: 1 },
  });
  const outcomeResult = validateEvent(invalidOutcome);
  assert.strictEqual(outcomeResult.valid, false);
  assert.ok(outcomeResult.errors.some(error => error.includes('outcome')));
  assert.ok(outcomeResult.errors.some(error => error.includes('recall_used')));

  const malformedReceipt = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: {},
  });
  const receiptResult = validateEvent(malformedReceipt);
  assert.strictEqual(receiptResult.valid, false);
  assert.ok(receiptResult.errors.some(error => error.includes('may contain only')));
  assert.ok(receiptResult.errors.some(error => error.includes('verification_receipt')));
});

test('uses explicit and environment read limits defensively', () => {
  const previousBytes = process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES;
  const previousEvents = process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS;
  try {
    process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES = 'invalid';
    process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS = '0';
    const fallback = getEventLogReadConfig();
    assert.ok(fallback.maxBytes > 0);
    assert.ok(fallback.maxEvents > 0);
    assert.deepStrictEqual(getEventLogReadConfig({ maxBytes: 0, maxEvents: 1 }), { maxBytes: 0, maxEvents: 1 });
    assert.deepStrictEqual(getEventLogConfig({ maxBytes: null, retention: 'invalid' }), {
      maxBytes: null,
      retention: 5,
    });
  } finally {
    if (previousBytes === undefined) delete process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES;
    else process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES = previousBytes;
    if (previousEvents === undefined) delete process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS;
    else process.env.OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS = previousEvents;
  }
});

test('honors configured event log paths and safe rotation limits', () => {
  const previousPath = process.env.OMF_HARNESS_EVENT_LOG;
  const previousMaxBytes = process.env.OMF_HARNESS_EVENT_LOG_MAX_BYTES;
  const previousRetention = process.env.OMF_HARNESS_EVENT_LOG_RETENTION;
  try {
    process.env.OMF_HARNESS_EVENT_LOG = 'relative-events.jsonl';
    assert.strictEqual(getDefaultEventLogPath(), path.resolve('relative-events.jsonl'));
    process.env.OMF_HARNESS_EVENT_LOG_MAX_BYTES = '512';
    process.env.OMF_HARNESS_EVENT_LOG_RETENTION = '3';
    assert.deepStrictEqual(getEventLogConfig(), { maxBytes: 512, retention: 3 });
    assert.deepStrictEqual(getEventLogConfig({ maxBytes: 0, retention: 0 }), { maxBytes: 0, retention: 0 });
    assert.deepStrictEqual(getEventLogReadConfig({ maxBytes: 'bad', maxEvents: 0 }), {
      maxBytes: null,
      maxEvents: null,
    });
  } finally {
    if (previousPath === undefined) delete process.env.OMF_HARNESS_EVENT_LOG;
    else process.env.OMF_HARNESS_EVENT_LOG = previousPath;
    if (previousMaxBytes === undefined) delete process.env.OMF_HARNESS_EVENT_LOG_MAX_BYTES;
    else process.env.OMF_HARNESS_EVENT_LOG_MAX_BYTES = previousMaxBytes;
    if (previousRetention === undefined) delete process.env.OMF_HARNESS_EVENT_LOG_RETENTION;
    else process.env.OMF_HARNESS_EVENT_LOG_RETENTION = previousRetention;
  }
});

test('estimates tokens for legacy records without token_estimate', () => {
  const legacy = normalizeLegacyRecallRecord({
    ts: '2026-07-17T00:00:00.000Z',
    domain: 'domain_legacy',
    chars: 101,
  });
  assert.strictEqual(legacy.payload.token_estimate, 26);

  const explicitZero = normalizeLegacyRecallRecord({
    ts: '2026-07-17T00:00:00.000Z',
    domain: 'domain_legacy',
    chars: 101,
    token_estimate: 0,
  });
  assert.strictEqual(explicitZero.payload.token_estimate, 0);
});

test('normalizes only valid legacy records and safely coerces legacy counters', () => {
  assert.strictEqual(normalizeLegacyRecallRecord(null), null);
  assert.strictEqual(normalizeLegacyRecallRecord({ domain: 'missing-ts' }), null);
  const current = { event_type: 'task_outcome' };
  assert.strictEqual(normalizeLegacyRecallRecord(current), current);

  const legacy = normalizeLegacyRecallRecord({
    ts: '2026-07-17T00:00:00.000Z',
    domain: 'legacy',
    chars: -10,
    token_estimate: -1,
    kinds: { constraints: '2', decisions: 'bad', instincts: 3 },
  });
  assert.deepStrictEqual(legacy.payload, {
    domain: 'legacy',
    item_counts: { constraints: 2, decisions: 0, instincts: 3 },
    chars: 0,
    token_estimate: 0,
  });
});

test('appends and reads structured events while preserving legacy recall records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    appendEventSync(createEvent({
      eventType: EVENT_TYPES.CONTEXT_INJECTION,
      source: 'test',
      episodeId: 'episode-1',
      payload: { domain: 'domain_hooks', itemCounts: { constraints: 1 }, chars: 10 },
    }), logPath);
    fs.appendFileSync(logPath, `${JSON.stringify({
      ts: '2026-07-17T00:00:00.000Z',
      domain: 'domain_legacy',
      kinds: { constraints: 1 },
      chars: 10,
    })}\n`, 'utf8');
    fs.appendFileSync(logPath, '{malformed\n', 'utf8');

    const result = readEvents(logPath);
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.events[0].event_type, EVENT_TYPES.CONTEXT_INJECTION);
    assert.strictEqual(result.events[1].event_type, EVENT_TYPES.CONTEXT_INJECTION);
    assert.strictEqual(result.events[1].payload.domain, 'domain_legacy');
    assert.strictEqual(result.skipped, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('creates safe default event linkage and ignores blank JSONL lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-defaults-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const event = createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      payload: { outcome: 'unknown' },
    });
    assert.strictEqual(event.source, 'unknown');
    assert.strictEqual(event.episode_id, null);
    assert.strictEqual(event.session_id, null);
    assert.ok(Number.isFinite(Date.parse(event.ts)));
    fs.writeFileSync(logPath, `\n${JSON.stringify(event)}\r\n\n`, 'utf8');
    const result = readEvents(logPath);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.linesRead, 1);
    assert.strictEqual(result.skipped, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects invalid sync events and accepts a complete final record without a newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-final-record-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const invalid = { schema_version: 1, event_type: 'unknown', ts: 'invalid', source: '', payload: {} };
    assert.throws(() => assertValidEvent(invalid), /Invalid harness event/);
    assert.throws(() => appendEventSync(invalid, logPath), /Invalid harness event/);

    const event = createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    });
    fs.writeFileSync(logPath, JSON.stringify(event), 'utf8');
    const result = readEvents(logPath);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.truncatedRecords, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reads bounded JSONL data and reports that the read was truncated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-bounded-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const lines = [1, 2, 3].map((index) => JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      source: 'test',
      episodeId: `episode-${index}`,
      payload: { outcome: 'success', taskId: `task-${index}` },
    })));
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

    const result = readEvents(logPath, { maxBytes: Buffer.byteLength(`${lines[0]}\n`) + 2 });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'read_limit'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps the first event when a bounded read starts on a line boundary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-boundary-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const lines = [1, 2, 3].map((index) => JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      source: 'test',
      episodeId: `episode-${index}`,
      payload: { outcome: 'success', taskId: `task-${index}` },
    })));
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

    const lastTwoBytes = Buffer.byteLength(`${lines[1]}\n${lines[2]}\n`);
    const result = readEvents(logPath, { maxBytes: lastTwoBytes });
    assert.deepStrictEqual(result.events.map(event => event.episode_id), ['episode-2', 'episode-3']);
    assert.strictEqual(result.diagnostics.some(diagnostic => diagnostic.detail === 'partial_record_skipped'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skips an incomplete leading record in a bounded read and streams complete events to a callback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-partial-leading-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const first = JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', episodeId: 'first', payload: { outcome: 'success' },
    }));
    const second = JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', episodeId: 'second', payload: { outcome: 'success' },
    }));
    fs.writeFileSync(logPath, `${first}\n${second}\n`, 'utf8');
    const received = [];
    const result = scanEventsSync(logPath, {
      maxBytes: Buffer.byteLength(`${second}\n`) + 3,
      onEvent: event => received.push(event.episode_id),
    });
    assert.deepStrictEqual(received, ['second']);
    assert.strictEqual(result.eventsRead, 1);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.detail === 'partial_record_skipped'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reads rotated segments in chronological order before the active log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-segments-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    for (const [suffix, episodeId] of [['.2', 'oldest'], ['.1', 'middle'], ['', 'active']]) {
      fs.writeFileSync(`${logPath}${suffix}`, `${JSON.stringify(createEvent({
        eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', episodeId, payload: { outcome: 'success' },
      }))}\n`, 'utf8');
    }
    const result = readEvents(logPath);
    assert.deepStrictEqual(result.events.map(event => event.episode_id), ['oldest', 'middle', 'active']);
    assert.strictEqual(result.segments.length, 3);
    assert.strictEqual(readEvents(path.join(dir, 'missing.jsonl')).events.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('supports unbounded multi-segment reads and stops subsequent segments at max events', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-multi-segment-limit-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    for (const [suffix, episodeId] of [['.2', 'oldest'], ['.1', 'middle'], ['', 'active']]) {
      fs.writeFileSync(`${logPath}${suffix}`, `${JSON.stringify(createEvent({
        eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', episodeId, payload: { outcome: 'success' },
      }))}\n`, 'utf8');
    }
    const full = readEvents(logPath, { maxBytes: null });
    assert.deepStrictEqual(full.events.map(event => event.episode_id), ['oldest', 'middle', 'active']);
    const limited = scanEventsSync(logPath, { maxEvents: 1 });
    assert.strictEqual(limited.eventsRead, 1);
    assert.strictEqual(limited.truncated, true);
    assert.strictEqual(limited.segments.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps complete newest segments when a byte-bounded rotated read begins mid-history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-segment-byte-window-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const records = new Map();
    for (const [suffix, episodeId] of [['.2', 'oldest'], ['.1', 'middle'], ['', 'active']]) {
      const line = `${JSON.stringify(createEvent({
        eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', episodeId, payload: { outcome: 'success' },
      }))}\n`;
      records.set(suffix, line);
      fs.writeFileSync(`${logPath}${suffix}`, line, 'utf8');
    }
    const windowBytes = Buffer.byteLength(records.get('.1')) + Buffer.byteLength(records.get('')) + 3;
    const result = readEvents(logPath, { maxBytes: windowBytes });
    assert.deepStrictEqual(result.events.map(event => event.episode_id), ['middle', 'active']);
    assert.strictEqual(result.truncated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('distinguishes malformed JSONL from a truncated final record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-diagnostics-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const event = JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      source: 'test',
      payload: { outcome: 'success' },
    }));
    fs.writeFileSync(logPath, `${event}\nnot-json\n{"schema_version":1`, 'utf8');

    const result = readEvents(logPath);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.skipped, 2);
    assert.strictEqual(result.malformedRecords, 1);
    assert.strictEqual(result.truncatedRecords, 1);
    assert.deepStrictEqual(
      result.diagnostics.map(diagnostic => diagnostic.code),
      ['malformed_json', 'truncated_record']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enforces maxEvents inside a large read chunk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-max-events-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const lines = Array.from({ length: 20 }, (_, index) => JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      source: 'test',
      episodeId: `max-events-${index}`,
      payload: { outcome: 'success' },
    })));
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

    const result = readEvents(logPath, { maxEvents: 3 });
    assert.strictEqual(result.events.length, 3);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.detail === 'max_events'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rotates the active log and enforces configured retention', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-rotation-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    const options = { maxBytes: 200, retention: 2 };
    for (let index = 1; index <= 4; index += 1) {
      appendEventSync(createEvent({
        eventType: EVENT_TYPES.TASK_OUTCOME,
        source: 'test',
        episodeId: `episode-${index}`,
        payload: { outcome: 'success', taskId: `task-${index}`, padding: 'x'.repeat(80) },
      }), logPath, options);
    }

    assert.strictEqual(fs.existsSync(`${logPath}.1`), true);
    assert.strictEqual(fs.existsSync(`${logPath}.2`), true);
    assert.strictEqual(fs.existsSync(`${logPath}.3`), false);
    const result = readEvents(logPath, { maxBytes: 4096 });
    assert.ok(result.events.length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('does not rotate missing, empty, below-limit, or explicitly disabled logs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-no-rotation-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    assert.strictEqual(rotateEventLogSync(logPath, 100, { maxBytes: 1, retention: 1 }), false);
    fs.writeFileSync(logPath, '', 'utf8');
    assert.strictEqual(rotateEventLogSync(logPath, 100, { maxBytes: 1, retention: 1 }), false);
    fs.writeFileSync(logPath, 'small', 'utf8');
    assert.strictEqual(rotateEventLogSync(logPath, 1, { maxBytes: 10, retention: 1 }), false);
    assert.strictEqual(rotateEventLogSync(logPath, 100, { maxBytes: null, retention: 1 }), false);
    assert.strictEqual(rotateEventLogSync(logPath, 100, { maxBytes: 1, retention: 0 }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sync append preserves events when rotation is locked by another writer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-sync-lock-'));
  const logPath = path.join(dir, 'events.jsonl');
  try {
    fs.writeFileSync(logPath, `${JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }))}\n`, 'utf8');
    fs.writeFileSync(`${logPath}.lock`, 'another-process', 'utf8');
    const result = appendEventSync(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }), logPath, { maxBytes: 1, retention: 1 });
    assert.strictEqual(result.rotated, false);
    assert.strictEqual(result.rotationSkipped, true);
    assert.strictEqual(readEvents(logPath).events.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sync append reclaims a stale rotation lock and completes rotation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-sync-stale-lock-'));
  const logPath = path.join(dir, 'events.jsonl');
  const lockPath = `${logPath}.lock`;
  try {
    fs.writeFileSync(logPath, `${JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }))}\n`, 'utf8');
    fs.writeFileSync(lockPath, 'stale-owner', 'utf8');
    const staleAt = new Date(Date.now() - (60 * 1000));
    fs.utimesSync(lockPath, staleAt, staleAt);
    const result = appendEventSync(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }), logPath, { maxBytes: 1, retention: 1 });
    assert.strictEqual(result.rotated, true);
    assert.strictEqual(fs.existsSync(lockPath), false);
    assert.strictEqual(readEvents(logPath).events.length, 2);
    assert.strictEqual(readEvents(`${logPath}.1`).events.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when a rotation lock is replaced during rotation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-lock-lost-'));
  const logPath = path.join(dir, 'events.jsonl');
  const originalRename = fs.renameSync;
  let replaced = false;
  try {
    fs.writeFileSync(logPath, `${JSON.stringify(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }))}\n`, 'utf8');
    fs.renameSync = function renameAndReplaceLock(sourcePath, targetPath) {
      const result = originalRename.call(fs, sourcePath, targetPath);
      if (!replaced && sourcePath === logPath) {
        replaced = true;
        fs.writeFileSync(`${logPath}.lock`, 'replacement-owner', 'utf8');
      }
      return result;
    };
    assert.throws(() => appendEventSync(createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME, source: 'test', payload: { outcome: 'success' },
    }), logPath, { maxBytes: 1, retention: 1 }), /Rotation lock ownership was lost/);
    assert.strictEqual(fs.readFileSync(`${logPath}.lock`, 'utf8'), 'replacement-owner');
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the existing recall log path by default for backward compatibility', () => {
  assert.strictEqual(
    getDefaultEventLogPath(),
    path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl')
  );
});

test('rejects invalid explicit rotation size instead of silently disabling rotation', () => {
  assert.throws(() => getEventLogConfig({ maxBytes: 'not-a-size' }), /maxBytes must be an integer/);
});

test('ships a machine-readable event schema with the runtime contract', () => {
  assert.strictEqual(eventSchema.properties.schema_version.const, 1);
  assert.deepStrictEqual(
    eventSchema.properties.event_type.enum.sort(),
    ['context_injection', 'task_outcome', 'verification_receipt']
  );
});

test('validates all generated event types against the shipped JSON schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);
  const events = [
    createEvent({
      eventType: EVENT_TYPES.CONTEXT_INJECTION,
      source: 'test',
      payload: { domain: 'domain_hooks', itemCounts: { constraints: 1 } },
    }),
    createEvent({
      eventType: EVENT_TYPES.TASK_OUTCOME,
      source: 'test',
      payload: { outcome: 'success', inputTokens: 10 },
    }),
    createEvent({
      eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
      source: 'test',
      payload: {
        verificationReceipt: createVerifiedReceipt(),
      },
    }),
  ];

  for (const event of events) {
    assert.strictEqual(validateSchema(event), true, ajv.errorsText(validateSchema.errors));
  }
});

test('the shipped JSON schema rejects raw durable evidence fields in verification receipts', () => {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: {
      verificationReceipt: {
        ...createVerifiedReceipt(),
        sourceCode: 'console.log("do not persist")',
      },
    },
  });

  assert.strictEqual(validateSchema(event), false);
});

test('keeps receipt identifier and attestation structure aligned between schema and runtime', () => {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);
  const receipt = {
    ...createVerifiedReceipt(),
    subject: 'tests/',
    persistenceAttestation: {
      artifactId: 'snapshot-main',
      persistedAt: '2026-07-21T00:00:00.000Z',
      signature: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      snapshotHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  };
  const event = createEvent({
    eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
    source: 'test',
    payload: { verificationReceipt: receipt },
  });

  assert.strictEqual(validateEvent(event).valid, false);
  assert.strictEqual(validateSchema(event), false);
});

test('keeps verification receipt outcome validation aligned between runtime and schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validateSchema = ajv.compile(eventSchema);
  const receipts = [
    createVerifiedReceipt(),
    createVerificationReceipt({
      verifierId: 'node-test',
      subject: 'tests/lib/harness-events.test.js',
      exitCode: 1,
    }),
    createVerificationReceipt({
      verifierId: 'node-test',
      subject: 'tests/lib/harness-events.test.js',
      exitCode: 0,
      timedOut: true,
    }),
    createVerificationReceipt({
      verifierId: 'node-test',
      subject: 'tests/lib/harness-events.test.js',
      exitCode: 0,
      signal: 'SIGTERM',
    }),
    createVerificationReceipt({
      verifierId: 'node-test',
      subject: 'tests/lib/harness-events.test.js',
    }),
    createVerificationReceipt({
      verifierId: 'node-test',
      subject: 'tests/lib/harness-events.test.js',
      exitCode: 0,
    }),
  ];

  for (const receipt of receipts) {
    const event = createEvent({
      eventType: EVENT_TYPES.VERIFICATION_RECEIPT,
      source: 'test',
      payload: { verificationReceipt: receipt },
    });
    assert.strictEqual(validateEvent(event).valid, true);
    assert.strictEqual(validateSchema(event), true, ajv.errorsText(validateSchema.errors));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(evidenceStore, { recursive: true, force: true });
if (failed > 0) process.exitCode = 1;
