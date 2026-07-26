'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPortableIdentifier, isStrictUtcTimestamp } = require('./evidence-contract');

const PROTOCOL_SCHEMA_VERSION = 1;
const ALLOWED_PROVIDERS = Object.freeze(['claude_code', 'codex_cli']);
const ALLOWED_INTENT_ACTIONS = Object.freeze([
  'register_ontology_component',
  'retire_stale_ontology_reference',
  'sync_domain_metadata',
  'update_ontology_relationship',
]);
const ALLOWED_RECEIPT_OUTCOMES = Object.freeze(['succeeded', 'retryable_failure', 'permanent_failure']);
const ALLOWED_APPROVAL_DECISIONS = Object.freeze(['approved', 'rejected']);
const MAX_HOP_LIMIT = 1;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const UUID_SUFFIX = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_SHA256 = /^[a-f0-9]{64}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SUBJECT = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_DURABLE_FIELDS = new Set([
  'command', 'commands', 'diff', 'patch', 'prompt', 'rawOutput', 'raw_output',
  'source', 'sourceCode', 'source_code', 'stdout', 'stderr', 'text',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function hasForbiddenFields(value) {
  return isPlainObject(value) && Object.keys(value).some(key => FORBIDDEN_DURABLE_FIELDS.has(key));
}

function isJobId(value) {
  return new RegExp(`^ontology-maintainer-job-${UUID_SUFFIX}$`).test(value || '');
}

function isProposalId(value) {
  return new RegExp(`^ontology-maintainer-proposal-${UUID_SUFFIX}$`).test(value || '');
}

function isReceiptId(value) {
  return new RegExp(`^ontology-maintainer-receipt-${UUID_SUFFIX}$`).test(value || '');
}

function isApprovalId(value) {
  return new RegExp(`^ontology-maintainer-approval-${UUID_SUFFIX}$`).test(value || '');
}

function isCandidateId(value) {
  return /^ontology-candidate-[a-f0-9]{24}$/.test(value || '');
}

function isIdempotencyKey(value) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 160
    && /^[a-z0-9][a-z0-9._/-]*$/.test(value)
    && !value.includes('..') && !value.includes('//');
}

function isSafeProtocolIdentifier(value, { minLength = 1, maxLength = 160 } = {}) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
    && /^[a-z0-9][a-z0-9._/-]*$/.test(value)
    && !value.includes('..') && !value.includes('//');
}

function isSafeTargetPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && isPortableIdentifier(value) && /^[A-Za-z0-9._/-]+$/.test(value)
    && !value.includes('..') && !value.includes('//') && !value.split('/').includes('.git');
}

function signaturesMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getArtifactKey(artifactId) {
  return crypto.createHash('sha256').update(artifactId, 'utf8').digest('hex');
}

function resolveAttestationSecret(value) {
  const secret = value === undefined ? process.env.OMF_EVIDENCE_ATTESTATION_SECRET : value;
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

function artifactSignaturePayload({ job, proposal, artifactReference }) {
  return [
    'omf-ontology-maintainer-artifact-v1',
    job.id,
    job.provider,
    job.candidateId,
    job.reviewPackageSha256,
    job.candidateFingerprint,
    job.repoHead,
    proposal.id,
    proposal.proposalSha256,
    proposal.targetPath,
    proposal.targetBeforeHash,
    artifactReference.artifactId,
    artifactReference.artifactHash,
    artifactReference.persistedAt,
  ].join('\n');
}

function assertSignableArtifactInputs({ job, proposal, artifactReference, attestationSecret }) {
  assertValidOntologyMaintainerJob(job);
  assertValidOntologyMaintainerProposal(proposal);
  const referenceErrors = validateArtifactReference({
    ...artifactReference,
    signature: artifactReference?.signature || `hmac-sha256:${'0'.repeat(64)}`,
  });
  if (referenceErrors.length > 0) throw new Error(`Invalid ontology maintainer artifact reference: ${referenceErrors.join('; ')}`);
  const secret = resolveAttestationSecret(attestationSecret);
  if (!secret) throw new Error('Ontology maintainer artifact attestation secret is unavailable');
  return secret;
}

function createOntologyMaintainerArtifactSignature({ job, proposal, artifactReference, attestationSecret } = {}) {
  const secret = assertSignableArtifactInputs({ job, proposal, artifactReference, attestationSecret });
  return `hmac-sha256:${crypto.createHmac('sha256', secret)
    .update(artifactSignaturePayload({ job, proposal, artifactReference }), 'utf8')
    .digest('hex')}`;
}

function createEvidenceStoreArtifactReader({ evidenceStorePath } = {}) {
  const configuredPath = evidenceStorePath === undefined ? process.env.OMF_EVIDENCE_STORE : evidenceStorePath;
  if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
    throw new Error('Ontology maintainer evidence store is unavailable');
  }
  const artifactDirectory = path.resolve(configuredPath, 'artifacts');
  return artifactId => fs.readFileSync(path.join(artifactDirectory, getArtifactKey(artifactId)));
}

