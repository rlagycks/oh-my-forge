'use strict';

const assert = require('assert');
const { createStateStore } = require('../../scripts/lib/state-store');
const { REVIEW_EVIDENCE_LIMIT, runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');

async function main() {
  console.log('\nontology-maintainer-state-store.test.js');
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.deepStrictEqual(store.getAppliedMigrations().map(migration => migration.version), [1, 2, 3, 4]);
    assert.deepStrictEqual(store.getOntologyMaintainerPolicyState(), {
      policyId: 'ontology-maintainer-v1', policyVersion: '1', enabled: true,
      manualDryRunEnabled: true, providerEnabled: false, applyEnabled: false,
      updatedAt: store.getOntologyMaintainerPolicyState().updatedAt,
    });
    store.recordOntologyMaintainerAttempt({
      id: 'attempt-1', candidateId: null, policyId: 'ontology-maintainer-v1', policyVersion: '1',
      requestedMode: 'manual_dry_run', providerRequested: false, applyRequested: false,
      decision: 'denied', reasonCode: 'candidate_not_found', state: 'denied', reviewPackage: null,
      createdAt: '2026-07-25T00:00:00.000Z', completedAt: '2026-07-25T00:00:00.000Z',
    });
    assert.strictEqual(store.listOntologyMaintainerAttempts().length, 1);
    const missingCandidateId = 'ontology-candidate-fedcba9876543210fedcba98';
    const missingCandidate = runOntologyMaintainerDryRun({ candidateId: missingCandidateId, stateStore: store });
    assert.deepStrictEqual(missingCandidate, {
      status: 'denied', reasonCode: 'candidate_not_found', reviewPackage: null,
    });
    const missingCandidateAttempt = store.listOntologyMaintainerAttempts()
      .find(attempt => attempt.requestedCandidateId === missingCandidateId);
    assert.deepStrictEqual({
      candidateId: missingCandidateAttempt?.candidateId,
      requestedCandidateId: missingCandidateAttempt?.requestedCandidateId,
      reasonCode: missingCandidateAttempt?.reasonCode,
    }, {
      candidateId: null,
      requestedCandidateId: missingCandidateId,
      reasonCode: 'candidate_not_found',
    });
    assert.throws(() => store.recordOntologyMaintainerAttempt({ id: 'bad', decision: 'allowed', state: 'denied' }), /Invalid ontology maintainer attempt/);
    assert.throws(() => store.recordOntologyMaintainerAttempt({
      id: 'forged-allowed-attempt', candidateId: null, policyId: 'forged-policy', policyVersion: '999',
      requestedMode: 'apply', providerRequested: true, applyRequested: true,
      decision: 'allowed', reasonCode: 'manual_review_allowed', state: 'review_package_ready', reviewPackage: null,
    }), /does not match policy evaluation/);
    assert.throws(() => store.recordOntologyMaintainerAttempt({
      id: 'secret-attempt', candidateId: null, policyId: 'ontology-maintainer-v1', policyVersion: '1',
      requestedMode: 'manual_dry_run', providerRequested: false, applyRequested: false,
      decision: 'allowed', reasonCode: 'manual_review_allowed', state: 'review_package_ready',
      reviewPackage: { secret: 'TOPSECRET', source: 'const password = "x";' },
    }), /Invalid ontology maintainer review package/);
    assert.throws(() => store.recordOntologyMaintainerAttempt({
      id: 'leaky-attempt', candidateId: null, policyId: 'ontology-maintainer-v1', policyVersion: '1',
      requestedMode: 'manual_dry_run', providerRequested: false, applyRequested: false,
      decision: 'allowed', reasonCode: 'manual_review_allowed', state: 'review_package_ready',
      reviewPackage: {
        schemaVersion: 1, type: 'ontology_maintainer_review_package', attemptId: 'ontology-maintainer-attempt-12345678-1234-1234-1234-123456789abc',
        generatedAt: '2026-07-25T00:00:00.000Z', provider: 'none', applyAllowed: false,
        policy: { policyVersion: '1', reasonCode: 'manual_review_allowed', state: 'review_package_ready' },
        candidate: { id: 'SECRET: topsecret payload', domainKey: 'domain_docs', filePath: 'docs/a.md', status: 'pending_review', latestContentFingerprint: 'a'.repeat(64), firstObservedAt: '2026-07-25T00:00:00.000Z', lastObservedAt: '2026-07-25T00:00:00.000Z', observationCount: 1 },
        evidence: [{ observationId: 'ontology-observation-1234567890abcdef12345678', observedAt: '2026-07-25T00:00:00.000Z' }],
        reviewerChecklist: [
          'Confirm the candidate still matches the current project domain and file fingerprint.',
          'Choose a configured Claude Code or Codex CLI adapter only after reviewing the evidence bundle.',
          'Do not apply or mutate source, ontology, or docs from this review package.',
        ], proposedChanges: [],
      },
    }), /Invalid ontology maintainer review package/);
    store.applyOntologyObservationDrain({
      spoolPath: '/tmp/ontology-observations.jsonl', checkpointOffset: 1,
      entries: [{
        lineEndOffset: 1,
        observation: { id: 'ontology-observation-1234567890abcdef12345678', observedAt: '2026-07-25T00:00:00.000Z' },
        candidate: {
          id: 'ontology-candidate-1234567890abcdef12345678', candidateKey: 'candidate-key', projectKey: 'project-key',
          domainKey: 'domain_docs', filePath: 'docs/example.md', kind: 'observed_file_change', status: 'pending_review',
          latestContentFingerprint: 'a'.repeat(64), firstObservedAt: '2026-07-25T00:00:00.000Z',
          lastObservedAt: '2026-07-25T00:00:00.000Z', createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
        },
      }],
    });
    const review = runOntologyMaintainerDryRun({
      candidateId: 'ontology-candidate-1234567890abcdef12345678', stateStore: store, now: '2026-07-25T00:00:00.000Z',
    });
    assert.strictEqual(review.status, 'review_package_ready');
    const recordedReview = store.listOntologyMaintainerAttempts({ candidateId: review.attempt.candidateId })[0];
    assert.strictEqual(recordedReview.requestedCandidateId, recordedReview.candidateId);
    const bulkCandidate = {
      id: 'ontology-candidate-abcdefabcdefabcdefabcdef', candidateKey: 'bulk-candidate-key', projectKey: 'project-key',
      domainKey: 'domain_docs', filePath: 'docs/bulk.md', kind: 'observed_file_change', status: 'pending_review',
      latestContentFingerprint: 'b'.repeat(64), firstObservedAt: '2026-07-25T01:00:00.000Z',
      lastObservedAt: '2026-07-25T01:01:40.000Z', createdAt: '2026-07-25T01:00:00.000Z', updatedAt: '2026-07-25T01:01:40.000Z',
    };
    store.applyOntologyObservationDrain({
      spoolPath: '/tmp/ontology-observations-bulk.jsonl', checkpointOffset: 101,
      entries: Array.from({ length: 101 }, (_, index) => ({
        lineEndOffset: index + 1,
        observation: {
          id: `ontology-observation-${(index + 1000).toString(16).padStart(24, '0')}`,
          observedAt: `2026-07-25T01:0${Math.floor(index / 60)}:${String(index % 60).padStart(2, '0')}.000Z`,
        },
        candidate: bulkCandidate,
      })),
    });
    const bulkReview = runOntologyMaintainerDryRun({
      candidateId: bulkCandidate.id, stateStore: store, now: '2026-07-25T01:02:00.000Z',
    });
    assert.strictEqual(bulkReview.status, 'review_package_ready');
    assert.strictEqual(bulkReview.reviewPackage.evidence.length, REVIEW_EVIDENCE_LIMIT);
    console.log('  PASS migrates policy and records immutable maintainer attempts');
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
