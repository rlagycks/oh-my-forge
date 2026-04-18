'use strict';

const assert = require('assert');

const {
  COMPLETION_REPORT_FIELDS,
  detectFalseNormalCompletion,
  parseCompletionReport,
  parseCompletionResult,
} = require('../../scripts/lib/false-normal-detector');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\nfalse-normal-detector.test.js');

if (test('COMPLETION_REPORT_FIELDS defines the shared completion handoff format', () => {
  assert.deepStrictEqual(COMPLETION_REPORT_FIELDS, [
    'RESULT',
    'FILES CHANGED',
    'TESTS',
    'EVIDENCE',
    'FALSE NORMAL CHECKS',
    'FALSE NORMAL SIGNALS',
    'OPEN RISKS',
    'NEXT ACTION',
    'SUMMARY',
  ]);
})) passed++; else failed++;

if (test('parseCompletionReport normalizes completion fields and none values', () => {
  const fields = parseCompletionReport([
    'RESULT: DONE',
    'FILES CHANGED: scripts/lib/codex-handoff.js, scripts/lib/false-normal-detector.js',
    'TESTS: PASS',
    'EVIDENCE: parser exercised | detector exercised',
    'FALSE NORMAL CHECKS: ruled out test-only completion',
    'FALSE NORMAL SIGNALS: none',
    'OPEN RISKS: none',
    'NEXT ACTION: request review',
    'SUMMARY: detector extracted',
  ].join('\n'));

  assert.strictEqual(fields.result, 'DONE');
  assert.strictEqual(fields.resultMatch, true);
  assert.strictEqual(fields.tests, 'PASS');
  assert.strictEqual(fields.testsMatch, true);
  assert.deepStrictEqual(fields.filesChanged, [
    'scripts/lib/codex-handoff.js',
    'scripts/lib/false-normal-detector.js',
  ]);
  assert.deepStrictEqual(fields.evidence, ['parser exercised', 'detector exercised']);
  assert.deepStrictEqual(fields.falseNormalChecks, ['ruled out test-only completion']);
  assert.deepStrictEqual(fields.falseNormalSignals, []);
  assert.strictEqual(fields.falseNormalSignalsMatch, true);
  assert.deepStrictEqual(fields.openRisks, []);
  assert.strictEqual(fields.nextAction, 'request review');
  assert.strictEqual(fields.summary, 'detector extracted');
})) passed++; else failed++;

if (test('detectFalseNormalCompletion blocks DONE with PASS but no proof fields', () => {
  const signals = detectFalseNormalCompletion(parseCompletionReport([
    'RESULT: DONE',
    'FILES CHANGED: scripts/lib/codex-handoff.js',
    'TESTS: PASS',
    'SUMMARY: tests passed',
  ].join('\n')));

  assert.ok(signals.some(signal => signal.includes('EVIDENCE')), signals.join('\n'));
  assert.ok(signals.some(signal => signal.includes('FALSE NORMAL CHECKS')), signals.join('\n'));
  assert.ok(signals.some(signal => signal.includes('FALSE NORMAL SIGNALS')), signals.join('\n'));
  assert.ok(signals.some(signal => signal.includes('NEXT ACTION')), signals.join('\n'));
  assert.ok(signals.some(signal => signal.includes('TESTS: PASS alone')), signals.join('\n'));
})) passed++; else failed++;

if (test('detectFalseNormalCompletion ignores non-DONE results', () => {
  const signals = detectFalseNormalCompletion(parseCompletionReport([
    'RESULT: PARTIAL',
    'FILES CHANGED: scripts/lib/codex-handoff.js',
    'TESTS: PASS',
    'SUMMARY: partial work',
  ].join('\n')));

  assert.deepStrictEqual(signals, []);
})) passed++; else failed++;

if (test('parseCompletionResult downgrades false-normal DONE to BLOCKED', () => {
  const result = parseCompletionResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/lib/codex-handoff.js',
    'TESTS: PASS',
    'SUMMARY: tests passed',
  ].join('\n'), {
    schemaVersion: 'test.result.v1',
  });

  assert.strictEqual(result.schemaVersion, 'test.result.v1');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.state, 'BLOCKED');
  assert.strictEqual(result.result, 'BLOCKED');
  assert.ok(result.error.includes('False-normal detector'), result.error);
  assert.ok(result.falseNormalSignals.some(signal => signal.includes('EVIDENCE')), JSON.stringify(result, null, 2));
})) passed++; else failed++;

if (test('parseCompletionResult accepts DONE with evidence, checks, no signals, and next action', () => {
  const result = parseCompletionResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/lib/codex-handoff.js',
    'TESTS: PASS',
    'EVIDENCE: parser exercised',
    'FALSE NORMAL CHECKS: ruled out test-only completion',
    'FALSE NORMAL SIGNALS: none',
    'OPEN RISKS: none',
    'NEXT ACTION: request review',
    'SUMMARY: detector extracted',
  ].join('\n'), {
    schemaVersion: 'test.result.v1',
  });

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.state, 'COMPLETED');
  assert.strictEqual(result.result, 'DONE');
  assert.deepStrictEqual(result.falseNormalSignals, []);
  assert.strictEqual(result.nextAction, 'request review');
})) passed++; else failed++;

if (test('parseCompletionResult returns explicit BLOCKED when RESULT is missing', () => {
  const result = parseCompletionResult('TESTS: SKIPPED\nSUMMARY: no result', {
    schemaVersion: 'test.result.v1',
    missingResultSummary: 'No result line.',
    missingResultError: 'No result line.',
  });

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.state, 'BLOCKED');
  assert.strictEqual(result.result, 'BLOCKED');
  assert.strictEqual(result.summary, 'No result line.');
  assert.strictEqual(result.error, 'No result line.');
  assert.ok(result.falseNormalSignals.some(signal => signal.includes('RESULT')), JSON.stringify(result, null, 2));
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