function verifyOntologyMaintainerArtifactReference({
  job, proposal, artifactReference, artifactReader, attestationSecret, evidenceStorePath,
} = {}) {
  try {
    const secret = assertSignableArtifactInputs({ job, proposal, artifactReference, attestationSecret });
    const readArtifact = typeof artifactReader === 'function'
      ? artifactReader
      : createEvidenceStoreArtifactReader({ evidenceStorePath });
    const artifact = readArtifact(artifactReference.artifactId);
    const artifactBuffer = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact || '');
    if (artifactBuffer.length === 0 || artifactBuffer.length > MAX_ARTIFACT_BYTES) return false;
    const actualHash = `sha256:${crypto.createHash('sha256').update(artifactBuffer).digest('hex')}`;
    const expectedSignature = `hmac-sha256:${crypto.createHmac('sha256', secret)
      .update(artifactSignaturePayload({ job, proposal, artifactReference }), 'utf8')
      .digest('hex')}`;
    return signaturesMatch(actualHash, artifactReference.artifactHash)
      && signaturesMatch(expectedSignature, artifactReference.signature);
  } catch (_error) {
    return false;
  }
}

function validateArtifactReference(reference) {
  const errors = [];
  if (!hasExactKeys(reference, ['artifactId', 'artifactHash', 'persistedAt', 'signature'])) {
    return ['artifactReference must contain only artifactId, artifactHash, persistedAt, and signature'];
  }
  if (!isSafeProtocolIdentifier(reference.artifactId)) errors.push('artifactReference.artifactId must be a safe identifier');
  if (!SHA256.test(reference.artifactHash || '')) errors.push('artifactReference.artifactHash must be a sha256 hash');
  if (!isStrictUtcTimestamp(reference.persistedAt)) errors.push('artifactReference.persistedAt must be strict UTC');
  if (!/^hmac-sha256:[a-f0-9]{64}$/.test(reference.signature || '')) {
    errors.push('artifactReference.signature must be an HMAC-SHA256 attestation');
  }
  return errors;
}

function validationResult(errors) {
  return { valid: errors.length === 0, errors };
}

function validateOntologyMaintainerJob(job) {
  const errors = [];
  const keys = [
    'schemaVersion', 'type', 'id', 'idempotencyKey', 'provider', 'candidateId',
    'reviewPackageSha256', 'candidateFingerprint', 'repoHead', 'hop', 'hopLimit', 'createdAt',
  ];
  if (!hasExactKeys(job, keys)) return validationResult(['job has unknown, missing, or raw durable fields']);
  if (hasForbiddenFields(job)) errors.push('job must not persist raw content');
  if (job.schemaVersion !== PROTOCOL_SCHEMA_VERSION || job.type !== 'ontology_maintainer_job') errors.push('job schema is invalid');
  if (!isJobId(job.id)) errors.push('job.id is invalid');
  if (!isIdempotencyKey(job.idempotencyKey)) errors.push('job.idempotencyKey is invalid');
  if (!ALLOWED_PROVIDERS.includes(job.provider)) errors.push('job.provider must be explicitly allowed');
  if (!isCandidateId(job.candidateId)) errors.push('job.candidateId is invalid');
  if (!BARE_SHA256.test(job.reviewPackageSha256 || '')) errors.push('job.reviewPackageSha256 is invalid');
  if (!BARE_SHA256.test(job.candidateFingerprint || '')) errors.push('job.candidateFingerprint is invalid');
  if (!GIT_HEAD.test(job.repoHead || '')) errors.push('job.repoHead is invalid');
  if (job.hop !== 0 || job.hopLimit !== MAX_HOP_LIMIT) errors.push('job must start at hop 0 with the fixed hop limit');
  if (!isStrictUtcTimestamp(job.createdAt)) errors.push('job.createdAt must be strict UTC');
  return validationResult(errors);
}

function proposalHashInput(proposal) {
  return {
    schemaVersion: proposal.schemaVersion,
    type: proposal.type,
    id: proposal.id,
    jobId: proposal.jobId,
    provider: proposal.provider,
    reviewPackageSha256: proposal.reviewPackageSha256,
    candidateFingerprint: proposal.candidateFingerprint,
    repoHead: proposal.repoHead,
    targetPath: proposal.targetPath,
    targetBeforeHash: proposal.targetBeforeHash,
    intent: {
      action: proposal.intent?.action,
      subject: proposal.intent?.subject,
    },
    createdAt: proposal.createdAt,
  };
}

