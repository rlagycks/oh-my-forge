'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');
const { createStateStore } = require('../../scripts/lib/state-store');
const { runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');
const {
  ALLOWED_PROVIDERS,
  MAX_ARTIFACT_BYTES,
  assertValidOntologyMaintainerApproval,
  assertValidOntologyMaintainerJob,
  assertValidOntologyMaintainerProposal,
  assertValidOntologyMaintainerReceipt,
  createEvidenceStoreArtifactReader,
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
  assert.strictEqual(validateOntologyMaintainerJob(job({ idempotencyKey: 'too-short' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ idempotencyKey: 'ontology-maintainer-key..escape' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ idempotencyKey: 'ontology-maintainer-key//escape' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ idempotencyKey: 'ONTOLOGY-MAINTAINER-KEY' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ idempotencyKey: 'a'.repeat(161) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ id: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ candidateId: 'ontology-candidate-not-a-hash' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ candidateId: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ reviewPackageSha256: 'A'.repeat(64) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ reviewPackageSha256: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ candidateFingerprint: 'A'.repeat(64) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ candidateFingerprint: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ repoHead: 'not-a-git-head' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ repoHead: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ schemaVersion: 2 })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ type: 'other' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(job({ createdAt: '2026-07-26' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob({ ...job(), prompt: 'private source text' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerJob(null).valid, false);
  assert.throws(() => assertValidOntologyMaintainerJob(job({ id: 'not-a-job' })), /job.id is invalid/);

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
  assert.strictEqual(validateOntologyMaintainerProposal({
    ...validProposal,
    intent: { action: 'sync_domain_metadata', subject: 'domain_docs', rawOutput: 'private output' },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, schemaVersion: 2 }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, type: 'other' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, id: 'not-a-proposal' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, id: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, jobId: 'not-a-job' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, jobId: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, provider: 'auto' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, reviewPackageSha256: 'A'.repeat(64) }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, reviewPackageSha256: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, candidateFingerprint: 'A'.repeat(64) }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, candidateFingerprint: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, repoHead: 'not-a-head' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, repoHead: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, targetBeforeHash: `sha256:${'A'.repeat(64)}` }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, targetBeforeHash: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({
    ...validProposal, intent: { action: 'unknown_action', subject: 'domain_docs' },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({
    ...validProposal, intent: { action: 'sync_domain_metadata', subject: 'INVALID' },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({
    ...validProposal, intent: { action: 'sync_domain_metadata', subject: 'domain..docs' },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({
    ...validProposal, intent: { action: 'sync_domain_metadata', subject: undefined },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, createdAt: 'not-a-timestamp' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, proposalSha256: '0'.repeat(64) }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal({ ...validProposal, proposalSha256: undefined }).valid, false);
  assert.strictEqual(validateOntologyMaintainerProposal(null).valid, false);
  assert.throws(
    () => createOntologyMaintainerProposal({
      id: validProposal.id, jobId: validProposal.jobId, provider: validProposal.provider,
      reviewPackageSha256: validProposal.reviewPackageSha256, candidateFingerprint: validProposal.candidateFingerprint,
      repoHead: validProposal.repoHead, targetPath: validProposal.targetPath, targetBeforeHash: validProposal.targetBeforeHash,
      intent: null, createdAt: validProposal.createdAt,
    }),
    /Invalid ontology maintainer proposal/
  );
  assert.throws(() => assertValidOntologyMaintainerProposal({ ...validProposal, id: 'not-a-proposal' }), /proposal identity is invalid/);
  assert.throws(() => proposal(job(), { targetPath: '.git' }), /Invalid ontology maintainer proposal/);
  assert.strictEqual(validateProtocolSchema({ ...validProposal, targetPath: '.git' }), false);
  assert.throws(() => proposal(job(), { targetPath: 'docs/.git/config' }), /Invalid ontology maintainer proposal/);
  assert.strictEqual(validateProtocolSchema({ ...validProposal, targetPath: 'docs/.git/config' }), false);
  for (const targetPath of ['docs/.GIT/config', 'docs/.Git/config']) {
    assert.throws(() => proposal(job(), { targetPath }), /Invalid ontology maintainer proposal/);
    assert.strictEqual(validateProtocolSchema({ ...validProposal, targetPath }), false);
  }
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal)).valid, true);
  assert.strictEqual(validateProtocolSchema(receipt(validProposal)), true);
  const retryableReceipt = receipt(validProposal, {
    outcome: 'retryable_failure', reasonCode: 'provider_timeout', artifactReference: null,
  });
  assert.strictEqual(validateOntologyMaintainerReceipt(retryableReceipt).valid, true);
  assert.strictEqual(validateProtocolSchema(retryableReceipt), true);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { shellCommand: 'rm -rf .' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    outcome: 'retryable_failure', reasonCode: 'provider_timeout', artifactReference: receipt(validProposal).artifactReference,
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { artifactReference: null })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { schemaVersion: 2 })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { type: 'other' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { id: 'not-a-receipt' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { jobId: 'not-a-job' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { proposalId: 'not-a-proposal' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { provider: 'auto' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { outcome: 'other' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { reasonCode: 'INVALID' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { createdAt: 'not-a-timestamp' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, artifactId: '../private-artifact' },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, artifactHash: `sha256:${'A'.repeat(64)}` },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, persistedAt: 'not-a-timestamp' },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, artifactHash: undefined },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, signature: 'not-an-attestation' },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, signature: undefined },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, { reasonCode: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(receipt(validProposal, {
    artifactReference: { ...receipt(validProposal).artifactReference, prompt: 'private artifact body' },
  })).valid, false);
  assert.strictEqual(validateOntologyMaintainerReceipt(null).valid, false);
  assert.throws(() => assertValidOntologyMaintainerReceipt(receipt(validProposal, { id: 'not-a-receipt' })), /receipt identity is invalid/);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal)).valid, true);
  assert.strictEqual(validateProtocolSchema(approval(validProposal)), true);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { decision: 'rejected' })).valid, true);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { expiresAt: NOW })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval({ ...approval(validProposal), source: 'private source' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { targetPath: '.claude/.git/config' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { schemaVersion: 2 })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { type: 'other' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { id: 'not-an-approval' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { id: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { proposalId: 'not-a-proposal' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { proposalId: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { proposalSha256: 'A'.repeat(64) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { proposalSha256: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { reviewPackageSha256: 'A'.repeat(64) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { reviewPackageSha256: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { candidateFingerprint: 'A'.repeat(64) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { candidateFingerprint: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { repoHead: 'not-a-head' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { repoHead: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { targetBeforeHash: `sha256:${'A'.repeat(64)}` })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { targetBeforeHash: undefined })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { decision: 'other' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { approverId: 'INVALID' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { approverId: 'maintainer//reviewer' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { approverId: 'maintainer..reviewer' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { approverId: 'a'.repeat(161) })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { createdAt: 'not-a-timestamp' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(approval(validProposal, { expiresAt: 'not-a-timestamp' })).valid, false);
  assert.strictEqual(validateOntologyMaintainerApproval(null).valid, false);
  assert.throws(() => assertValidOntologyMaintainerApproval(approval(validProposal, { id: 'not-an-approval' })), /approval identity is invalid/);

  const directReference = artifactReference(job(), validProposal);
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader, attestationSecret: ATTESTATION_SECRET,
    }),
    true
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => Buffer.alloc(0), attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => '', attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => ARTIFACT.toString('utf8'), attestationSecret: ATTESTATION_SECRET,
    }),
    true
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal,
      artifactReference: { ...directReference, artifactHash: `sha256:${'f'.repeat(64)}` },
      artifactReader, attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal,
      artifactReference: { ...directReference, signature: `hmac-sha256:${'f'.repeat(64)}` },
      artifactReader, attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => { throw new Error('reader unavailable'); }, attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => Buffer.alloc(MAX_ARTIFACT_BYTES + 1), attestationSecret: ATTESTATION_SECRET,
    }),
    false
  );
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: directReference,
      artifactReader: () => ARTIFACT, attestationSecret: 'too-short',
    }),
    false
  );
  assert.throws(
    () => createEvidenceStoreArtifactReader({ evidenceStorePath: '' }),
    /evidence store is unavailable/
  );
  const evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-protocol-evidence-'));
  try {
    const persistedArtifactDirectory = path.join(evidenceDirectory, 'artifacts');
    fs.mkdirSync(persistedArtifactDirectory);
    const persistedArtifactPath = path.join(
      persistedArtifactDirectory,
      crypto.createHash('sha256').update(directReference.artifactId, 'utf8').digest('hex')
    );
    fs.writeFileSync(persistedArtifactPath, ARTIFACT);
    assert.deepStrictEqual(
      createEvidenceStoreArtifactReader({ evidenceStorePath: evidenceDirectory })(directReference.artifactId),
      ARTIFACT
    );
  } finally {
    fs.rmSync(evidenceDirectory, { recursive: true, force: true });
  }
  assert.strictEqual(
    verifyOntologyMaintainerArtifactReference({
      job: job(), proposal: validProposal, artifactReference: artifactReference(job(), validProposal),
      attestationSecret: ATTESTATION_SECRET, evidenceStorePath: '',
    }),
    false
  );

  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.deepStrictEqual(store.getAppliedMigrations().map(item => item.version), [1, 2, 3, 4, 5, 6, 7, 8]);
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
    const retryable = store.recordOntologyMaintainerJobRetryableFailure({
      jobId: jobRecord.id, reasonCode: 'provider_timeout', updatedAt: NOW,
    });
    assert.strictEqual(retryable.state, 'retryable_failure');
    assert.strictEqual(retryable.lastReasonCode, 'provider_timeout');
    assert.throws(
      () => store.recordOntologyMaintainerJobRetryableFailure({
        jobId: jobRecord.id, reasonCode: 'provider_timeout', updatedAt: NOW,
      }),
      /not claimable/
    );
    const reclaimed = store.claimOntologyMaintainerJob(jobRecord);
    assert.strictEqual(reclaimed.claimed, true);
    assert.strictEqual(reclaimed.reclaimed, true);
    assert.strictEqual(store.getOntologyMaintainerJobById(jobRecord.id).attemptCount, 2);

    assert.throws(
      () => store.claimOntologyMaintainerJob(job({ idempotencyKey: 'new-idempotency-key', reviewPackageSha256: 'f'.repeat(64) })),
      /review package|stale/i
    );

    const proposalRecord = proposal(first.job);
    assert.strictEqual(store.recordOntologyMaintainerProposal(proposalRecord, { currentRepoHead: REVIEW_HEAD }).id, proposalRecord.id);
    assert.strictEqual(store.getOntologyMaintainerJobById(jobRecord.id).state, 'proposal_recorded');
    assert.throws(
      () => store.recordOntologyMaintainerJobRetryableFailure({
        jobId: jobRecord.id, reasonCode: 'provider_timeout', updatedAt: NOW,
      }),
      /before a proposal/
    );
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
