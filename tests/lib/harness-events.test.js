'use strict';

const assert = require('assert');
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
  createEvent,
  getDefaultEventLogPath,
  readEvents,
  validateEvent,
} = require('../../scripts/lib/harness-events');

let passed = 0;
let failed = 0;

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

test('uses the existing recall log path by default for backward compatibility', () => {
  assert.strictEqual(
    getDefaultEventLogPath(),
    path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl')
  );
});

test('ships a machine-readable event schema with the runtime contract', () => {
  assert.strictEqual(eventSchema.properties.schema_version.const, 1);
  assert.deepStrictEqual(
    eventSchema.properties.event_type.enum.sort(),
    ['context_injection', 'task_outcome']
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