function computeOntologyMaintainerProposalSha256(proposal) {
  return crypto.createHash('sha256').update(JSON.stringify(proposalHashInput(proposal))).digest('hex');
}

function createOntologyMaintainerProposal(input = {}) {
  const inputKeys = [
    'id', 'jobId', 'provider', 'reviewPackageSha256', 'candidateFingerprint',
    'repoHead', 'targetPath', 'targetBeforeHash', 'intent', 'createdAt',
  ];
  if (!hasExactKeys(input, inputKeys) || hasForbiddenFields(input)) {
    throw new Error('Invalid ontology maintainer proposal input');
  }
  const proposal = {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    type: 'ontology_maintainer_proposal',
    id: input.id,
    jobId: input.jobId,
    provider: input.provider,
    reviewPackageSha256: input.reviewPackageSha256,
    candidateFingerprint: input.candidateFingerprint,
    repoHead: input.repoHead,
    targetPath: input.targetPath,
    targetBeforeHash: input.targetBeforeHash,
    intent: input.intent && { action: input.intent.action, subject: input.intent.subject },
    createdAt: input.createdAt,
  };
  const proposalHash = computeOntologyMaintainerProposalSha256(proposal);
  const normalized = { ...proposal, proposalSha256: proposalHash };
  assertValidOntologyMaintainerProposal(normalized);
  return normalized;
}

function validateOntologyMaintainerProposal(proposal) {
  const errors = [];
  const keys = [
    'schemaVersion', 'type', 'id', 'jobId', 'provider', 'reviewPackageSha256',
    'candidateFingerprint', 'repoHead', 'targetPath', 'targetBeforeHash', 'intent', 'createdAt', 'proposalSha256',
  ];
  if (!hasExactKeys(proposal, keys)) return validationResult(['proposal has unknown, missing, or raw durable fields']);
  if (hasForbiddenFields(proposal) || hasForbiddenFields(proposal.intent)) errors.push('proposal must not persist raw content');
  if (proposal.schemaVersion !== PROTOCOL_SCHEMA_VERSION || proposal.type !== 'ontology_maintainer_proposal') errors.push('proposal schema is invalid');
  if (!isProposalId(proposal.id) || !isJobId(proposal.jobId)) errors.push('proposal identity is invalid');
  if (!ALLOWED_PROVIDERS.includes(proposal.provider)) errors.push('proposal.provider must be explicitly allowed');
  if (!BARE_SHA256.test(proposal.reviewPackageSha256 || '') || !BARE_SHA256.test(proposal.candidateFingerprint || '')) {
    errors.push('proposal review package or candidate fingerprint is invalid');
  }
  if (!GIT_HEAD.test(proposal.repoHead || '')) errors.push('proposal.repoHead is invalid');
  if (!isSafeTargetPath(proposal.targetPath)) errors.push('proposal.targetPath is invalid');
  if (!SHA256.test(proposal.targetBeforeHash || '')) errors.push('proposal.targetBeforeHash is invalid');
  if (!hasExactKeys(proposal.intent, ['action', 'subject'])
      || !ALLOWED_INTENT_ACTIONS.includes(proposal.intent.action)
      || !SUBJECT.test(proposal.intent.subject || '')) {
    errors.push('proposal.intent must be a bounded semantic intent');
  }
  if (!isStrictUtcTimestamp(proposal.createdAt)) errors.push('proposal.createdAt must be strict UTC');
  if (!BARE_SHA256.test(proposal.proposalSha256 || '')
      || proposal.proposalSha256 !== computeOntologyMaintainerProposalSha256(proposal)) {
    errors.push('proposal.proposalSha256 must bind the normalized proposal');
  }
  return validationResult(errors);
}

function validateOntologyMaintainerReceipt(receipt) {
  const errors = [];
  const keys = ['schemaVersion', 'type', 'id', 'jobId', 'proposalId', 'provider', 'outcome', 'reasonCode', 'artifactReference', 'createdAt'];
  if (!hasExactKeys(receipt, keys)) return validationResult(['receipt has unknown, missing, or raw durable fields']);
  if (hasForbiddenFields(receipt) || hasForbiddenFields(receipt.artifactReference)) errors.push('receipt must not persist raw content');
  if (receipt.schemaVersion !== PROTOCOL_SCHEMA_VERSION || receipt.type !== 'ontology_maintainer_receipt') errors.push('receipt schema is invalid');
  if (!isReceiptId(receipt.id) || !isJobId(receipt.jobId) || !isProposalId(receipt.proposalId)) errors.push('receipt identity is invalid');
  if (!ALLOWED_PROVIDERS.includes(receipt.provider)) errors.push('receipt.provider must be explicitly allowed');
  if (!ALLOWED_RECEIPT_OUTCOMES.includes(receipt.outcome) || !REASON_CODE.test(receipt.reasonCode || '')) errors.push('receipt outcome is invalid');
  if (receipt.outcome === 'succeeded') {
    errors.push(...validateArtifactReference(receipt.artifactReference));
  } else if (receipt.artifactReference !== null) {
    errors.push('failed receipts must not include an artifact reference');
  }
  if (!isStrictUtcTimestamp(receipt.createdAt)) errors.push('receipt.createdAt must be strict UTC');
  return validationResult(errors);
}

