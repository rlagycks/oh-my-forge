'use strict';

const crypto = require('crypto');
const path = require('path');
const {
  assertValidOntologyMaintainerJob,
  createOntologyMaintainerProposal,
} = require('./ontology-maintainer-protocol');
const { validateOntologyMaintainerReviewPackage } = require('./ontology-maintainer');
const {
  getOntologyMaintainerProvider,
  resolveOntologyMaintainerProviderBinary,
} = require('./ontology-maintainer-providers');
const { runBoundedOntologyMaintainerProcess } = require('./ontology-maintainer-process');

const SEMANTIC_OUTPUT_KEYS = Object.freeze(['targetPath', 'targetBeforeHash', 'intent']);

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function hashReviewPackage(reviewPackage) {
  return crypto.createHash('sha256').update(JSON.stringify(reviewPackage)).digest('hex');
}

function createProposalId() {
  return `ontology-maintainer-proposal-${crypto.randomUUID()}`;
}

function createReceiptId() {
  return `ontology-maintainer-receipt-${crypto.randomUUID()}`;
}

function buildOntologyMaintainerProviderInvocation({ provider, input, binaryPath } = {}) {
  if (typeof input !== 'string') throw new Error('Ontology maintainer provider input must be a string');
  if (typeof binaryPath !== 'string' || !path.isAbsolute(binaryPath)) {
    throw new Error('Ontology maintainer provider requires a trusted absolute binary path');
  }
  const configured = getOntologyMaintainerProvider(provider);
  return { command: binaryPath, args: [...configured.args], input };
}

function buildProviderInput({ job, reviewPackage }) {
  return JSON.stringify({
    protocol: 'omf-ontology-maintainer-runtime-v1',
    job: {
      id: job.id,
      provider: job.provider,
      candidateId: job.candidateId,
      reviewPackageSha256: job.reviewPackageSha256,
      candidateFingerprint: job.candidateFingerprint,
      repoHead: job.repoHead,
      hop: job.hop,
      hopLimit: job.hopLimit,
    },
    reviewPackage,
    outputContract: {
      targetPath: 'safe repository-relative target path',
      targetBeforeHash: 'sha256:<64 lowercase hex>',
      intent: { action: 'allowed semantic action', subject: 'bounded identifier' },
    },
  });
}

function parseSemanticProviderOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;
  let output;
  try {
    output = JSON.parse(stdout);
  } catch (_error) {
    return null;
  }
  if (!hasExactKeys(output, SEMANTIC_OUTPUT_KEYS) || !hasExactKeys(output.intent, ['action', 'subject'])) return null;
  return {
    targetPath: output.targetPath,
    targetBeforeHash: output.targetBeforeHash,
    intent: { action: output.intent.action, subject: output.intent.subject },
  };
}

function validateRuntimeInputs({ job, reviewPackage, stateStore, currentRepoHead }) {
  try {
    assertValidOntologyMaintainerJob(job);
  } catch (_error) {
    return 'job_invalid';
  }
  if (!validateOntologyMaintainerReviewPackage(reviewPackage)
      || reviewPackage.candidate.id !== job.candidateId
      || reviewPackage.candidate.latestContentFingerprint !== job.candidateFingerprint
      || hashReviewPackage(reviewPackage) !== job.reviewPackageSha256
      || typeof currentRepoHead !== 'string' || currentRepoHead !== job.repoHead) {
    return 'job_binding_invalid';
  }
  if (!stateStore || typeof stateStore.claimOntologyMaintainerJob !== 'function'
      || typeof stateStore.recordOntologyMaintainerProposal !== 'function'
      || typeof stateStore.recordOntologyMaintainerReceipt !== 'function') {
    return 'state_store_unavailable';
  }
  return null;
}

function markRetryableFailure(stateStore, job, reasonCode, now) {
  if (typeof stateStore.recordOntologyMaintainerJobRetryableFailure !== 'function') {
    return { status: 'denied', reasonCode: 'retry_transition_unavailable' };
  }
  try {
    stateStore.recordOntologyMaintainerJobRetryableFailure({ jobId: job.id, reasonCode, now });
    return { status: 'retryable_failure', reasonCode };
  } catch (_error) {
    return { status: 'denied', reasonCode: 'retry_transition_unavailable' };
  }
}

