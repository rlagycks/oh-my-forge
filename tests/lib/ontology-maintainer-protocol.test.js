'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Ajv = require('ajv');
const { createStateStore } = require('../../scripts/lib/state-store');
const { runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');
const {
  ALLOWED_PROVIDERS,
  createOntologyMaintainerArtifactSignature,
  createOntologyMaintainerProposal,
  validateOntologyMaintainerApproval,
  validateOntologyMaintainerJob,
  validateOntologyMaintainerProposal,
  validateOntologyMaintainerReceipt,
  verifyOntologyMaintainerArtifactReference,
} = require('../../scripts/lib/ontology-maintainer-protocol');
const protocolSchema = require('../../schemas/ontology-maintainer-protocol.schema.json');

const NOW = '2026-07-26T01:00:00.000Z';
const CANDIDATE_ID = 'ontology-candidate-1234567890abcdef12345678';
const REVIEW_HEAD = '0123456789abcdef0123456789abcdef01234567';
const TARGET_HASH = `sha256:${'b'.repeat(64)}`;
const ATTESTATION_SECRET = 'protocol-test-attestation-secret-at-least-32-characters';
const ARTIFACT = Buffer.from('externally persisted opaque proposal artifact');

function job(overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_job',
    id: 'ontology-maintainer-job-12345678-1234-1234-1234-123456789abc',
    idempotencyKey: 'ontology-maintainer-idempotency-1234567890abcdef',
    provider: 'claude_code',
    candidateId: CANDIDATE_ID,
    reviewPackageSha256: 'a'.repeat(64),
    candidateFingerprint: 'a'.repeat(64),
    repoHead: REVIEW_HEAD,
    hop: 0,
    hopLimit: 1,
    createdAt: NOW,
    ...overrides,
  };
}

function proposal(jobRecord, overrides = {}) {
  return createOntologyMaintainerProposal({
    id: 'ontology-maintainer-proposal-12345678-1234-1234-1234-123456789abc',
    jobId: jobRecord.id,
    provider: jobRecord.provider,
    reviewPackageSha256: jobRecord.reviewPackageSha256,
    candidateFingerprint: jobRecord.candidateFingerprint,
    repoHead: jobRecord.repoHead,
    targetPath: '.claude/ontology/domain_docs.json',
    targetBeforeHash: TARGET_HASH,
    intent: { action: 'sync_domain_metadata', subject: 'domain_docs' },
    createdAt: NOW,
    ...overrides,
  });
}

function receipt(proposalRecord, overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_receipt',
    id: 'ontology-maintainer-receipt-12345678-1234-1234-1234-123456789abc',
    jobId: proposalRecord.jobId,
    proposalId: proposalRecord.id,
    provider: proposalRecord.provider,
    outcome: 'succeeded',
    reasonCode: 'proposal_ready',
    artifactReference: {
      artifactId: 'ontology-maintainer/artifacts/proposal-123',
      artifactHash: `sha256:${'c'.repeat(64)}`,
      persistedAt: NOW,
      signature: `hmac-sha256:${'d'.repeat(64)}`,
    },
    createdAt: NOW,
    ...overrides,
  };
}

function artifactReference(jobRecord, proposalRecord, overrides = {}) {
  const reference = {
    artifactId: 'ontology-maintainer/artifacts/proposal-123',
    artifactHash: `sha256:${crypto.createHash('sha256').update(ARTIFACT).digest('hex')}`,
    persistedAt: NOW,
    ...overrides,
  };
  return {
    ...reference,
    signature: createOntologyMaintainerArtifactSignature({
      job: jobRecord, proposal: proposalRecord, artifactReference: reference, attestationSecret: ATTESTATION_SECRET,
    }),
  };
}

function artifactReader(artifactId) {
  assert.strictEqual(artifactId, 'ontology-maintainer/artifacts/proposal-123');
  return ARTIFACT;
}

