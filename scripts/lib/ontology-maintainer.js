'use strict';

const crypto = require('crypto');

const POLICY_ID = 'ontology-maintainer-v1';
const REVIEW_PACKAGE_SCHEMA_VERSION = 1;
const MODE_MANUAL_DRY_RUN = 'manual_dry_run';
const REVIEW_EVIDENCE_LIMIT = 100;
const REVIEWER_CHECKLIST = Object.freeze([
  'Confirm the candidate still matches the current project domain and file fingerprint.',
  'Choose a configured Claude Code or Codex CLI adapter only after reviewing the evidence bundle.',
  'Do not apply or mutate source, ontology, or docs from this review package.',
]);

function createAttemptId() {
  return `ontology-maintainer-attempt-${crypto.randomUUID()}`;
}

function deny(policyState, reasonCode) {
  return {
    allowed: false,
    policyVersion: policyState?.policyVersion || null,
    reasonCode,
    state: 'denied',
  };
}

function evaluateOntologyMaintainerPolicy({ candidate, evidence, policyState, mode, provider, apply } = {}) {
  if (!policyState || policyState.policyId !== POLICY_ID) return deny(policyState, 'policy_unavailable');
  if (!policyState.enabled) return deny(policyState, 'policy_disabled');
  if (!policyState.manualDryRunEnabled) return deny(policyState, 'manual_dry_run_disabled');
  if (mode !== MODE_MANUAL_DRY_RUN) return deny(policyState, 'mode_not_allowed');
  if (provider !== null && provider !== undefined) return deny(policyState, 'provider_not_allowed');
  if (apply !== false) return deny(policyState, 'apply_not_allowed');
  if (!candidate) return deny(policyState, 'candidate_not_found');
  if (candidate.status !== 'pending_review') return deny(policyState, 'candidate_not_pending_review');
  if (!Array.isArray(evidence) || evidence.length === 0) return deny(policyState, 'candidate_evidence_missing');
  return {
    allowed: true,
    policyVersion: policyState.policyVersion,
    reasonCode: 'manual_review_allowed',
    state: 'review_package_ready',
  };
}

function buildOntologyMaintainerReviewPackage({ attemptId, candidate, evidence, policy, generatedAt } = {}) {
  if (!policy?.allowed) {
    throw new Error('Cannot build an allowed review package from a denied policy');
  }
  return {
    schemaVersion: REVIEW_PACKAGE_SCHEMA_VERSION,
    type: 'ontology_maintainer_review_package',
    attemptId,
    generatedAt: generatedAt || new Date().toISOString(),
    provider: 'none',
    applyAllowed: false,
    policy: {
      policyVersion: policy.policyVersion,
      reasonCode: policy.reasonCode,
      state: policy.state,
    },
    candidate: {
      id: candidate.id,
      domainKey: candidate.domainKey,
      filePath: candidate.filePath,
      status: candidate.status,
      latestContentFingerprint: candidate.latestContentFingerprint,
      firstObservedAt: candidate.firstObservedAt,
      lastObservedAt: candidate.lastObservedAt,
      observationCount: candidate.observationCount,
    },
    evidence: evidence.map(item => ({
      observationId: item.observationId,
      observedAt: item.observedAt,
    })),
    reviewerChecklist: [...REVIEWER_CHECKLIST],
    proposedChanges: [],
  };
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !value.includes('=') && !value.includes(':') && !value.includes('\n')
    && !value.startsWith('/') && value.split(/[\\/]/).every(segment => segment !== '' && segment !== '..');
}

