'use strict';

const assert = require('assert');
const { createStateStore } = require('../../scripts/lib/state-store');
const { REVIEW_EVIDENCE_LIMIT, runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');

async function main() {
  console.log('\nontology-maintainer-state-store.test.js');
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.deepStrictEqual(store.getAppliedMigrations().map(migration => migration.version), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepStrictEqual(store.getOntologyMaintainerPolicyState(), {
      policyId: 'ontology-maintainer-v1', policyVersion: '1', enabled: true,
      manualDryRunEnabled: true, providerEnabled: false, applyEnabled: false,
      updatedAt: store.getOntologyMaintainerPolicyState().updatedAt,
    });
    const emptyStatus = store.getStatus();
    assert.deepStrictEqual(emptyStatus.activeSessions, { activeCount: 0, sessions: [] });
    assert.deepStrictEqual(emptyStatus.skillRuns.summary, {
      totalCount: 0, knownCount: 0, successCount: 0, failureCount: 0, unknownCount: 0,
      successRate: null, failureRate: null,
    });
    assert.deepStrictEqual(emptyStatus.installHealth, {
      status: 'missing', totalCount: 0, healthyCount: 0, warningCount: 0, installations: [],
    });
    assert.deepStrictEqual(emptyStatus.governance, { pendingCount: 0, events: [] });
    const activeSession = store.upsertSession({
      id: 'session-active', adapterId: 'claude-code', harness: 'local', state: 'active', repoRoot: '/repo',
      startedAt: '2026-07-25T00:00:00.000Z', endedAt: null, snapshot: { workers: [{ id: 'worker-1' }] },
    });
    assert.strictEqual(activeSession.workerCount, 1);
    store.upsertSession({
      id: 'session-completed', adapterId: 'codex-cli', harness: 'local', state: 'completed', repoRoot: null,
      startedAt: null, endedAt: '2026-07-25T00:01:00.000Z', snapshot: {},
    });
    assert.strictEqual(store.listRecentSessions({ limit: 1 }).totalCount, 2);
    assert.strictEqual(store.getSessionById('missing-session'), null);
    assert.strictEqual(store.getSessionDetail('missing-session'), null);
    store.insertSkillRun({
      id: 'skill-success', skillId: 'ontology-sync', skillVersion: '1', sessionId: 'session-active',
      taskDescription: 'sync', outcome: 'success', createdAt: '2026-07-25T00:02:00.000Z',
    });
    store.insertSkillRun({
      id: 'skill-failure', skillId: 'ontology-sync', skillVersion: '1', sessionId: 'session-active',
      taskDescription: 'sync', outcome: 'failed', failureReason: 'timeout', tokensUsed: 3, durationMs: 4,
      userFeedback: 'retry', createdAt: '2026-07-25T00:03:00.000Z',
    });
    store.insertSkillRun({
      id: 'skill-unknown', skillId: 'ontology-sync', skillVersion: '1', sessionId: 'session-active',
      taskDescription: 'sync', outcome: 'skipped', createdAt: '2026-07-25T00:04:00.000Z',
    });
    store.insertDecision({
      id: 'decision-1', sessionId: 'session-active', title: 'Keep proposal-only', rationale: 'safe', status: 'accepted',
    });
    const detail = store.getSessionDetail('session-active');
    assert.deepStrictEqual(detail.workers, [{ id: 'worker-1' }]);
    assert.strictEqual(detail.skillRuns.length, 3);
    assert.strictEqual(detail.decisions[0].alternatives.length, 0);
    store.upsertInstallState({
      targetId: 'healthy', targetRoot: '/repo', profile: 'full', modules: ['agents'], operations: ['install'],
      installedAt: '2026-07-25T00:05:00.000Z', sourceVersion: '2.1.0',
    });
    store.upsertInstallState({
      targetId: 'warning', targetRoot: '/other', installedAt: '2026-07-25T00:06:00.000Z', sourceVersion: null,
    });
    store.insertGovernanceEvent({
      id: 'governance-pending', eventType: 'review_required', payload: { candidate: 'domain_docs' },
      createdAt: '2026-07-25T00:07:00.000Z',
    });
    store.insertGovernanceEvent({
      id: 'governance-resolved', eventType: 'review_required', payload: null, resolvedAt: '2026-07-25T00:08:00.000Z',
      resolution: 'approved', createdAt: '2026-07-25T00:08:00.000Z',
    });
    const populatedStatus = store.getStatus({ activeLimit: 1, recentSkillRunLimit: 2, pendingLimit: 1 });
    assert.strictEqual(populatedStatus.activeSessions.activeCount, 1);
    assert.deepStrictEqual(populatedStatus.skillRuns.summary, {
      totalCount: 2, knownCount: 1, successCount: 0, failureCount: 1, unknownCount: 1,
      successRate: 0, failureRate: 100,
    });
    assert.strictEqual(populatedStatus.installHealth.status, 'warning');
    assert.strictEqual(populatedStatus.governance.pendingCount, 1);
    assert.strictEqual(populatedStatus.governance.events[0].id, 'governance-pending');
    assert.strictEqual(store.upsertSkillVersion({
      skillId: 'ontology-sync', version: '1', contentHash: 'a'.repeat(64), promotedAt: '2026-07-25T00:09:00.000Z',
    }).rolledBackAt, null);
    assert.throws(() => store.getStatus({ activeLimit: 0 }), /Invalid limit/);
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
    assert.strictEqual(store.getOntologyObservationCursor('/tmp/ontology-observations.jsonl'), null);
    assert.strictEqual(store.getOntologyCandidateById('ontology-candidate-000000000000000000000000'), null);
    assert.deepStrictEqual(store.listOntologyCandidateEvidence('ontology-candidate-000000000000000000000000'), []);
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
    assert.deepStrictEqual(store.getOntologyObservationCursor('/tmp/ontology-observations.jsonl'), {
      spoolPath: '/tmp/ontology-observations.jsonl', byteOffset: 1,
      updatedAt: store.getOntologyObservationCursor('/tmp/ontology-observations.jsonl').updatedAt,
    });
    const initialCandidate = store.getOntologyCandidateById('ontology-candidate-1234567890abcdef12345678');
    assert.strictEqual(initialCandidate.observationCount, 1);
    assert.strictEqual(store.listOntologyCandidates({ projectKey: 'project-key', domainKey: 'domain_docs' }).totalCount, 1);
    assert.deepStrictEqual(store.listOntologyCandidates({ projectKey: 'wrong-project' }), { totalCount: 0, candidates: [] });
    assert.throws(() => store.listOntologyCandidates({ limit: 0 }), /Invalid limit/);
    assert.deepStrictEqual(store.applyOntologyObservationDrain({
      spoolPath: '/tmp/ontology-observations.jsonl', checkpointOffset: 2,
      entries: [{
        lineEndOffset: 2,
        observation: { id: 'ontology-observation-1234567890abcdef12345679', observedAt: '2026-07-25T00:01:00.000Z' },
        candidate: {
          ...initialCandidate,
          latestContentFingerprint: 'c'.repeat(64), lastObservedAt: '2026-07-25T00:01:00.000Z',
          updatedAt: '2026-07-25T00:01:00.000Z',
        },
      }],
    }), { created: 0, updated: 1, duplicates: 0, rejected: 0 });
    const updatedCandidate = store.getOntologyCandidateById(initialCandidate.id);
    assert.strictEqual(updatedCandidate.latestContentFingerprint, 'c'.repeat(64));
    assert.strictEqual(updatedCandidate.observationCount, 2);
    assert.deepStrictEqual(store.listOntologyCandidateEvidence(updatedCandidate.id, { limit: 1 }), [{
      observationId: 'ontology-observation-1234567890abcdef12345679', candidateId: updatedCandidate.id,
      spoolPath: '/tmp/ontology-observations.jsonl', lineEndOffset: 2, observedAt: '2026-07-25T00:01:00.000Z',
    }]);
    assert.deepStrictEqual(store.applyOntologyObservationDrain({
      spoolPath: '/tmp/ontology-observations.jsonl', checkpointOffset: 3,
      entries: [{
        lineEndOffset: 3,
        observation: { id: 'ontology-observation-1234567890abcdef12345679', observedAt: '2026-07-25T00:02:00.000Z' },
        candidate: updatedCandidate,
      }],
    }), { created: 0, updated: 0, duplicates: 1, rejected: 0 });
    assert.strictEqual(store.getOntologyCandidateById(updatedCandidate.id).observationCount, 2);
    assert.strictEqual(store.getOntologyObservationCursor('/tmp/ontology-observations.jsonl').byteOffset, 3);
    assert.throws(
      () => store.applyOntologyObservationDrain({ spoolPath: '', entries: [], checkpointOffset: 0 }),
      /spoolPath must be a non-empty string/
    );
    assert.throws(
      () => store.applyOntologyObservationDrain({ spoolPath: '/tmp/valid', entries: {}, checkpointOffset: 0 }),
      /entries must be an array/
    );
    assert.throws(
      () => store.applyOntologyObservationDrain({ spoolPath: '/tmp/valid', entries: [], checkpointOffset: -1 }),
      /checkpointOffset must be a non-negative integer/
    );
    const review = runOntologyMaintainerDryRun({
      candidateId: 'ontology-candidate-1234567890abcdef12345678', stateStore: store, now: '2026-07-25T00:00:00.000Z',
    });
    assert.strictEqual(review.status, 'review_package_ready');
    const recordedReview = store.listOntologyMaintainerAttempts({ candidateId: review.attempt.candidateId })[0];
    assert.strictEqual(recordedReview.requestedCandidateId, recordedReview.candidateId);
    assert.strictEqual(store.listOntologyMaintainerAttempts({ limit: 1 }).length, 1);
    assert.deepStrictEqual(store.listOntologyMaintainerAttempts({ candidateId: 'ontology-candidate-000000000000000000000000' }), []);
    assert.throws(() => store.listOntologyMaintainerAttempts({ limit: 'not-a-number' }), /Invalid limit/);
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
