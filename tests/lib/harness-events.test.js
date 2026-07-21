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
  normalizeLegacyRecallRecord,
  readEvents,
  validateEvent,
} = require('../../scripts/lib/harness-events');
const {
  persistVerificationArtifact,
  createVerificationReceipt,
} = require('../../scripts/lib/evidence-contract');

process.env.OMF_EVIDENCE_ATTESTATION_SECRET = 'unit-test-attestation-secret-that-is-at-least-32-bytes';
const evidenceStore = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-evidence-store-'));
process.env.OMF_EVIDENCE_STORE = evidenceStore;

let passed = 0;
let failed = 0;

function createVerifiedReceipt(overrides = {}) {
  const persisted = persistVerificationArtifact({
    verifierId: 'node-test',
    subject: 'tests/lib/harness-events.test.js',
    executionId: 'run-harness-events',
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    artifactId: 'snapshot-main',
    persistedAt: '2026-07-21T00:00:00.000Z',
    artifact: 'harness-events-fixture',
  });
  const snapshotHash = persisted.snapshotHash;
  return createVerificationReceipt({
    verifierId: 'node-test',
    subject: 'tests/lib/harness-events.test.js',
    executionId: 'run-harness-events',
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
    subject: 'tests/../secret.js',
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