function validateOntologyMaintainerApproval(approval) {
  const errors = [];
  const keys = [
    'schemaVersion', 'type', 'id', 'proposalId', 'proposalSha256', 'reviewPackageSha256', 'candidateFingerprint',
    'repoHead', 'targetPath', 'targetBeforeHash', 'decision', 'approverId', 'expiresAt', 'createdAt',
  ];
  if (!hasExactKeys(approval, keys)) return validationResult(['approval has unknown, missing, or raw durable fields']);
  if (hasForbiddenFields(approval)) errors.push('approval must not persist raw content');
  if (approval.schemaVersion !== PROTOCOL_SCHEMA_VERSION || approval.type !== 'ontology_maintainer_approval') errors.push('approval schema is invalid');
  if (!isApprovalId(approval.id) || !isProposalId(approval.proposalId)) errors.push('approval identity is invalid');
  if (!BARE_SHA256.test(approval.proposalSha256 || '') || !BARE_SHA256.test(approval.reviewPackageSha256 || '')
      || !BARE_SHA256.test(approval.candidateFingerprint || '')) errors.push('approval hashes are invalid');
  if (!GIT_HEAD.test(approval.repoHead || '') || !isSafeTargetPath(approval.targetPath) || !SHA256.test(approval.targetBeforeHash || '')) {
    errors.push('approval target binding is invalid');
  }
  if (!ALLOWED_APPROVAL_DECISIONS.includes(approval.decision)) errors.push('approval.decision is invalid');
  if (!isSafeProtocolIdentifier(approval.approverId)) errors.push('approval.approverId is invalid');
  if (!isStrictUtcTimestamp(approval.createdAt) || !isStrictUtcTimestamp(approval.expiresAt)
      || Date.parse(approval.expiresAt) <= Date.parse(approval.createdAt)) errors.push('approval expiry is invalid');
  return validationResult(errors);
}

function assertValidOntologyMaintainerJob(job) {
  const result = validateOntologyMaintainerJob(job);
  if (!result.valid) throw new Error(`Invalid ontology maintainer job: ${result.errors.join('; ')}`);
  return job;
}

function assertValidOntologyMaintainerProposal(proposal) {
  const result = validateOntologyMaintainerProposal(proposal);
  if (!result.valid) throw new Error(`Invalid ontology maintainer proposal: ${result.errors.join('; ')}`);
  return proposal;
}

function assertValidOntologyMaintainerReceipt(receipt) {
  const result = validateOntologyMaintainerReceipt(receipt);
  if (!result.valid) throw new Error(`Invalid ontology maintainer receipt: ${result.errors.join('; ')}`);
  return receipt;
}

function assertValidOntologyMaintainerApproval(approval) {
  const result = validateOntologyMaintainerApproval(approval);
  if (!result.valid) throw new Error(`Invalid ontology maintainer approval: ${result.errors.join('; ')}`);
  return approval;
}

module.exports = {
  ALLOWED_APPROVAL_DECISIONS,
  ALLOWED_INTENT_ACTIONS,
  ALLOWED_PROVIDERS,
  ALLOWED_RECEIPT_OUTCOMES,
  MAX_HOP_LIMIT,
  MAX_ARTIFACT_BYTES,
  PROTOCOL_SCHEMA_VERSION,
  assertValidOntologyMaintainerApproval,
  assertValidOntologyMaintainerJob,
  assertValidOntologyMaintainerProposal,
  assertValidOntologyMaintainerReceipt,
  computeOntologyMaintainerProposalSha256,
  createEvidenceStoreArtifactReader,
  createOntologyMaintainerArtifactSignature,
  createOntologyMaintainerProposal,
  validateOntologyMaintainerApproval,
  validateOntologyMaintainerJob,
  validateOntologyMaintainerProposal,
  validateOntologyMaintainerReceipt,
  verifyOntologyMaintainerArtifactReference,
};