async function executeOntologyMaintainerJob({
  job, reviewPackage, stateStore, currentRepoHead, providerCapabilities, spawnProcess,
  persistArtifact, environment, timeoutMs, now, providerFileSystem, getProcessUid,
} = {}) {
  const inputError = validateRuntimeInputs({ job, reviewPackage, stateStore, currentRepoHead });
  if (inputError) return { status: 'denied', reasonCode: inputError };
  const binaryPath = resolveOntologyMaintainerProviderBinary(job.provider, providerCapabilities, {
    fileSystem: providerFileSystem,
    getUid: getProcessUid,
  });
  if (!binaryPath) {
    return { status: 'denied', reasonCode: 'provider_binary_unavailable' };
  }
  if (typeof spawnProcess !== 'function') return { status: 'denied', reasonCode: 'process_runner_unavailable' };

  let claim;
  try {
    claim = stateStore.claimOntologyMaintainerJob(job);
  } catch (_error) {
    return { status: 'denied', reasonCode: 'job_claim_rejected' };
  }
  if (!claim.claimed) return { status: 'duplicate', job: claim.job };

  const invocation = buildOntologyMaintainerProviderInvocation({
    provider: claim.job.provider,
    input: buildProviderInput({ job: claim.job, reviewPackage }),
    binaryPath,
  });
  let result;
  try {
    result = await runBoundedOntologyMaintainerProcess({
      ...invocation, spawnProcess, environment, timeoutMs,
    });
  } catch (_error) {
    return markRetryableFailure(stateStore, claim.job, 'provider_process_unavailable', now);
  }
  if (result.timedOut) return markRetryableFailure(stateStore, claim.job, 'provider_timeout', now);
  if (result.outputLimitExceeded) return { status: 'rejected', reasonCode: 'provider_output_too_large' };
  if (result.exitCode !== 0 || result.signal !== null) {
    return markRetryableFailure(stateStore, claim.job, 'provider_process_failed', now);
  }

  const semantic = parseSemanticProviderOutput(result.stdout);
  if (!semantic) return { status: 'rejected', reasonCode: 'provider_output_invalid' };
  let proposal;
  try {
    proposal = createOntologyMaintainerProposal({
      id: createProposalId(), jobId: claim.job.id, provider: claim.job.provider,
      reviewPackageSha256: claim.job.reviewPackageSha256, candidateFingerprint: claim.job.candidateFingerprint,
      repoHead: claim.job.repoHead, targetPath: semantic.targetPath, targetBeforeHash: semantic.targetBeforeHash,
      intent: semantic.intent, createdAt: now || new Date().toISOString(),
    });
    proposal = stateStore.recordOntologyMaintainerProposal(proposal, { currentRepoHead });
  } catch (_error) {
    return { status: 'rejected', reasonCode: 'semantic_proposal_rejected' };
  }
  if (typeof persistArtifact !== 'function') return { status: 'proposal_recorded', proposal };

  let persisted;
  try {
    persisted = persistArtifact({ job: claim.job, proposal });
    if (!persisted || typeof persisted !== 'object') throw new Error('artifact persistence is unavailable');
    const receipt = stateStore.recordOntologyMaintainerReceipt({
      schemaVersion: 1,
      type: 'ontology_maintainer_receipt',
      id: createReceiptId(),
      jobId: proposal.jobId,
      proposalId: proposal.id,
      provider: proposal.provider,
      outcome: 'succeeded',
      reasonCode: 'proposal_ready',
      artifactReference: persisted.artifactReference,
      createdAt: now || new Date().toISOString(),
    }, {
      artifactReader: persisted.artifactReader,
      attestationSecret: persisted.attestationSecret,
      evidenceStorePath: persisted.evidenceStorePath,
    });
    return { status: 'succeeded', proposal, receipt };
  } catch (_error) {
    return markRetryableFailure(stateStore, claim.job,
      persisted === undefined ? 'artifact_persistence_failed' : 'artifact_receipt_rejected', now);
  }
}

module.exports = {
  SEMANTIC_OUTPUT_KEYS,
  buildOntologyMaintainerProviderInvocation,
  executeOntologyMaintainerJob,
  markRetryableFailure,
  parseSemanticProviderOutput,
  runBoundedOntologyMaintainerProcess,
};
