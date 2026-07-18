'use strict';

/**
 * Tests for scripts/lib/recall-report.js — the offline analysis CLI backend
 * for ~/.claude/logs/recall-hits.jsonl (domain-context-inject.js's
 * fire-and-forget recall-hit instrumentation). Before this, the log had a
 * producer but no consumer.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const recallReportPath = path.resolve(__dirname, '../../scripts/lib/recall-report.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

function makeTempLog(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-report-'));
  const logPath = path.join(dir, 'recall-hits.jsonl');
  fs.writeFileSync(logPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return { dir, logPath };
}

function hit({ ts, domain, constraints = 0, decisions = 0, instincts = 0, chars = 0 }) {
  return JSON.stringify({ ts, domain, kinds: { constraints, decisions, instincts }, chars });
}

const {
  getDefaultRecallLogPath,
  readHarnessEvents,
  readRecallHits,
  parseSince,
  filterSince,
  aggregateByDomain,
  aggregateRecurrence,
  aggregateInjectionOutcomes,
  aggregateOutcomes,
  aggregateLinkedInjections,
  buildReport,
  formatTable,
} = require(recallReportPath);

if (test('readHarnessEvents normalizes legacy injections and reads task outcomes', () => {
  const { dir, logPath } = makeTempLog([
    JSON.stringify({
      schema_version: 1,
      event_type: 'context_injection',
      ts: '2026-07-17T00:00:00.000Z',
      source: 'test',
      episode_id: 'episode-1',
      payload: { domain: 'domain_hooks', item_counts: { constraints: 2 }, chars: 100 },
    }),
    JSON.stringify({
      ts: '2026-07-17T00:00:01.000Z',
      domain: 'domain_legacy',
      kinds: { decisions: 1 },
      chars: 20,
    }),
    JSON.stringify({
      schema_version: 1,
      event_type: 'task_outcome',
      ts: '2026-07-17T00:00:02.000Z',
      source: 'test',
      episode_id: 'episode-1',
      payload: { outcome: 'success', input_tokens: 1000, output_tokens: 200 },
    }),
  ]);
  try {
    const result = readHarnessEvents(logPath);
    assert.strictEqual(result.events.length, 3);
    assert.strictEqual(result.events[1].payload.domain, 'domain_legacy');
    assert.strictEqual(result.events[2].event_type, 'task_outcome');
    assert.strictEqual(result.skipped, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('buildReport links injections to outcomes by episode and reports token totals', () => {
  const { dir, logPath } = makeTempLog([
    JSON.stringify({
      schema_version: 1,
      event_type: 'context_injection',
      ts: '2026-07-17T00:00:00.000Z',
      source: 'test',
      episode_id: 'episode-success',
      payload: { domain: 'domain_hooks', item_counts: { constraints: 1 }, chars: 50, token_estimate: 20 },
    }),
    JSON.stringify({
      schema_version: 1,
      event_type: 'task_outcome',
      ts: '2026-07-17T00:00:01.000Z',
      source: 'test',
      episode_id: 'episode-success',
      payload: { outcome: 'success', input_tokens: 1000, output_tokens: 200, tool_calls: 3 },
    }),
    JSON.stringify({
      schema_version: 1,
      event_type: 'task_outcome',
      ts: '2026-07-17T00:00:02.000Z',
      source: 'test',
      episode_id: 'episode-failure',
      payload: { outcome: 'failure', input_tokens: 500, output_tokens: 100, tool_calls: 2 },
    }),
  ]);
  try {
    const report = buildReport({ logPath, now: Date.parse('2026-07-17T00:01:00.000Z') });
    assert.strictEqual(report.outcomes.total, 2);
    assert.strictEqual(report.outcomes.successCount, 1);
    assert.strictEqual(report.outcomes.failureCount, 1);
    assert.strictEqual(report.outcomes.successRate, 50);
    assert.strictEqual(report.outcomes.inputTokens, 1500);
    assert.strictEqual(report.linkedInjections.total, 1);
    assert.strictEqual(report.linkedInjections.withOutcome, 1);
    assert.strictEqual(report.linkedInjections.successCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('links duplicate episode outcomes by latest timestamp and reports duplicates', () => {
  const events = [
    {
      schema_version: 1,
      event_type: 'context_injection',
      ts: '2026-07-17T00:00:00.000Z',
      source: 'test',
      episode_id: 'episode-retry',
      payload: { domain: 'domain_hooks', item_counts: {} },
    },
    {
      schema_version: 1,
      event_type: 'task_outcome',
      ts: '2026-07-17T00:00:02.000Z',
      source: 'test',
      episode_id: 'episode-retry',
      payload: { outcome: 'failure', input_tokens: 10, output_tokens: 20, tool_calls: 1 },
    },
    {
      schema_version: 1,
      event_type: 'task_outcome',
      ts: '2026-07-17T00:00:01.000Z',
      source: 'test',
      episode_id: 'episode-retry',
      payload: { outcome: 'success', input_tokens: 30, output_tokens: 40, tool_calls: 2 },
    },
  ];
  const linked = aggregateLinkedInjections(events);
  assert.strictEqual(linked.duplicateOutcomeEpisodes, 1);
  assert.strictEqual(linked.withOutcome, 1);
  assert.strictEqual(linked.successCount, 0);
  assert.strictEqual(linked.failureCount, 1);
  const outcomes = aggregateOutcomes(events);
  assert.strictEqual(outcomes.total, 2);
  assert.strictEqual(outcomes.rawTotal, 2);
  assert.strictEqual(outcomes.finalTotal, 1);
  assert.strictEqual(outcomes.inputTokens, 40);
  assert.strictEqual(outcomes.outputTokens, 60);
  assert.strictEqual(outcomes.toolCalls, 3);
})) passed++; else failed++;

if (test('getDefaultRecallLogPath resolves under ~/.claude/logs/recall-hits.jsonl', () => {
  const expected = path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl');
  assert.strictEqual(getDefaultRecallLogPath(), expected);
})) passed++; else failed++;

if (test('readRecallHits returns empty records for a missing log file', () => {
  const missingPath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.jsonl`);
  const { records, skipped } = readRecallHits(missingPath);
  assert.deepStrictEqual(records, []);
  assert.strictEqual(skipped, 0);
})) passed++; else failed++;

if (test('readRecallHits parses valid JSONL lines', () => {
  const { dir, logPath } = makeTempLog([
    hit({ ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks', constraints: 2, chars: 100 }),
    hit({ ts: '2026-07-02T00:00:00.000Z', domain: 'domain_session', decisions: 1, chars: 50 }),
  ]);
  try {
    const { records, skipped } = readRecallHits(logPath);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(skipped, 0);
    assert.strictEqual(records[0].domain, 'domain_hooks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('readRecallHits skips malformed lines and counts them', () => {
  const { dir, logPath } = makeTempLog([
    hit({ ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks' }),
    '{not valid json',
    '',
    JSON.stringify({ noTs: true, noDomain: true }),
  ]);
  try {
    const { records, skipped } = readRecallHits(logPath);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(skipped, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('parseSince parses supported window suffixes', () => {
  assert.strictEqual(parseSince('45s'), 45 * 1000);
  assert.strictEqual(parseSince('30m'), 30 * 60 * 1000);
  assert.strictEqual(parseSince('24h'), 24 * 60 * 60 * 1000);
  assert.strictEqual(parseSince('7d'), 7 * 24 * 60 * 60 * 1000);
})) passed++; else failed++;

if (test('parseSince returns null for empty/invalid input', () => {
  assert.strictEqual(parseSince(undefined), null);
  assert.strictEqual(parseSince(''), null);
  assert.strictEqual(parseSince('nonsense'), null);
  assert.strictEqual(parseSince('7'), null);
})) passed++; else failed++;

if (test('filterSince keeps only records within the window', () => {
  const now = Date.parse('2026-07-10T00:00:00.000Z');
  const records = [
    { ts: '2026-07-09T12:00:00.000Z' }, // 12h ago — within 24h
    { ts: '2026-07-01T00:00:00.000Z' }, // 9 days ago — outside 24h
  ];
  const within24h = filterSince(records, parseSince('24h'), now);
  assert.strictEqual(within24h.length, 1);
  assert.strictEqual(within24h[0].ts, '2026-07-09T12:00:00.000Z');
})) passed++; else failed++;

if (test('filterSince returns all records when sinceMs is null', () => {
  const records = [{ ts: '2026-01-01T00:00:00.000Z' }, { ts: '2026-07-01T00:00:00.000Z' }];
  assert.strictEqual(filterSince(records, null).length, 2);
})) passed++; else failed++;

if (test('filterSince treats sinceMs of 0 as a zero-width window, not "no filter"', () => {
  // Regression: a zero-magnitude window like "0d" must not be conflated with
  // "no --since given" just because 0 is falsy.
  const now = Date.parse('2026-07-10T00:00:00.000Z');
  const records = [
    { ts: '2026-07-09T23:59:59.999Z' }, // 1ms before now — outside a zero-width window
    { ts: '2026-07-10T00:00:00.000Z' }, // exactly now — inside a zero-width window
  ];
  const result = filterSince(records, 0, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].ts, '2026-07-10T00:00:00.000Z');
})) passed++; else failed++;

if (test('aggregateByDomain sums kinds/chars per domain and sorts by hits desc', () => {
  const records = [
    JSON.parse(hit({ ts: '2026-07-01T00:00:00.000Z', domain: 'domain_a', constraints: 1, chars: 10 })),
    JSON.parse(hit({ ts: '2026-07-01T00:01:00.000Z', domain: 'domain_a', constraints: 2, chars: 20 })),
    JSON.parse(hit({ ts: '2026-07-01T00:02:00.000Z', domain: 'domain_b', decisions: 3, instincts: 1, chars: 5 })),
  ];
  const byDomain = aggregateByDomain(records);
  assert.strictEqual(byDomain.length, 2);
  assert.strictEqual(byDomain[0].domain, 'domain_a');
  assert.strictEqual(byDomain[0].hits, 2);
  assert.strictEqual(byDomain[0].constraints, 3);
  assert.strictEqual(byDomain[0].chars, 30);
  assert.strictEqual(byDomain[1].domain, 'domain_b');
  assert.strictEqual(byDomain[1].hits, 1);
  assert.strictEqual(byDomain[1].decisions, 3);
  assert.strictEqual(byDomain[1].instincts, 1);
})) passed++; else failed++;

if (test('aggregateByDomain returns an empty array for no records', () => {
  assert.deepStrictEqual(aggregateByDomain([]), []);
})) passed++; else failed++;

if (test('buildReport produces totals, per-domain breakdown, and skipped-line count', () => {
  const { dir, logPath } = makeTempLog([
    hit({ ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks', constraints: 2, chars: 100 }),
    hit({ ts: '2026-07-05T00:00:00.000Z', domain: 'domain_hooks', constraints: 1, chars: 50 }),
    hit({ ts: '2026-07-05T00:00:00.000Z', domain: 'domain_session', decisions: 1, chars: 30 }),
    'garbage-line',
  ]);
  try {
    const report = buildReport({ logPath, now: Date.parse('2026-07-10T00:00:00.000Z') });
    assert.strictEqual(report.totalRecords, 3);
    assert.strictEqual(report.matchedRecords, 3);
    assert.strictEqual(report.skippedLines, 1);
    assert.strictEqual(report.totals.hits, 3);
    assert.strictEqual(report.totals.constraints, 3);
    assert.strictEqual(report.totals.chars, 180);
    assert.strictEqual(report.byDomain[0].domain, 'domain_hooks');
    assert.strictEqual(report.byDomain[0].hits, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('buildReport applies the since filter end-to-end', () => {
  const { dir, logPath } = makeTempLog([
    hit({ ts: '2026-06-01T00:00:00.000Z', domain: 'domain_old', chars: 10 }),
    hit({ ts: '2026-07-09T00:00:00.000Z', domain: 'domain_recent', chars: 20 }),
  ]);
  try {
    const report = buildReport({ logPath, since: '7d', now: Date.parse('2026-07-10T00:00:00.000Z') });
    assert.strictEqual(report.totalRecords, 2);
    assert.strictEqual(report.matchedRecords, 1);
    assert.strictEqual(report.byDomain.length, 1);
    assert.strictEqual(report.byDomain[0].domain, 'domain_recent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('formatTable renders domain rows and a totals line', () => {
  const { dir, logPath } = makeTempLog([
    hit({ ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks', constraints: 2, chars: 100 }),
  ]);
  try {
    const report = buildReport({ logPath });
    const table = formatTable(report);
    assert.ok(table.includes('domain_hooks'));
    assert.ok(table.includes('TOTAL'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('formatTable handles an empty report without throwing', () => {
  const missingPath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}-2.jsonl`);
  const report = buildReport({ logPath: missingPath });
  const table = formatTable(report);
  assert.ok(table.includes('no matching recall hits'));
})) passed++; else failed++;

if (test('aggregateRecurrence reports repeated domains, constraint ids, and memory ids', () => {
  const events = [
    {
      event_type: 'context_injection',
      ts: '2026-07-17T00:00:00.000Z',
      payload: { domain: 'domain_hooks', constraint_ids: ['constraint-a', 'constraint-b'], memory_ids: ['memory-a'] },
    },
    {
      event_type: 'context_injection',
      ts: '2026-07-17T01:00:00.000Z',
      payload: { domain: 'domain_hooks', constraint_ids: ['constraint-a'], memory_ids: ['memory-a', 'memory-b'] },
    },
    {
      event_type: 'context_injection',
      ts: '2026-07-17T02:00:00.000Z',
      payload: { domain: 'domain_session', constraint_ids: ['constraint-b'], memory_ids: ['memory-b'] },
    },
  ];

  const report = aggregateRecurrence(events);
  assert.strictEqual(report.byDomain[0].key, 'domain_hooks');
  assert.strictEqual(report.byDomain[0].occurrences, 2);
  assert.strictEqual(report.byDomain[0].recurrenceRate, 50);
  assert.strictEqual(report.byConstraint.find(item => item.key === 'constraint-a').occurrences, 2);
  assert.strictEqual(report.byConstraint.find(item => item.key === 'constraint-b').occurrences, 2);
  assert.strictEqual(report.byMemoryId.find(item => item.key === 'memory-a').occurrences, 2);
  assert.strictEqual(report.byMemoryId.find(item => item.key === 'memory-b').occurrences, 2);
  assert.strictEqual(report.byDomain.find(item => item.key === 'domain_session').recurrenceRate, null);
  assert.strictEqual(report.byDomain.find(item => item.key === 'domain_session').insufficientSample, true);
})) passed++; else failed++;

if (test('aggregateInjectionOutcomes classifies final episode outcomes and preserves duplicate semantics', () => {
  const events = [
    { event_type: 'context_injection', ts: '2026-07-17T00:00:00.000Z', episode_id: 'success', payload: { domain: 'domain_a' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:01.000Z', episode_id: 'success', payload: { outcome: 'failure' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:02.000Z', episode_id: 'success', payload: { outcome: 'success', recall_used: true } },
    { event_type: 'context_injection', ts: '2026-07-17T00:00:03.000Z', episode_id: 'failed', payload: { domain: 'domain_a' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:04.000Z', episode_id: 'failed', payload: { outcome: 'failure', recall_used: true } },
    { event_type: 'context_injection', ts: '2026-07-17T00:00:05.000Z', episode_id: 'unused', payload: { domain: 'domain_a' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:06.000Z', episode_id: 'unused', payload: { outcome: 'success', recall_used: false } },
    { event_type: 'context_injection', ts: '2026-07-17T00:00:07.000Z', episode_id: 'no-final', payload: { domain: 'domain_a' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:08.000Z', episode_id: 'no-injection', payload: { outcome: 'success' } },
  ];

  const report = aggregateInjectionOutcomes(events);
  assert.strictEqual(report.totalEpisodes, 5);
  assert.strictEqual(report.categories.noInjection, 1);
  assert.strictEqual(report.categories.injectedButUnused, 2);
  assert.strictEqual(report.categories.injectedAndSuccessful, 1);
  assert.strictEqual(report.categories.injectedAndFailed, 1);
  assert.strictEqual(report.duplicateOutcomeEpisodes, 1);
  assert.strictEqual(report.rates.injectedAndSuccessful, 20);
})) passed++; else failed++;

if (test('does not let episode-less outcomes inflate usefulness episodes', () => {
  const report = aggregateInjectionOutcomes([
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:00.000Z', payload: { outcome: 'success' } },
    { event_type: 'context_injection', ts: '2026-07-17T00:00:01.000Z', episode_id: '__outcome_0', payload: { domain: 'domain_a' } },
    { event_type: 'task_outcome', ts: '2026-07-17T00:00:02.000Z', episode_id: '__outcome_0', payload: { outcome: 'success' } },
  ]);
  assert.strictEqual(report.totalEpisodes, 1);
  assert.strictEqual(report.categories.injectedAndSuccessful, 1);
  assert.strictEqual(report.unattributedOutcomes, 1);
})) passed++; else failed++;

if (test('buildReport exposes recurrence/usefulness metrics and human-readable labels', () => {
  const { dir, logPath } = makeTempLog([
    JSON.stringify({ schema_version: 1, event_type: 'context_injection', ts: '2026-07-17T00:00:00.000Z', source: 'test', episode_id: 'e1', payload: { domain: 'domain_hooks', constraint_ids: ['c1'], memory_ids: ['m1'] } }),
    JSON.stringify({ schema_version: 1, event_type: 'task_outcome', ts: '2026-07-17T00:00:01.000Z', source: 'test', episode_id: 'e1', payload: { outcome: 'success', recall_used: true } }),
    JSON.stringify({ schema_version: 1, event_type: 'task_outcome', ts: '2026-07-17T00:00:02.000Z', source: 'test', episode_id: 'e2', payload: { outcome: 'success' } }),
  ]);
  try {
    const report = buildReport({ logPath, now: Date.parse('2026-07-17T01:00:00.000Z') });
    assert.ok(report.recurrence.byDomain);
    assert.ok(report.recallUsefulness.categories);
    assert.strictEqual(report.recallUsefulness.insufficientSample, true);
    const table = formatTable(report);
    assert.ok(table.includes('Recurrence'));
    assert.ok(table.includes('injected-and-successful'));
    assert.ok(table.includes('insufficient sample'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
