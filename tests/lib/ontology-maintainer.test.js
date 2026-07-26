'use strict';

const assert = require('assert');
const {
  buildOntologyMaintainerReviewPackage,
  evaluateOntologyMaintainerPolicy,
  REVIEW_EVIDENCE_LIMIT,
  runOntologyMaintainerDryRun,
} = require('../../scripts/lib/ontology-maintainer');

function candidate(overrides = {}) {
  return {
    id: 'ontology-candidate-123',
    domainKey: 'domain_docs',
    filePath: 'docs/features/example.md',
    status: 'pending_review',
    latestContentFingerprint: 'a'.repeat(64),
    firstObservedAt: '2026-07-25T00:00:00.000Z',
    lastObservedAt: '2026-07-25T00:00:00.000Z',
    observationCount: 1,
    ...overrides,
  };
}

function policyState(overrides = {}) {
  return {
    policyId: 'ontology-maintainer-v1',
    policyVersion: '1',
    enabled: true,
    manualDryRunEnabled: true,
    providerEnabled: false,
    applyEnabled: false,
    ...overrides,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`  FAIL ${name}: ${error.message}`);
    return false;
  }
}

function store({ selectedCandidate = candidate(), evidence = [{ observationId: 'obs-1', observedAt: '2026-07-25T00:00:00.000Z' }], policy = policyState() } = {}) {
  const attempts = [];
  return {
    attempts,
    getOntologyCandidateById(id) { return id === selectedCandidate?.id ? selectedCandidate : null; },
    getOntologyMaintainerPolicyState() { return policy; },
    listOntologyCandidateEvidence(id) { return id === selectedCandidate?.id ? evidence : []; },
    recordOntologyMaintainerAttempt(attempt) { attempts.push(attempt); return attempt; },
  };
}

let passed = 0;
let failed = 0;
console.log('\nontology-maintainer.test.js');

if (test('allows only providerless manual dry runs for pending candidates with evidence', () => {
  const verdict = evaluateOntologyMaintainerPolicy({
    candidate: candidate(), evidence: [{ observationId: 'obs-1' },], policyState: policyState(),
    mode: 'manual_dry_run', provider: null, apply: false,
  });
  assert.deepStrictEqual(verdict, {
    allowed: true, policyVersion: '1', reasonCode: 'manual_review_allowed', state: 'review_package_ready',
  });
})) passed++; else failed++;

if (test('fails closed for a provider, apply request, missing evidence, or non-pending candidate', () => {
  for (const request of [
    { provider: 'codex' }, { apply: true }, { evidence: [] }, { candidate: candidate({ status: 'proposed' }) },
  ]) {
    const verdict = evaluateOntologyMaintainerPolicy({
      candidate: request.candidate || candidate(), evidence: request.evidence || [{ observationId: 'obs-1' }],
      policyState: policyState(), mode: 'manual_dry_run', provider: request.provider || null, apply: request.apply || false,
    });
    assert.strictEqual(verdict.allowed, false);
  }
})) passed++; else failed++;

if (test('records an immutable attempt and returns a metadata-only review package', () => {
  const stateStore = store();
  const result = runOntologyMaintainerDryRun({ candidateId: 'ontology-candidate-123', stateStore, now: '2026-07-25T01:00:00.000Z' });
  assert.strictEqual(result.status, 'review_package_ready');
  assert.strictEqual(stateStore.attempts.length, 1);
  assert.strictEqual(result.reviewPackage.applyAllowed, false);
  assert.strictEqual(result.reviewPackage.provider, 'none');
  assert.deepStrictEqual(result.reviewPackage.proposedChanges, []);
  assert.ok(!JSON.stringify(result.reviewPackage).includes('spoolPath'));
})) passed++; else failed++;

if (test('uses an explicit shared evidence limit when building a review package', () => {
  const stateStore = store();
  let receivedOptions = null;
  const listEvidence = stateStore.listOntologyCandidateEvidence;
  stateStore.listOntologyCandidateEvidence = (candidateId, options) => {
    receivedOptions = options;
    return listEvidence(candidateId, options);
  };
  const result = runOntologyMaintainerDryRun({ candidateId: 'ontology-candidate-123', stateStore });
  assert.strictEqual(result.status, 'review_package_ready');
  assert.deepStrictEqual(receivedOptions, { limit: REVIEW_EVIDENCE_LIMIT });
})) passed++; else failed++;

if (test('does not return an allowed package when the immutable attempt ledger fails', () => {
  const stateStore = store();
  stateStore.recordOntologyMaintainerAttempt = () => { throw new Error('ledger unavailable'); };
  const result = runOntologyMaintainerDryRun({ candidateId: 'ontology-candidate-123', stateStore });
  assert.deepStrictEqual(result, { status: 'denied', reasonCode: 'attempt_ledger_unavailable', reviewPackage: null });
})) passed++; else failed++;

if (test('review packages remain metadata-only when built directly', () => {
  const reviewPackage = buildOntologyMaintainerReviewPackage({
    attemptId: 'attempt-1', candidate: candidate(), evidence: [{ observationId: 'obs-1', observedAt: '2026-07-25T00:00:00.000Z', spoolPath: '/private/path' }],
    policy: { allowed: true, policyVersion: '1', reasonCode: 'manual_review_allowed', state: 'review_package_ready' },
    generatedAt: '2026-07-25T01:00:00.000Z',
  });
  assert.deepStrictEqual(reviewPackage.evidence, [{ observationId: 'obs-1', observedAt: '2026-07-25T00:00:00.000Z' }]);
  assert.ok(!JSON.stringify(reviewPackage).includes('/private/path'));
})) passed++; else failed++;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
