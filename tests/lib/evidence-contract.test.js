'use strict';

const assert = require('assert');

const {
  EVIDENCE_STATES,
  assertValidVerificationReceipt,
  createPersistenceAttestation,
  createVerificationReceipt,
  validateVerificationReceipt,
} = require('../../scripts/lib/evidence-contract');

const SNAPSHOT_HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.OMF_EVIDENCE_ATTESTATION_SECRET = 'unit-test-attestation-secret-that-is-at-least-32-bytes';

function persistenceAttestation(overrides = {}) {
  return createPersistenceAttestation({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    executionId: 'run-evidence-contract',
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    snapshotHash: SNAPSHOT_HASH,
    artifactId: 'snapshot-main',
    persistedAt: '2026-07-21T00:00:01.000Z',
    ...overrides,
  });
}

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

test('marks a clean exit as verified only with an attested persisted snapshot', () => {
  const receipt = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    executionId: 'run-evidence-contract',
    exitCode: 0,
    timedOut: false,
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: persistenceAttestation(),
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
  });

  assert.strictEqual(receipt.state, EVIDENCE_STATES.VERIFIED);
  assert.strictEqual(validateVerificationReceipt(receipt, { verifySignature: true }).valid, true);
});

test('keeps a clean exit without an attested persisted snapshot unknown', () => {
  const receipt = createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    executionId: 'run-evidence-contract',
    exitCode: 0,
    timedOut: false,
    snapshotHash: SNAPSHOT_HASH,
  });

  assert.strictEqual(receipt.state, EVIDENCE_STATES.UNKNOWN);
  assert.strictEqual(receipt.reason, 'missing-persistence-attestation');
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

test('rejects raw prompts, nested output, and unknown fields from durable receipts', () => {
  const result = validateVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    state: EVIDENCE_STATES.VERIFIED,
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: persistenceAttestation(),
    prompt: 'private user request',
    rawOutput: 'private command output',
    metadata: { stdout: 'nested command output' },
  });

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('prompt')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('rawOutput')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('metadata')), result.errors.join('\n'));
});

test('rejects invalid receipt inputs instead of returning a misleading verified receipt', () => {
  for (const invalid of [
    { verifierId: '', subject: 'tests/a.js' },
    { verifierId: 'test', subject: '../secret.txt' },
    { verifierId: 'test', subject: 'tests/a.js', fileHashes: { '../secret.txt': SNAPSHOT_HASH } },
    { verifierId: 'test', subject: 'tests/a.js', fileHashes: { 'tests/a.js': 'not-a-hash' } },
  ]) {
    assert.throws(() => createVerificationReceipt({
      ...invalid,
      exitCode: 0,
      snapshotHash: SNAPSHOT_HASH,
      persistenceAttestation: persistenceAttestation(),
    }));
  }
});

test('rejects malformed inputs, traversal paths, and ambiguous receipt timestamps', () => {
  for (const malformed of [null, [], 'invalid']) {
    assert.strictEqual(validateVerificationReceipt(malformed).valid, false);
  }

  const result = validateVerificationReceipt({
    verifierId: 'test',
    subject: 'foo/../../secret',
    exitCode: 0,
    timedOut: false,
    signal: null,
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: persistenceAttestation(),
    state: EVIDENCE_STATES.VERIFIED,
    reason: 'verified-receipt',
    startedAt: '01/02/2026',
    endedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('subject')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('startedAt')), result.errors.join('\n'));
});

test('rejects unbound attestation fields so schema and runtime cannot disagree', () => {
  const result = validateVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    timedOut: false,
    signal: null,
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: {
      ...persistenceAttestation(),
      snapshotHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    state: EVIDENCE_STATES.VERIFIED,
    reason: 'verified-receipt',
  });

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('persistenceAttestation.snapshotHash')), result.errors.join('\n'));
});

test('rejects an attestation replayed for another execution identity', () => {
  assert.throws(() => createVerificationReceipt({
    verifierId: 'other-verifier',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: 0,
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: persistenceAttestation(),
  }), /must bind verifierId/);
});

test('rejects an attestation replayed with a different execution result', () => {
  assert.throws(() => createVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    executionId: 'run-replayed',
    exitCode: 1,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:02.000Z',
    endedAt: '2026-07-21T00:00:03.000Z',
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: persistenceAttestation(),
  }), /must bind verifierId/);
});

test('treats an invalid attestation signature as structurally valid but unauthentic', () => {
  const forged = {
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    executionId: 'run-evidence-contract',
    exitCode: 0,
    timedOut: false,
    signal: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    endedAt: '2026-07-21T00:00:01.000Z',
    snapshotHash: SNAPSHOT_HASH,
    persistenceAttestation: {
      ...persistenceAttestation(),
      signature: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    state: EVIDENCE_STATES.VERIFIED,
    reason: 'verified-receipt',
  };

  assert.strictEqual(validateVerificationReceipt(forged).valid, true);
  assert.strictEqual(validateVerificationReceipt(forged, { verifySignature: true }).valid, false);
});

test('rejects invalid optional receipt fields and enforces assertion failures', () => {
  const result = validateVerificationReceipt({
    verifierId: 'targeted-test',
    subject: 'tests/lib/evidence-contract.test.js',
    exitCode: '0',
    timedOut: 'false',
    signal: '',
    snapshotHash: 'not-a-hash',
    fileHashes: { 'tests/a.js': 'not-a-hash' },
    persistenceAttestation: { artifactId: '', persistedAt: 'not-a-timestamp' },
    startedAt: '2026-07-21T00:00:01.000Z',
    endedAt: '2026-07-21T00:00:00.000Z',
    state: EVIDENCE_STATES.VERIFIED,
    reason: '',
  });

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('exitCode')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('timedOut')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('signal')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('snapshotHash')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('fileHashes')), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error.includes('endedAt')), result.errors.join('\n'));
  assert.throws(() => assertValidVerificationReceipt({}), /Invalid verification receipt/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