function approval(proposalRecord, overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_approval',
    id: 'ontology-maintainer-approval-12345678-1234-1234-1234-123456789abc',
    proposalId: proposalRecord.id,
    proposalSha256: proposalRecord.proposalSha256,
    reviewPackageSha256: proposalRecord.reviewPackageSha256,
    candidateFingerprint: proposalRecord.candidateFingerprint,
    repoHead: proposalRecord.repoHead,
    targetPath: proposalRecord.targetPath,
    targetBeforeHash: proposalRecord.targetBeforeHash,
    decision: 'approved',
    approverId: 'maintainer/reviewer',
    expiresAt: '2026-07-27T01:00:00.000Z',
    createdAt: NOW,
    ...overrides,
  };
}

async function seedCandidate(store) {
  store.applyOntologyObservationDrain({
    spoolPath: '/tmp/ontology-protocol-test.jsonl', checkpointOffset: 1,
    entries: [{
      lineEndOffset: 1,
      observation: { id: 'ontology-observation-1234567890abcdef12345678', observedAt: NOW },
      candidate: {
        id: CANDIDATE_ID, candidateKey: 'protocol-candidate-key', projectKey: 'project-key',
        domainKey: 'domain_docs', filePath: 'docs/example.md', kind: 'observed_file_change', status: 'pending_review',
        latestContentFingerprint: 'a'.repeat(64), firstObservedAt: NOW, lastObservedAt: NOW,
        createdAt: NOW, updatedAt: NOW,
      },
    }],
  });
  const review = runOntologyMaintainerDryRun({ candidateId: CANDIDATE_ID, stateStore: store, now: NOW });
  assert.strictEqual(review.status, 'review_package_ready');
  return {
    review,
    reviewPackageSha256: store.listOntologyMaintainerAttempts({ candidateId: CANDIDATE_ID })[0].reviewPackageSha256,
  };
}