function validateOntologyMaintainerReviewPackage(reviewPackage) {
  if (!hasExactKeys(reviewPackage, [
    'schemaVersion', 'type', 'attemptId', 'generatedAt', 'provider', 'applyAllowed',
    'policy', 'candidate', 'evidence', 'reviewerChecklist', 'proposedChanges',
  ])) return false;
  if (reviewPackage.schemaVersion !== REVIEW_PACKAGE_SCHEMA_VERSION
      || reviewPackage.type !== 'ontology_maintainer_review_package'
      || !/^ontology-maintainer-attempt-[0-9a-f-]{36}$/.test(reviewPackage.attemptId)
      || !isIsoTimestamp(reviewPackage.generatedAt)
      || reviewPackage.provider !== 'none'
      || reviewPackage.applyAllowed !== false
      || !Array.isArray(reviewPackage.proposedChanges) || reviewPackage.proposedChanges.length !== 0
      || !Array.isArray(reviewPackage.reviewerChecklist)
      || reviewPackage.reviewerChecklist.some(item => typeof item !== 'string')) return false;
  if (!hasExactKeys(reviewPackage.policy, ['policyVersion', 'reasonCode', 'state'])
      || reviewPackage.policy.policyVersion !== '1'
      || reviewPackage.policy.reasonCode !== 'manual_review_allowed'
      || reviewPackage.policy.state !== 'review_package_ready') return false;
  if (!hasExactKeys(reviewPackage.candidate, [
    'id', 'domainKey', 'filePath', 'status', 'latestContentFingerprint',
    'firstObservedAt', 'lastObservedAt', 'observationCount',
  ]) || !/^ontology-candidate-[a-f0-9]{24}$/.test(reviewPackage.candidate.id)
      || !/^domain_[a-z][a-z0-9_]*$/.test(reviewPackage.candidate.domainKey)
      || !isSafeRelativePath(reviewPackage.candidate.filePath)
      || reviewPackage.candidate.status !== 'pending_review'
      || !/^[a-f0-9]{64}$/.test(reviewPackage.candidate.latestContentFingerprint)
      || !isIsoTimestamp(reviewPackage.candidate.firstObservedAt)
      || !isIsoTimestamp(reviewPackage.candidate.lastObservedAt)
      || !Number.isSafeInteger(reviewPackage.candidate.observationCount)
      || reviewPackage.candidate.observationCount < 1) return false;
  if (!Array.isArray(reviewPackage.evidence)) return false;
  return reviewPackage.evidence.every(item => hasExactKeys(item, ['observationId', 'observedAt'])
    && /^ontology-observation-[a-f0-9]{24}$/.test(item.observationId)
    && isIsoTimestamp(item.observedAt))
    && reviewPackage.reviewerChecklist.length === REVIEWER_CHECKLIST.length
    && reviewPackage.reviewerChecklist.every((item, index) => item === REVIEWER_CHECKLIST[index]);
}

function buildAttempt({ attemptId, candidateId, requestedCandidateId, policy, mode, provider, apply, reviewPackage, now }) {
  return {
    id: attemptId,
    candidateId: candidateId || null,
    requestedCandidateId: requestedCandidateId || null,
    policyId: POLICY_ID,
    policyVersion: policy.policyVersion,
    requestedMode: mode,
    providerRequested: provider !== null && provider !== undefined,
    applyRequested: Boolean(apply),
    decision: policy.allowed ? 'allowed' : 'denied',
    reasonCode: policy.reasonCode,
    state: policy.state,
    reviewPackage,
    createdAt: now || new Date().toISOString(),
    completedAt: now || new Date().toISOString(),
  };
}

function runOntologyMaintainerDryRun({ candidateId, stateStore, mode = MODE_MANUAL_DRY_RUN, provider = null, apply = false, now } = {}) {
  if (!stateStore || typeof stateStore.getOntologyMaintainerPolicyState !== 'function'
      || typeof stateStore.getOntologyCandidateById !== 'function'
      || typeof stateStore.listOntologyCandidateEvidence !== 'function'
      || typeof stateStore.recordOntologyMaintainerAttempt !== 'function') {
    return { status: 'denied', reasonCode: 'state_store_unavailable', reviewPackage: null };
  }
  const policyState = stateStore.getOntologyMaintainerPolicyState();
  const candidate = stateStore.getOntologyCandidateById(candidateId);
  const evidence = candidate
    ? stateStore.listOntologyCandidateEvidence(candidate.id, { limit: REVIEW_EVIDENCE_LIMIT })
    : [];
  const policy = evaluateOntologyMaintainerPolicy({ candidate, evidence, policyState, mode, provider, apply });
  const attemptId = createAttemptId();
  const reviewPackage = policy.allowed
    ? buildOntologyMaintainerReviewPackage({ attemptId, candidate, evidence, policy, generatedAt: now })
    : null;
  const attempt = buildAttempt({
    attemptId,
    candidateId: candidate?.id || null,
    requestedCandidateId: candidateId,
    policy,
    mode,
    provider,
    apply,
    reviewPackage,
    now,
  });
  try {
    stateStore.recordOntologyMaintainerAttempt(attempt);
  } catch {
    return { status: 'denied', reasonCode: 'attempt_ledger_unavailable', reviewPackage: null };
  }
  if (!policy.allowed) return { status: 'denied', reasonCode: policy.reasonCode, reviewPackage: null };
  return { status: 'review_package_ready', attempt, reviewPackage };
}

module.exports = {
  MODE_MANUAL_DRY_RUN,
  POLICY_ID,
  REVIEW_EVIDENCE_LIMIT,
  REVIEW_PACKAGE_SCHEMA_VERSION,
  buildOntologyMaintainerReviewPackage,
  evaluateOntologyMaintainerPolicy,
  runOntologyMaintainerDryRun,
  validateOntologyMaintainerReviewPackage,
};
