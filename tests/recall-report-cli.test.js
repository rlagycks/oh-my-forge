'use strict';

/**
 * End-to-end CLI test for scripts/recall-report.js. Lives at the top level
 * of tests/ (mirroring scripts/recall-report.js's own top-level location,
 * not scripts/hooks/) per the project's tests/ layout convention.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../scripts/recall-report.js');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-report-cli-'));
  const logPath = path.join(dir, 'recall-hits.jsonl');
  fs.writeFileSync(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return { dir, logPath };
}

function run(args) {
  return spawnSync('node', [cliPath, ...args], { encoding: 'utf8' });
}

if (test('--help exits 0 and prints usage', () => {
  const result = run(['--help']);
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('Usage: node scripts/recall-report.js'));
})) passed++; else failed++;

if (test('unknown flag exits non-zero with an error message', () => {
  const result = run(['--nope']);
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stderr.includes('Unknown option'));
})) passed++; else failed++;

if (test('renders a text table for a fixture log', () => {
  const { dir, logPath } = makeTempLog([
    { ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks', kinds: { constraints: 2, decisions: 0, instincts: 0 }, chars: 120 },
  ]);
  try {
    const result = run(['--log', logPath]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('domain_hooks'));
    assert.ok(result.stdout.includes('TOTAL'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('--json emits a parseable report with matching totals', () => {
  const { dir, logPath } = makeTempLog([
    { ts: '2026-07-01T00:00:00.000Z', domain: 'domain_hooks', kinds: { constraints: 2, decisions: 0, instincts: 0 }, chars: 120 },
    { ts: '2026-07-01T00:00:00.000Z', domain: 'domain_session', kinds: { constraints: 0, decisions: 1, instincts: 0 }, chars: 40 },
  ]);
  try {
    const result = run(['--log', logPath, '--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.totalRecords, 2);
    assert.strictEqual(report.totals.hits, 2);
    assert.strictEqual(report.byDomain.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('--since filters out older hits', () => {
  const { dir, logPath } = makeTempLog([
    { ts: '2020-01-01T00:00:00.000Z', domain: 'domain_old', kinds: { constraints: 1, decisions: 0, instincts: 0 }, chars: 10 },
  ]);
  try {
    const result = run(['--log', logPath, '--since', '1h', '--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.matchedRecords, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
