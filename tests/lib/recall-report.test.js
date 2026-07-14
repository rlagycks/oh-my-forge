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
  readRecallHits,
  parseSince,
  filterSince,
  aggregateByDomain,
  buildReport,
  formatTable,
} = require(recallReportPath);

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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
