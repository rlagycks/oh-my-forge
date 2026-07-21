'use strict';

const assert = require('assert');

const {
  EVIDENCE_STATES,
  createVerificationReceipt,
  validateVerificationReceipt,
} = require('../../scripts/lib/evidence-contract');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}

test('marks a clean exit with a persisted snapshot as verified', () => {
  const receipt = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    timedOut: false,
    snapshotHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
  });

  assert.strictEqual(receipt.state, EVIDENCE_STATES.VERIFIED);
  assert.strictEqual(validateVerificationReceipt(receipt).valid, true);
});

test('keeps a clean exit without a durable artifact unknown', () => {
  const receipt = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    timedOut: false,
  });

  assert.strictEqual(receipt.state, EVIDENCE_STATES.UNKNOWN);
  assert.strictEqual(receipt.reason, 'missing-artifact');
});

test('never marks timed out or signaled commands as verified', () => {
  const timedOut = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    timedOut: true,
    snapshotHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  const signaled = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    signal: 'SIGTERM',
    snapshotHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  });

  assert.strictEqual(timedOut.state, EVIDENCE_STATES.UNKNOWN);
  assert.strictEqual(timedOut.reason, 'timed-out');
  assert.strictEqual(signaled.state, EVIDENCE_STATES.UNKNOWN);
  assert.strictEqual(signaled.reason, 'signaled');
});

test('records non-zero exits as failed evidence', () => {
  const receipt = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 1,
    snapshotHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  });

  assert.strictEqual(receipt.state, EVIDENCE_STATES.FAILED);
  assert.strictEqual(receipt.reason, 'nonzero-exit');
});

test('rejects raw prompts and command output from durable receipts', () => {
  const result = validateVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    state: EVIDENCE_STATES.VERIFIED,
    exitCode: 0,
    timedOut: false,
    snapshotHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    prompt: 'private user request',
    rawOutput: 'private command output',
  });

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('prompt')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('rawOutput')), result.errors.join('\n'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