async function main() {
  console.log('\nontology-maintainer-protocol.test.js');
  const validateProtocolSchema = new Ajv({ strict: false }).compile(protocolSchema);
  assert.deepStrictEqual(ALLOWED_PROVIDERS, ['claude_code', 'codex_cli']);
  assert.strictEqual(validateOntologyMaintainerJob(job()).valid, true);
  assert.strictEqual(validateProtocolSchema(job()), true);
  assert.strictEqual(validateOntologyMaintainerJob(job({ provider: 'auto' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ hop: 1 })).valid, false);

  const validProposal = proposal(job());
  assert.strictEqual(validateOntologyMaintainerProposal(validProposal).valid, true);
  assert.strictEqual(validateProtocolSchema(validProposal), true);
  assert.throws(
    () => createOntologyMaintainerProposal({
      id: validProposal.id, jobId: validProposal.jobId, provider: validProposal.provider,
      reviewPackageSha256: validProposal.reviewPackageSha256, candidateFingerprint: validProposal.candidateFingerprint,
      repoHead: validProposal.repoHead, targetPath: validProposal.targetPath, targetBeforeHash: validProposal.targetBeforeHash,
      intent: validProposal.intent, createdAt: validProposal.createdAt, diff: '--- private patch',
    }),
    /Invalid ontology maintainer proposal input/
  );
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, diff: '--- raw diff' }).valid, false);
  assert.throws(() => proposal(job(), { targetPath: '.git' }), /Invalid ontology maintainer proposal/);
  assert.strictEqual(validateProtocolSchema({ ...validProposal, targetPath: '.git' }), false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal)).valid, true);
  assert.strictEqual(validateProtocolSchema(receipt(validProposal)), true);
  const retryableReceipt = receipt(validProposal, {
    outcome: 'retryable_failure', reasonCode: 'provider_timeout', artifactReference: null,
  });
  assert.strictEqual(validateOntologyMaintainerReceipt(retryableReceipt).valid, true);
  assert.strictEqual(validateProtocolSchema(retryableReceipt), true);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { shellCommand: 'rm -rf .' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal)).valid, true);
  assert.strictEqual(validateProtocolSchema(approval(validProposal)), true);
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: artifactReference(job(), validProposal),
      attestationSecret: ATTESTATION_SECRET, evidenceStorePath: '',
    }),
    false
  );

  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.deepStrictEqual(store.getAppliedMigrations().map(item => item.version), [1, 2, 3, 4, 5]);
    const review = await seedCandidate(store);
    const jobRecord = job({ reviewPackageSha256: review.reviewPackageSha256 });
    const first = store.claimOntologyMaintainerJob(jobRecord);
    assert.strictEqual(first.claimed, true);
    assert.strictEqual(first.job.id, jobRecord.id);
    const duplicate = store.claimOntologyMaintainerJob({ ...jobRecord, id: 'ontology-maintainer-job-87654321-4321-4321-4321-cba987654321' });
    assert.strictEqual(duplicate.claimed, false);
    assert.strictEqual(duplicate.job.id, jobRecord.id);
    assert.throws(
      () => store.claimOntologyMaintainerJob({
        ...jobRecord, id: 'ontology-maintainer-job-87654321-4321-4321-4321-cba987654321', provider: 'codex_cli',
      }),
      /idempotency conflict/
    );

    assert.throws(
      () => store.claimOntologyMaintainerJob(job({ idempotencyKey: 'new-idempotency-key', reviewPackageSha256: 'f'.repeat(64) })),
      /review package|stale/i
    );

    const proposalRecord = proposal(first.job);
    assert.strictEqual(store.recordOntologyMaintainerProposal(proposalRecord, { currentRepoHead: REVIEW_HEAD }).id, proposalRecord.id);
    assert.throws(
      () => store.recordOntologyMaintainerApproval(
        approval(proposalRecord),
        { currentRepoHead: REVIEW_HEAD, currentTargetBeforeHash: TARGET_HASH, now: NOW }
      ),
      /artifact receipt/
    );
    const signedReference = artifactReference(first.job, proposalRecord);
    const signedReceipt = receipt(proposalRecord, { artifactReference: signedReference });
    assert.throws(
      () => store.recordOntologyMaintainerReceipt(
        receipt(proposalRecord, { artifactReference: artifactReference(first.job, proposalRecord, { artifactHash: `sha256:${'f'.repeat(64)}` }) }),
        { artifactReader, attestationSecret: ATTESTATION_SECRET }
      ),
      /artifact attestation verification failed/
    );
    assert.throws(
      () => store.recordOntologyMaintainerReceipt(
        receipt(proposalRecord, { artifactReference: { ...signedReference, signature: `hmac-sha256:${'e'.repeat(64)}` } }),
        { artifactReader, attestationSecret: ATTESTATION_SECRET }
      ),
      /artifact attestation verification failed/
    );
    assert.strictEqual(
      store.recordOntologyMaintainerReceipt(signedReceipt, { artifactReader, attestationSecret: ATTESTATION_SECRET }).id,
      signedReceipt.id
    );
    assert.strictEqual(store.listOntologyMaintainerReceipts({ proposalId: proposalRecord.id }).length, 1);
    assert.throws(
      () => store.recordOntologyMaintainerApproval(
        approval(proposalRecord),
        { currentRepoHead: REVIEW_HEAD, currentTargetBeforeHash: TARGET_HASH, now: NOW }
      ),
      /artifact attestation verification failed/
    );
    const storedApproval = store.recordOntologyMaintainerApproval(
      approval(proposalRecord),
      { currentRepoHead: REVIEW_HEAD, currentTargetBeforeHash: TARGET_HASH, now: NOW, artifactReader, attestationSecret: ATTESTATION_SECRET }
    );
    assert.strictEqual(storedApproval.decision, 'approved');
    assert.strictEqual(store.listOntologyMaintainerApprovals({ proposalId: proposalRecord.id }).length, 1);

    assert.throws(
      () => store.recordOntologyMaintainerApproval(
        approval(proposalRecord, { id: 'ontology-maintainer-approval-87654321-4321-4321-4321-cba987654321' }),
        { currentRepoHead: 'fedcba9876543210fedcba9876543210fedcba98', currentTargetBeforeHash: TARGET_HASH, now: NOW }
      ),
      /stale.*head|repo.*head/i
    );

    assert.throws(
      () => proposal(first.job, { id: 'ontology-maintainer-proposal-87654321-4321-4321-4321-cba987654321', intent: { action: 'sync_domain_metadata', subject: 'const secret = 1;' } }),
      /Invalid ontology maintainer proposal/
    );
    console.log('  PASS enforces provider-neutral metadata-only protocol and durable bindings');
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
