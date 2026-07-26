'use strict';

const crypto = require('crypto');
const path = require('path');
const { assertValidEntity } = require('./schema');
const {
  POLICY_ID,
  REVIEW_EVIDENCE_LIMIT,
  evaluateOntologyMaintainerPolicy,
  validateOntologyMaintainerReviewPackage,
} = require('../ontology-maintainer');
const {
  assertValidOntologyMaintainerApproval,
  assertValidOntologyMaintainerJob,
  assertValidOntologyMaintainerProposal,
  assertValidOntologyMaintainerReceipt,
  verifyOntologyMaintainerArtifactReference,
} = require('../ontology-maintainer-protocol');

const ACTIVE_SESSION_STATES = ['active', 'running', 'idle'];
const SUCCESS_OUTCOMES = new Set(['success', 'succeeded', 'passed']);
const FAILURE_OUTCOMES = new Set(['failure', 'failed', 'error']);

function normalizeLimit(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: ${value}`);
  }

  return parsed;
}

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return JSON.parse(value);
}

function stringifyJson(value, label) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new Error(`Failed to serialize ${label}: ${error.message}`);
  }
}

function mapSessionRow(row) {
  const snapshot = parseJsonColumn(row.snapshot, {});
  return {
    id: row.id,
    adapterId: row.adapter_id,
    harness: row.harness,
    state: row.state,
    repoRoot: row.repo_root,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    snapshot,
    workerCount: Array.isArray(snapshot && snapshot.workers) ? snapshot.workers.length : 0,
  };
}

function mapSkillRunRow(row) {
  return {
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    sessionId: row.session_id,
    taskDescription: row.task_description,
    outcome: row.outcome,
    failureReason: row.failure_reason,
    tokensUsed: row.tokens_used,
    durationMs: row.duration_ms,
    userFeedback: row.user_feedback,
    createdAt: row.created_at,
  };
}

function mapSkillVersionRow(row) {
  return {
    skillId: row.skill_id,
    version: row.version,
    contentHash: row.content_hash,
    amendmentReason: row.amendment_reason,
    promotedAt: row.promoted_at,
    rolledBackAt: row.rolled_back_at,
  };
}

function mapDecisionRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    rationale: row.rationale,
    alternatives: parseJsonColumn(row.alternatives, []),
    supersedes: row.supersedes,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapInstallStateRow(row) {
  const modules = parseJsonColumn(row.modules, []);
  const operations = parseJsonColumn(row.operations, []);
  const status = row.source_version && row.installed_at ? 'healthy' : 'warning';

  return {
    targetId: row.target_id,
    targetRoot: row.target_root,
    profile: row.profile,
    modules,
    operations,
    installedAt: row.installed_at,
    sourceVersion: row.source_version,
    moduleCount: Array.isArray(modules) ? modules.length : 0,
    operationCount: Array.isArray(operations) ? operations.length : 0,
    status,
  };
}

function mapGovernanceEventRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    payload: parseJsonColumn(row.payload, null),
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    createdAt: row.created_at,
  };
}

function createProjectKey(projectRoot) {
  return crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex');
}

function mapOntologyCandidateRow(row) {
  return {
    id: row.id,
    candidateKey: row.candidate_key,
    projectKey: row.project_key,
    domainKey: row.domain_key,
    filePath: row.file_path,
    kind: row.kind,
    status: row.status,
    latestContentFingerprint: row.latest_content_fingerprint,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    observationCount: row.observation_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOntologyCandidateSourceRow(row) {
  return {
    observationId: row.observation_id,
    candidateId: row.candidate_id,
    spoolPath: row.spool_path,
    lineEndOffset: row.line_end_offset,
    observedAt: row.observed_at,
  };
}

function mapOntologyMaintainerAttemptRow(row) {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    requestedCandidateId: row.requested_candidate_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    requestedMode: row.requested_mode,
    providerRequested: Boolean(row.provider_requested),
    applyRequested: Boolean(row.apply_requested),
    decision: row.decision,
    reasonCode: row.reason_code,
    state: row.state,
    reviewPackage: parseJsonColumn(row.review_package_json, null),
    reviewPackageSha256: row.review_package_sha256,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapOntologyMaintainerJobRow(row) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_job',
    id: row.id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    candidateId: row.candidate_id,
    reviewPackageSha256: row.review_package_sha256,
    candidateFingerprint: row.candidate_fingerprint,
    repoHead: row.repo_head,
    hop: row.hop,
    hopLimit: row.hop_limit,
    createdAt: row.created_at,
  };
}

function mapOntologyMaintainerJobStateRow(row) {
  return {
    ...mapOntologyMaintainerJobRow(row),
    state: row.state,
    attemptCount: row.attempt_count,
    lastReasonCode: row.last_reason_code,
    updatedAt: row.updated_at,
  };
}

function mapOntologyMaintainerProposalRow(row) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_proposal',
    id: row.id,
    jobId: row.job_id,
    provider: row.provider,
    reviewPackageSha256: row.review_package_sha256,
    candidateFingerprint: row.candidate_fingerprint,
    repoHead: row.repo_head,
    targetPath: row.target_path,
    targetBeforeHash: row.target_before_hash,
    intent: { action: row.intent_action, subject: row.intent_subject },
    proposalSha256: row.proposal_sha256,
    createdAt: row.created_at,
  };
}

function mapOntologyMaintainerReceiptRow(row) {
  const hasArtifact = row.artifact_id !== null;
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_receipt',
    id: row.id,
    jobId: row.job_id,
    proposalId: row.proposal_id,
    provider: row.provider,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    artifactReference: hasArtifact ? {
      artifactId: row.artifact_id,
      artifactHash: row.artifact_hash,
      persistedAt: row.artifact_persisted_at,
      signature: row.artifact_signature,
    } : null,
    createdAt: row.created_at,
  };
}

function mapOntologyMaintainerApprovalRow(row) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_approval',
    id: row.id,
    proposalId: row.proposal_id,
    proposalSha256: row.proposal_sha256,
    reviewPackageSha256: row.review_package_sha256,
    candidateFingerprint: row.candidate_fingerprint,
    repoHead: row.repo_head,
    targetPath: row.target_path,
    targetBeforeHash: row.target_before_hash,
    decision: row.decision,
    approverId: row.approver_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapOntologyMaintainerPromotionRow(row) {
  return {
    id: row.id,
    approvalId: row.approval_id,
    proposalId: row.proposal_id,
    repoRoot: row.repo_root,
    targetPath: row.target_path,
    targetBeforeHash: row.target_before_hash,
    targetAfterHash: row.target_after_hash,
    state: row.state,
    reasonCode: row.reason_code,
    ownerToken: row.owner_token,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function classifyOutcome(outcome) {
  const normalized = String(outcome || '').toLowerCase();
  if (SUCCESS_OUTCOMES.has(normalized)) {
    return 'success';
  }

  if (FAILURE_OUTCOMES.has(normalized)) {
    return 'failure';
  }

  return 'unknown';
}

function toPercent(numerator, denominator) {
  if (denominator === 0) {
    return null;
  }

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function summarizeSkillRuns(skillRuns) {
  const summary = {
    totalCount: skillRuns.length,
    knownCount: 0,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    failureRate: null,
  };

  for (const skillRun of skillRuns) {
    const classification = classifyOutcome(skillRun.outcome);
    if (classification === 'success') {
      summary.successCount += 1;
      summary.knownCount += 1;
    } else if (classification === 'failure') {
      summary.failureCount += 1;
      summary.knownCount += 1;
    } else {
      summary.unknownCount += 1;
    }
  }

  summary.successRate = toPercent(summary.successCount, summary.knownCount);
  summary.failureRate = toPercent(summary.failureCount, summary.knownCount);
  return summary;
}

function summarizeInstallHealth(installations) {
  if (installations.length === 0) {
    return {
      status: 'missing',
      totalCount: 0,
      healthyCount: 0,
      warningCount: 0,
      installations: [],
    };
  }

  const summary = installations.reduce((result, installation) => {
    if (installation.status === 'healthy') {
      result.healthyCount += 1;
    } else {
      result.warningCount += 1;
    }
    return result;
  }, {
    totalCount: installations.length,
    healthyCount: 0,
    warningCount: 0,
  });

  return {
    status: summary.warningCount > 0 ? 'warning' : 'healthy',
    ...summary,
    installations,
  };
}

function normalizeSessionInput(session) {
  return {
    id: session.id,
    adapterId: session.adapterId,
    harness: session.harness,
    state: session.state,
    repoRoot: session.repoRoot ?? null,
    startedAt: session.startedAt ?? null,
    endedAt: session.endedAt ?? null,
    snapshot: session.snapshot ?? {},
  };
}

function normalizeSkillRunInput(skillRun) {
  return {
    id: skillRun.id,
    skillId: skillRun.skillId,
    skillVersion: skillRun.skillVersion,
    sessionId: skillRun.sessionId,
    taskDescription: skillRun.taskDescription,
    outcome: skillRun.outcome,
    failureReason: skillRun.failureReason ?? null,
    tokensUsed: skillRun.tokensUsed ?? null,
    durationMs: skillRun.durationMs ?? null,
    userFeedback: skillRun.userFeedback ?? null,
    createdAt: skillRun.createdAt || new Date().toISOString(),
  };
}

function normalizeSkillVersionInput(skillVersion) {
  return {
    skillId: skillVersion.skillId,
    version: skillVersion.version,
    contentHash: skillVersion.contentHash,
    amendmentReason: skillVersion.amendmentReason ?? null,
    promotedAt: skillVersion.promotedAt ?? null,
    rolledBackAt: skillVersion.rolledBackAt ?? null,
  };
}

function normalizeDecisionInput(decision) {
  return {
    id: decision.id,
    sessionId: decision.sessionId,
    title: decision.title,
    rationale: decision.rationale,
    alternatives: decision.alternatives === undefined || decision.alternatives === null
      ? []
      : decision.alternatives,
    supersedes: decision.supersedes ?? null,
    status: decision.status,
    createdAt: decision.createdAt || new Date().toISOString(),
  };
}

function normalizeInstallStateInput(installState) {
  return {
    targetId: installState.targetId,
    targetRoot: installState.targetRoot,
    profile: installState.profile ?? null,
    modules: installState.modules === undefined || installState.modules === null
      ? []
      : installState.modules,
    operations: installState.operations === undefined || installState.operations === null
      ? []
      : installState.operations,
    installedAt: installState.installedAt || new Date().toISOString(),
    sourceVersion: installState.sourceVersion ?? null,
  };
}

function normalizeGovernanceEventInput(governanceEvent) {
  return {
    id: governanceEvent.id,
    sessionId: governanceEvent.sessionId ?? null,
    eventType: governanceEvent.eventType,
    payload: governanceEvent.payload ?? null,
    resolvedAt: governanceEvent.resolvedAt ?? null,
    resolution: governanceEvent.resolution ?? null,
    createdAt: governanceEvent.createdAt || new Date().toISOString(),
  };
}

function createQueryApi(db) {
  const listRecentSessionsStatement = db.prepare(`
    SELECT *
    FROM sessions
    ORDER BY COALESCE(started_at, ended_at, '') DESC, id DESC
    LIMIT ?
  `);
  const countSessionsStatement = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM sessions
  `);
  const getSessionStatement = db.prepare(`
    SELECT *
    FROM sessions
    WHERE id = ?
  `);
  const getSessionSkillRunsStatement = db.prepare(`
    SELECT *
    FROM skill_runs
    WHERE session_id = ?
    ORDER BY created_at DESC, id DESC
  `);
  const getSessionDecisionsStatement = db.prepare(`
    SELECT *
    FROM decisions
    WHERE session_id = ?
    ORDER BY created_at DESC, id DESC
  `);
  const listActiveSessionsStatement = db.prepare(`
    SELECT *
    FROM sessions
    WHERE ended_at IS NULL
      AND state IN ('active', 'running', 'idle')
    ORDER BY COALESCE(started_at, ended_at, '') DESC, id DESC
    LIMIT ?
  `);
  const countActiveSessionsStatement = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM sessions
    WHERE ended_at IS NULL
      AND state IN ('active', 'running', 'idle')
  `);
  const listRecentSkillRunsStatement = db.prepare(`
    SELECT *
    FROM skill_runs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const listInstallStateStatement = db.prepare(`
    SELECT *
    FROM install_state
    ORDER BY installed_at DESC, target_id ASC
  `);
  const countPendingGovernanceStatement = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM governance_events
    WHERE resolved_at IS NULL
  `);
  const listPendingGovernanceStatement = db.prepare(`
    SELECT *
    FROM governance_events
    WHERE resolved_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const getSkillVersionStatement = db.prepare(`
    SELECT *
    FROM skill_versions
    WHERE skill_id = ? AND version = ?
  `);
  const getOntologyCandidateByKeyStatement = db.prepare(`
    SELECT *
    FROM ontology_update_candidates
    WHERE candidate_key = ?
  `);
  const getOntologyCandidateByIdStatement = db.prepare(`
    SELECT *
    FROM ontology_update_candidates
    WHERE id = ?
  `);
  const getOntologyCandidateSourceStatement = db.prepare(`
    SELECT observation_id
    FROM ontology_candidate_sources
    WHERE observation_id = ?
  `);
  const listOntologyCandidatesStatement = db.prepare(`
    SELECT *
    FROM ontology_update_candidates
    WHERE status = ?
      AND (? IS NULL OR project_key = ?)
      AND (? IS NULL OR domain_key = ?)
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `);
  const countOntologyCandidatesStatement = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM ontology_update_candidates
    WHERE status = ?
      AND (? IS NULL OR project_key = ?)
      AND (? IS NULL OR domain_key = ?)
  `);
  const listOntologyCandidateEvidenceStatement = db.prepare(`
    SELECT *
    FROM ontology_candidate_sources
    WHERE candidate_id = ?
    ORDER BY observed_at DESC, observation_id DESC
    LIMIT ?
  `);
  const getOntologyObservationCursorStatement = db.prepare(`
    SELECT spool_path, byte_offset, updated_at
    FROM ontology_observation_spool_cursors
    WHERE spool_path = ?
  `);
  const getOntologyMaintainerPolicyStateStatement = db.prepare(`
    SELECT *
    FROM ontology_maintainer_policy_state
    WHERE policy_id = 'ontology-maintainer-v1'
  `);
  const insertOntologyMaintainerAttemptStatement = db.prepare(`
    INSERT INTO ontology_maintainer_attempts (
      id, candidate_id, requested_candidate_id, policy_id, policy_version, requested_mode,
      provider_requested, apply_requested, decision, reason_code, state,
      review_package_json, review_package_sha256, created_at, completed_at
    ) VALUES (
      @id, @candidate_id, @requested_candidate_id, @policy_id, @policy_version, @requested_mode,
      @provider_requested, @apply_requested, @decision, @reason_code, @state,
      @review_package_json, @review_package_sha256, @created_at, @completed_at
    )
  `);
  const listOntologyMaintainerAttemptsStatement = db.prepare(`
    SELECT *
    FROM ontology_maintainer_attempts
    WHERE (? IS NULL OR candidate_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const getOntologyMaintainerReviewPackageStatement = db.prepare(`
    SELECT *
    FROM ontology_maintainer_attempts
    WHERE candidate_id = ?
      AND review_package_sha256 = ?
      AND decision = 'allowed'
      AND state = 'review_package_ready'
      AND review_package_json IS NOT NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const getOntologyMaintainerJobByIdStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_jobs WHERE id = ?
  `);
  const getOntologyMaintainerJobByIdempotencyKeyStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_jobs WHERE idempotency_key = ?
  `);
  const insertOntologyMaintainerJobStatement = db.prepare(`
    INSERT INTO ontology_maintainer_jobs (
      id, idempotency_key, provider, candidate_id, review_package_sha256,
      candidate_fingerprint, repo_head, hop, hop_limit, created_at,
      state, attempt_count, last_reason_code, updated_at
    ) VALUES (
      @id, @idempotency_key, @provider, @candidate_id, @review_package_sha256,
      @candidate_fingerprint, @repo_head, @hop, @hop_limit, @created_at,
      @state, @attempt_count, @last_reason_code, @updated_at
    )
  `);
  const reclaimOntologyMaintainerJobStatement = db.prepare(`
    UPDATE ontology_maintainer_jobs
    SET state = 'claimed', attempt_count = attempt_count + 1, last_reason_code = NULL, updated_at = @updated_at
    WHERE id = @id AND state = 'retryable_failure'
  `);
  const recordOntologyMaintainerJobOutcomeStatement = db.prepare(`
    UPDATE ontology_maintainer_jobs
    SET state = 'retryable_failure', last_reason_code = @reason_code, updated_at = @updated_at
    WHERE id = @id AND state = 'claimed'
  `);
  const markOntologyMaintainerJobProposalRecordedStatement = db.prepare(`
    UPDATE ontology_maintainer_jobs
    SET state = 'proposal_recorded', last_reason_code = NULL, updated_at = @updated_at
    WHERE id = @id AND state = 'claimed'
  `);
  const getOntologyMaintainerProposalByIdStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_proposals WHERE id = ?
  `);
  const getOntologyMaintainerProposalByJobIdStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_proposals WHERE job_id = ?
  `);
  const insertOntologyMaintainerProposalStatement = db.prepare(`
    INSERT INTO ontology_maintainer_proposals (
      id, job_id, provider, review_package_sha256, candidate_fingerprint,
      repo_head, target_path, target_before_hash, intent_action, intent_subject,
      proposal_sha256, created_at
    ) VALUES (
      @id, @job_id, @provider, @review_package_sha256, @candidate_fingerprint,
      @repo_head, @target_path, @target_before_hash, @intent_action, @intent_subject,
      @proposal_sha256, @created_at
    )
  `);
  const insertOntologyMaintainerReceiptStatement = db.prepare(`
    INSERT INTO ontology_maintainer_receipts (
      id, job_id, proposal_id, provider, outcome, reason_code,
      artifact_id, artifact_hash, artifact_persisted_at, artifact_signature, created_at
    ) VALUES (
      @id, @job_id, @proposal_id, @provider, @outcome, @reason_code,
      @artifact_id, @artifact_hash, @artifact_persisted_at, @artifact_signature, @created_at
    )
  `);
  const getSuccessfulOntologyMaintainerReceiptStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_receipts
    WHERE proposal_id = ? AND outcome = 'succeeded'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const listOntologyMaintainerReceiptsStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_receipts
    WHERE (? IS NULL OR proposal_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const insertOntologyMaintainerApprovalStatement = db.prepare(`
    INSERT INTO ontology_maintainer_approvals (
      id, proposal_id, proposal_sha256, review_package_sha256, candidate_fingerprint,
      repo_head, target_path, target_before_hash, decision, approver_id, expires_at, created_at
    ) VALUES (
      @id, @proposal_id, @proposal_sha256, @review_package_sha256, @candidate_fingerprint,
      @repo_head, @target_path, @target_before_hash, @decision, @approver_id, @expires_at, @created_at
    )
  `);
  const listOntologyMaintainerApprovalsStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_approvals
    WHERE (? IS NULL OR proposal_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const getOntologyMaintainerApprovalByIdStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_approvals WHERE id = ?
  `);
  const getOntologyMaintainerPromotionByApprovalIdStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_promotions WHERE approval_id = ?
  `);
  const insertOntologyMaintainerPromotionStatement = db.prepare(`
    INSERT INTO ontology_maintainer_promotions (
      id, approval_id, proposal_id, repo_root, target_path,
      target_before_hash, target_after_hash, state, reason_code, owner_token, lease_expires_at,
      created_at, completed_at
    ) VALUES (
      @id, @approval_id, @proposal_id, @repo_root, @target_path,
      @target_before_hash, @target_after_hash, @state, @reason_code, @owner_token, @lease_expires_at,
      @created_at, @completed_at
    )
  `);
  const updateOntologyMaintainerPromotionStatement = db.prepare(`
    UPDATE ontology_maintainer_promotions
    SET state = @state, reason_code = @reason_code, completed_at = @completed_at
    WHERE approval_id = @approval_id AND state = 'prepared' AND owner_token = @owner_token
  `);
  const listOntologyMaintainerPromotionsStatement = db.prepare(`
    SELECT * FROM ontology_maintainer_promotions
    WHERE (? IS NULL OR approval_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  const upsertSessionStatement = db.prepare(`
    INSERT INTO sessions (
      id,
      adapter_id,
      harness,
      state,
      repo_root,
      started_at,
      ended_at,
      snapshot
    ) VALUES (
      @id,
      @adapter_id,
      @harness,
      @state,
      @repo_root,
      @started_at,
      @ended_at,
      @snapshot
    )
    ON CONFLICT(id) DO UPDATE SET
      adapter_id = excluded.adapter_id,
      harness = excluded.harness,
      state = excluded.state,
      repo_root = excluded.repo_root,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      snapshot = excluded.snapshot
  `);

  const insertSkillRunStatement = db.prepare(`
    INSERT INTO skill_runs (
      id,
      skill_id,
      skill_version,
      session_id,
      task_description,
      outcome,
      failure_reason,
      tokens_used,
      duration_ms,
      user_feedback,
      created_at
    ) VALUES (
      @id,
      @skill_id,
      @skill_version,
      @session_id,
      @task_description,
      @outcome,
      @failure_reason,
      @tokens_used,
      @duration_ms,
      @user_feedback,
      @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      skill_id = excluded.skill_id,
      skill_version = excluded.skill_version,
      session_id = excluded.session_id,
      task_description = excluded.task_description,
      outcome = excluded.outcome,
      failure_reason = excluded.failure_reason,
      tokens_used = excluded.tokens_used,
      duration_ms = excluded.duration_ms,
      user_feedback = excluded.user_feedback,
      created_at = excluded.created_at
  `);

  const upsertSkillVersionStatement = db.prepare(`
    INSERT INTO skill_versions (
      skill_id,
      version,
      content_hash,
      amendment_reason,
      promoted_at,
      rolled_back_at
    ) VALUES (
      @skill_id,
      @version,
      @content_hash,
      @amendment_reason,
      @promoted_at,
      @rolled_back_at
    )
    ON CONFLICT(skill_id, version) DO UPDATE SET
      content_hash = excluded.content_hash,
      amendment_reason = excluded.amendment_reason,
      promoted_at = excluded.promoted_at,
      rolled_back_at = excluded.rolled_back_at
  `);

  const insertDecisionStatement = db.prepare(`
    INSERT INTO decisions (
      id,
      session_id,
      title,
      rationale,
      alternatives,
      supersedes,
      status,
      created_at
    ) VALUES (
      @id,
      @session_id,
      @title,
      @rationale,
      @alternatives,
      @supersedes,
      @status,
      @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id,
      title = excluded.title,
      rationale = excluded.rationale,
      alternatives = excluded.alternatives,
      supersedes = excluded.supersedes,
      status = excluded.status,
      created_at = excluded.created_at
  `);

  const upsertInstallStateStatement = db.prepare(`
    INSERT INTO install_state (
      target_id,
      target_root,
      profile,
      modules,
      operations,
      installed_at,
      source_version
    ) VALUES (
      @target_id,
      @target_root,
      @profile,
      @modules,
      @operations,
      @installed_at,
      @source_version
    )
    ON CONFLICT(target_id, target_root) DO UPDATE SET
      profile = excluded.profile,
      modules = excluded.modules,
      operations = excluded.operations,
      installed_at = excluded.installed_at,
      source_version = excluded.source_version
  `);

  const insertGovernanceEventStatement = db.prepare(`
    INSERT INTO governance_events (
      id,
      session_id,
      event_type,
      payload,
      resolved_at,
      resolution,
      created_at
    ) VALUES (
      @id,
      @session_id,
      @event_type,
      @payload,
      @resolved_at,
      @resolution,
      @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id,
      event_type = excluded.event_type,
      payload = excluded.payload,
      resolved_at = excluded.resolved_at,
      resolution = excluded.resolution,
      created_at = excluded.created_at
  `);
  const insertOntologyCandidateStatement = db.prepare(`
    INSERT INTO ontology_update_candidates (
      id, candidate_key, project_key, domain_key, file_path, kind, status,
      latest_content_fingerprint, first_observed_at, last_observed_at,
      observation_count, created_at, updated_at
    ) VALUES (
      @id, @candidate_key, @project_key, @domain_key, @file_path, @kind, @status,
      @latest_content_fingerprint, @first_observed_at, @last_observed_at,
      @observation_count, @created_at, @updated_at
    )
  `);
  const updateOntologyCandidateStatement = db.prepare(`
    UPDATE ontology_update_candidates
    SET latest_content_fingerprint = @latest_content_fingerprint,
        last_observed_at = @last_observed_at,
        observation_count = observation_count + 1,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const insertOntologyCandidateSourceStatement = db.prepare(`
    INSERT INTO ontology_candidate_sources (
      observation_id, candidate_id, spool_path, line_end_offset, observed_at
    ) VALUES (
      @observation_id, @candidate_id, @spool_path, @line_end_offset, @observed_at
    )
  `);
  const upsertOntologyObservationCursorStatement = db.prepare(`
    INSERT INTO ontology_observation_spool_cursors (spool_path, byte_offset, updated_at)
    VALUES (@spool_path, @byte_offset, @updated_at)
    ON CONFLICT(spool_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      updated_at = excluded.updated_at
  `);

  function getSessionById(id) {
    const row = getSessionStatement.get(id);
    return row ? mapSessionRow(row) : null;
  }

  function listRecentSessions(options = {}) {
    const limit = normalizeLimit(options.limit, 10);
    return {
      totalCount: countSessionsStatement.get().total_count,
      sessions: listRecentSessionsStatement.all(limit).map(mapSessionRow),
    };
  }

  function getSessionDetail(id) {
    const session = getSessionById(id);
    if (!session) {
      return null;
    }

    const workers = Array.isArray(session.snapshot && session.snapshot.workers)
      ? session.snapshot.workers.map(worker => ({ ...worker }))
      : [];

    return {
      session,
      workers,
      skillRuns: getSessionSkillRunsStatement.all(id).map(mapSkillRunRow),
      decisions: getSessionDecisionsStatement.all(id).map(mapDecisionRow),
    };
  }

  function getStatus(options = {}) {
    const activeLimit = normalizeLimit(options.activeLimit, 5);
    const recentSkillRunLimit = normalizeLimit(options.recentSkillRunLimit, 20);
    const pendingLimit = normalizeLimit(options.pendingLimit, 5);

    const activeSessions = listActiveSessionsStatement.all(activeLimit).map(mapSessionRow);
    const recentSkillRuns = listRecentSkillRunsStatement.all(recentSkillRunLimit).map(mapSkillRunRow);
    const installations = listInstallStateStatement.all().map(mapInstallStateRow);
    const pendingGovernanceEvents = listPendingGovernanceStatement.all(pendingLimit).map(mapGovernanceEventRow);

    return {
      generatedAt: new Date().toISOString(),
      activeSessions: {
        activeCount: countActiveSessionsStatement.get().total_count,
        sessions: activeSessions,
      },
      skillRuns: {
        windowSize: recentSkillRunLimit,
        summary: summarizeSkillRuns(recentSkillRuns),
        recent: recentSkillRuns,
      },
      installHealth: summarizeInstallHealth(installations),
      governance: {
        pendingCount: countPendingGovernanceStatement.get().total_count,
        events: pendingGovernanceEvents,
      },
    };
  }

  function listOntologyCandidates(options = {}) {
    const limit = normalizeLimit(options.limit, 50);
    const projectKey = options.projectKey || (options.projectRoot ? createProjectKey(options.projectRoot) : null);
    const status = options.status || 'pending_review';
    const domainKey = options.domainKey || null;
    return {
      totalCount: countOntologyCandidatesStatement.get(
        status, projectKey, projectKey, domainKey, domainKey
      ).total_count,
      candidates: listOntologyCandidatesStatement.all(
        status, projectKey, projectKey, domainKey, domainKey, limit
      ).map(mapOntologyCandidateRow),
    };
  }

  function listOntologyCandidateEvidence(candidateId, options = {}) {
    const limit = normalizeLimit(options.limit, REVIEW_EVIDENCE_LIMIT);
    return listOntologyCandidateEvidenceStatement.all(candidateId, limit).map(mapOntologyCandidateSourceRow);
  }

  function getOntologyObservationCursor(spoolPath) {
    const row = getOntologyObservationCursorStatement.get(spoolPath);
    if (!row) return null;
    return {
      spoolPath: row.spool_path,
      byteOffset: row.byte_offset,
      updatedAt: row.updated_at,
    };
  }

  function getOntologyCandidateById(id) {
    const row = getOntologyCandidateByIdStatement.get(id);
    return row ? mapOntologyCandidateRow(row) : null;
  }

  function getOntologyMaintainerPolicyState() {
    const row = getOntologyMaintainerPolicyStateStatement.get();
    if (!row) return null;
    return {
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      enabled: Boolean(row.enabled),
      manualDryRunEnabled: Boolean(row.manual_dry_run_enabled),
      providerEnabled: Boolean(row.provider_enabled),
      applyEnabled: Boolean(row.apply_enabled),
      updatedAt: row.updated_at,
    };
  }

  function listOntologyMaintainerAttempts(options = {}) {
    const limit = normalizeLimit(options.limit, 50);
    const candidateId = options.candidateId || null;
    return listOntologyMaintainerAttemptsStatement.all(candidateId, candidateId, limit)
      .map(mapOntologyMaintainerAttemptRow);
  }

  function recordOntologyMaintainerAttempt(attempt) {
    const timestamp = attempt.createdAt || new Date().toISOString();
    const completedAt = attempt.completedAt || timestamp;
    const requestedCandidateId = attempt.requestedCandidateId ?? null;
    if (!attempt || typeof attempt.id !== 'string' || attempt.id.trim() === ''
        || typeof attempt.policyId !== 'string' || attempt.policyId.trim() === ''
        || typeof attempt.requestedMode !== 'string' || attempt.requestedMode.trim() === ''
        || typeof attempt.reasonCode !== 'string' || attempt.reasonCode.trim() === ''
        || typeof attempt.providerRequested !== 'boolean'
        || typeof attempt.applyRequested !== 'boolean'
        || (requestedCandidateId !== null && !/^ontology-candidate-[a-f0-9]{24}$/.test(requestedCandidateId))
        || !['allowed', 'denied'].includes(attempt.decision)
        || !['review_package_ready', 'denied'].includes(attempt.state)) {
      throw new Error('Invalid ontology maintainer attempt');
    }
    const reviewPackage = attempt.reviewPackage ?? null;
    if (reviewPackage !== null && !validateOntologyMaintainerReviewPackage(reviewPackage)) {
      throw new Error('Invalid ontology maintainer review package');
    }
    const policyRow = getOntologyMaintainerPolicyStateStatement.get();
    const policyState = policyRow && {
      policyId: policyRow.policy_id,
      policyVersion: policyRow.policy_version,
      enabled: Boolean(policyRow.enabled),
      manualDryRunEnabled: Boolean(policyRow.manual_dry_run_enabled),
      providerEnabled: Boolean(policyRow.provider_enabled),
      applyEnabled: Boolean(policyRow.apply_enabled),
      updatedAt: policyRow.updated_at,
    };
    const candidateRow = attempt.candidateId ? getOntologyCandidateByIdStatement.get(attempt.candidateId) : null;
    const candidate = candidateRow ? mapOntologyCandidateRow(candidateRow) : null;
    const evidence = candidate
      ? listOntologyCandidateEvidenceStatement.all(candidate.id, REVIEW_EVIDENCE_LIMIT).map(mapOntologyCandidateSourceRow)
      : [];
    const evaluatedPolicy = evaluateOntologyMaintainerPolicy({
      candidate,
      evidence,
      policyState,
      mode: attempt.requestedMode,
      provider: attempt.providerRequested ? 'requested' : null,
      apply: attempt.applyRequested,
    });
    if (attempt.policyId !== POLICY_ID
        || attempt.policyVersion !== evaluatedPolicy.policyVersion
        || attempt.decision !== (evaluatedPolicy.allowed ? 'allowed' : 'denied')
        || attempt.reasonCode !== evaluatedPolicy.reasonCode
        || attempt.state !== evaluatedPolicy.state
        || (candidate !== null && requestedCandidateId !== candidate.id)
        || (evaluatedPolicy.allowed !== (reviewPackage !== null))
        || (reviewPackage !== null && reviewPackage.attemptId !== attempt.id)) {
      throw new Error('Ontology maintainer attempt does not match policy evaluation');
    }
    if (reviewPackage !== null) {
      const expectedCandidate = candidate && {
        id: candidate.id,
        domainKey: candidate.domainKey,
        filePath: candidate.filePath,
        status: candidate.status,
        latestContentFingerprint: candidate.latestContentFingerprint,
        firstObservedAt: candidate.firstObservedAt,
        lastObservedAt: candidate.lastObservedAt,
        observationCount: candidate.observationCount,
      };
      const expectedEvidence = evidence.map(item => ({
        observationId: item.observationId,
        observedAt: item.observedAt,
      }));
      if (JSON.stringify(reviewPackage.candidate) !== JSON.stringify(expectedCandidate)
          || JSON.stringify(reviewPackage.evidence) !== JSON.stringify(expectedEvidence)) {
        throw new Error('Ontology maintainer review package does not match persisted candidate evidence');
      }
    }
    const reviewPackageJson = reviewPackage === null ? null : stringifyJson(reviewPackage, 'ontologyMaintainerAttempt.reviewPackage');
    const reviewPackageSha256 = reviewPackage === null
      ? null
      : crypto.createHash('sha256').update(reviewPackageJson).digest('hex');
    insertOntologyMaintainerAttemptStatement.run({
      id: attempt.id,
      candidate_id: attempt.candidateId ?? null,
      requested_candidate_id: requestedCandidateId,
      policy_id: attempt.policyId,
      policy_version: attempt.policyVersion ?? null,
      requested_mode: attempt.requestedMode,
      provider_requested: attempt.providerRequested ? 1 : 0,
      apply_requested: attempt.applyRequested ? 1 : 0,
      decision: attempt.decision,
      reason_code: attempt.reasonCode,
      state: attempt.state,
      review_package_json: reviewPackageJson,
      review_package_sha256: reviewPackageSha256,
      created_at: timestamp,
      completed_at: completedAt,
    });
    return {
      ...attempt,
      createdAt: timestamp,
      completedAt,
      reviewPackageSha256,
    };
  }

  function assertOntologyMaintainerJobFresh(job) {
    const candidateRow = getOntologyCandidateByIdStatement.get(job.candidateId);
    const candidate = candidateRow ? mapOntologyCandidateRow(candidateRow) : null;
    if (!candidate || candidate.status !== 'pending_review'
        || candidate.latestContentFingerprint !== job.candidateFingerprint) {
      throw new Error('Ontology maintainer job has a stale candidate fingerprint');
    }
    const attemptRow = getOntologyMaintainerReviewPackageStatement.get(job.candidateId, job.reviewPackageSha256);
    if (!attemptRow) throw new Error('Ontology maintainer job has a missing or stale review package');
    const reviewPackage = parseJsonColumn(attemptRow.review_package_json, null);
    if (!validateOntologyMaintainerReviewPackage(reviewPackage)
        || reviewPackage.candidate.id !== candidate.id
        || reviewPackage.candidate.latestContentFingerprint !== candidate.latestContentFingerprint) {
      throw new Error('Ontology maintainer job review package does not bind the current candidate');
    }
    return candidate;
  }

  function claimOntologyMaintainerJob(job) {
    assertValidOntologyMaintainerJob(job);
    const claim = db.transaction(() => {
      const existing = getOntologyMaintainerJobByIdempotencyKeyStatement.get(job.idempotencyKey);
      if (existing) {
        const stored = mapOntologyMaintainerJobStateRow(existing);
        const immutableFields = [
          'provider', 'candidateId', 'reviewPackageSha256', 'candidateFingerprint', 'repoHead', 'hop', 'hopLimit',
        ];
        if (immutableFields.some(field => stored[field] !== job[field])) {
          throw new Error('Ontology maintainer idempotency conflict');
        }
        if (stored.state === 'retryable_failure') {
          assertOntologyMaintainerJobFresh(stored);
          reclaimOntologyMaintainerJobStatement.run({ id: stored.id, updated_at: new Date().toISOString() });
          return { claimed: true, reclaimed: true, job: mapOntologyMaintainerJobRow(getOntologyMaintainerJobByIdStatement.get(stored.id)) };
        }
        return { claimed: false, reclaimed: false, job: mapOntologyMaintainerJobRow(existing) };
      }

      assertOntologyMaintainerJobFresh(job);
      insertOntologyMaintainerJobStatement.run({
        id: job.id,
        idempotency_key: job.idempotencyKey,
        provider: job.provider,
        candidate_id: job.candidateId,
        review_package_sha256: job.reviewPackageSha256,
        candidate_fingerprint: job.candidateFingerprint,
        repo_head: job.repoHead,
        hop: job.hop,
        hop_limit: job.hopLimit,
        created_at: job.createdAt,
        state: 'claimed',
        attempt_count: 1,
        last_reason_code: null,
        updated_at: job.createdAt,
      });
      return { claimed: true, reclaimed: false, job: { ...job } };
    });
    return claim();
  }

  function getOntologyMaintainerJobById(id) {
    const row = getOntologyMaintainerJobByIdStatement.get(id);
    return row ? mapOntologyMaintainerJobStateRow(row) : null;
  }

  function getOntologyMaintainerJobByIdempotencyKey(idempotencyKey) {
    const row = getOntologyMaintainerJobByIdempotencyKeyStatement.get(idempotencyKey);
    return row ? mapOntologyMaintainerJobStateRow(row) : null;
  }

  function assertProposalMatchesJob(proposal, job, currentRepoHead) {
    if (typeof currentRepoHead !== 'string' || currentRepoHead !== job.repoHead) {
      throw new Error('Ontology maintainer proposal has a stale repo head');
    }
    if (proposal.jobId !== job.id || proposal.provider !== job.provider
        || proposal.reviewPackageSha256 !== job.reviewPackageSha256
        || proposal.candidateFingerprint !== job.candidateFingerprint
        || proposal.repoHead !== job.repoHead) {
      throw new Error('Ontology maintainer proposal does not match its claimed job');
    }
    assertOntologyMaintainerJobFresh(job);
  }

  function recordOntologyMaintainerProposal(proposal, { currentRepoHead } = {}) {
    assertValidOntologyMaintainerProposal(proposal);
    const record = db.transaction(() => {
      const jobRow = getOntologyMaintainerJobByIdStatement.get(proposal.jobId);
      if (!jobRow) throw new Error('Ontology maintainer proposal job was not claimed');
      const job = mapOntologyMaintainerJobStateRow(jobRow);
      const existing = getOntologyMaintainerProposalByJobIdStatement.get(job.id);
      if (existing) {
        const stored = mapOntologyMaintainerProposalRow(existing);
        if (stored.proposalSha256 !== proposal.proposalSha256) {
          throw new Error('Ontology maintainer job already has a different immutable proposal');
        }
        return stored;
      }
      if (job.state !== 'claimed') {
        throw new Error('Ontology maintainer proposal requires an actively claimed job');
      }
      assertProposalMatchesJob(proposal, job, currentRepoHead);
      insertOntologyMaintainerProposalStatement.run({
        id: proposal.id,
        job_id: proposal.jobId,
        provider: proposal.provider,
        review_package_sha256: proposal.reviewPackageSha256,
        candidate_fingerprint: proposal.candidateFingerprint,
        repo_head: proposal.repoHead,
        target_path: proposal.targetPath,
        target_before_hash: proposal.targetBeforeHash,
        intent_action: proposal.intent.action,
        intent_subject: proposal.intent.subject,
        proposal_sha256: proposal.proposalSha256,
        created_at: proposal.createdAt,
      });
      markOntologyMaintainerJobProposalRecordedStatement.run({
        id: job.id,
        updated_at: proposal.createdAt,
      });
      return { ...proposal, intent: { ...proposal.intent } };
    });
    return record();
  }

  function recordOntologyMaintainerProposalAndReceipt(proposal, receipt, {
    currentRepoHead, artifactReader, attestationSecret, evidenceStorePath,
  } = {}) {
    assertValidOntologyMaintainerProposal(proposal);
    assertValidOntologyMaintainerReceipt(receipt);
    const record = db.transaction(() => {
      const jobRow = getOntologyMaintainerJobByIdStatement.get(proposal.jobId);
      if (!jobRow) throw new Error('Ontology maintainer proposal job was not claimed');
      const jobState = mapOntologyMaintainerJobStateRow(jobRow);
      const job = mapOntologyMaintainerJobRow(jobRow);
      if (jobState.state !== 'claimed') throw new Error('Ontology maintainer proposal requires an actively claimed job');
      if (getOntologyMaintainerProposalByJobIdStatement.get(job.id)) {
        throw new Error('Ontology maintainer job already has an immutable proposal');
      }
      assertProposalMatchesJob(proposal, job, currentRepoHead);
      if (receipt.jobId !== job.id || receipt.proposalId !== proposal.id
          || receipt.provider !== job.provider || receipt.provider !== proposal.provider) {
        throw new Error('Ontology maintainer receipt provider does not match its job and proposal');
      }
      const artifact = receipt.artifactReference;
      if (receipt.outcome === 'succeeded' && !verifyOntologyMaintainerArtifactReference({
        job, proposal, artifactReference: artifact, artifactReader, attestationSecret, evidenceStorePath,
      })) throw new Error('Ontology maintainer artifact attestation verification failed');
      insertOntologyMaintainerProposalStatement.run({
        id: proposal.id,
        job_id: proposal.jobId,
        provider: proposal.provider,
        review_package_sha256: proposal.reviewPackageSha256,
        candidate_fingerprint: proposal.candidateFingerprint,
        repo_head: proposal.repoHead,
        target_path: proposal.targetPath,
        target_before_hash: proposal.targetBeforeHash,
        intent_action: proposal.intent.action,
        intent_subject: proposal.intent.subject,
        proposal_sha256: proposal.proposalSha256,
        created_at: proposal.createdAt,
      });
      insertOntologyMaintainerReceiptStatement.run({
        id: receipt.id,
        job_id: receipt.jobId,
        proposal_id: receipt.proposalId,
        provider: receipt.provider,
        outcome: receipt.outcome,
        reason_code: receipt.reasonCode,
        artifact_id: artifact?.artifactId ?? null,
        artifact_hash: artifact?.artifactHash ?? null,
        artifact_persisted_at: artifact?.persistedAt ?? null,
        artifact_signature: artifact?.signature ?? null,
        created_at: receipt.createdAt,
      });
      markOntologyMaintainerJobProposalRecordedStatement.run({ id: job.id, updated_at: proposal.createdAt });
      return {
        proposal: { ...proposal, intent: { ...proposal.intent } },
        receipt: { ...receipt, artifactReference: artifact && { ...artifact } },
      };
    });
    return record();
  }

  function getOntologyMaintainerProposalById(id) {
    const row = getOntologyMaintainerProposalByIdStatement.get(id);
    return row ? mapOntologyMaintainerProposalRow(row) : null;
  }

  function recordOntologyMaintainerJobRetryableFailure({ jobId, reasonCode, updatedAt, now } = {}) {
    const outcomeAt = updatedAt || now;
    if (typeof jobId !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(reasonCode || '')
        || typeof outcomeAt !== 'string') {
      throw new Error('Invalid ontology maintainer retryable job outcome');
    }
    const record = db.transaction(() => {
      const jobRow = getOntologyMaintainerJobByIdStatement.get(jobId);
      if (!jobRow) throw new Error('Ontology maintainer retryable outcome job was not claimed');
      const proposal = getOntologyMaintainerProposalByJobIdStatement.get(jobId);
      if (proposal) throw new Error('Ontology maintainer retryable outcome is only allowed before a proposal is recorded');
      const job = mapOntologyMaintainerJobStateRow(jobRow);
      if (job.state !== 'claimed') throw new Error('Ontology maintainer job is not claimable for retryable failure');
      recordOntologyMaintainerJobOutcomeStatement.run({ id: jobId, reason_code: reasonCode, updated_at: outcomeAt });
      return getOntologyMaintainerJobById(jobId);
    });
    return record();
  }

  function recordOntologyMaintainerReceipt(receipt, { artifactReader, attestationSecret, evidenceStorePath } = {}) {
    assertValidOntologyMaintainerReceipt(receipt);
    const record = db.transaction(() => {
      const jobRow = getOntologyMaintainerJobByIdStatement.get(receipt.jobId);
      const proposalRow = getOntologyMaintainerProposalByIdStatement.get(receipt.proposalId);
      if (!jobRow || !proposalRow) throw new Error('Ontology maintainer receipt has no claimed job or proposal');
      const job = mapOntologyMaintainerJobRow(jobRow);
      const proposal = mapOntologyMaintainerProposalRow(proposalRow);
      if (proposal.jobId !== job.id || receipt.provider !== job.provider || receipt.provider !== proposal.provider) {
        throw new Error('Ontology maintainer receipt provider does not match its job and proposal');
      }
      const artifact = receipt.artifactReference;
      if (receipt.outcome === 'succeeded' && !verifyOntologyMaintainerArtifactReference({
        job, proposal, artifactReference: artifact, artifactReader, attestationSecret, evidenceStorePath,
      })) {
        throw new Error('Ontology maintainer artifact attestation verification failed');
      }
      insertOntologyMaintainerReceiptStatement.run({
        id: receipt.id,
        job_id: receipt.jobId,
        proposal_id: receipt.proposalId,
        provider: receipt.provider,
        outcome: receipt.outcome,
        reason_code: receipt.reasonCode,
        artifact_id: artifact?.artifactId ?? null,
        artifact_hash: artifact?.artifactHash ?? null,
        artifact_persisted_at: artifact?.persistedAt ?? null,
        artifact_signature: artifact?.signature ?? null,
        created_at: receipt.createdAt,
      });
      return { ...receipt, artifactReference: artifact && { ...artifact } };
    });
    return record();
  }

  function recordOntologyMaintainerApproval(approval, {
    currentRepoHead, currentTargetBeforeHash, now, artifactReader, attestationSecret, evidenceStorePath,
  } = {}) {
    assertValidOntologyMaintainerApproval(approval);
    const recordedAt = now || new Date().toISOString();
    if (typeof currentRepoHead !== 'string' || typeof currentTargetBeforeHash !== 'string') {
      throw new Error('Ontology maintainer approval requires current repo and target bindings');
    }
    if (Date.parse(approval.expiresAt) <= Date.parse(recordedAt)) {
      throw new Error('Ontology maintainer approval is expired');
    }
    const record = db.transaction(() => {
      const proposalRow = getOntologyMaintainerProposalByIdStatement.get(approval.proposalId);
      if (!proposalRow) throw new Error('Ontology maintainer approval proposal was not recorded');
      const proposal = mapOntologyMaintainerProposalRow(proposalRow);
      const jobRow = getOntologyMaintainerJobByIdStatement.get(proposal.jobId);
      if (!jobRow) throw new Error('Ontology maintainer approval job was not claimed');
      const job = mapOntologyMaintainerJobRow(jobRow);
      if (currentRepoHead !== proposal.repoHead || currentTargetBeforeHash !== proposal.targetBeforeHash) {
        throw new Error('Ontology maintainer approval has a stale repo head or target before-hash');
      }
      if (approval.proposalSha256 !== proposal.proposalSha256
          || approval.reviewPackageSha256 !== proposal.reviewPackageSha256
          || approval.candidateFingerprint !== proposal.candidateFingerprint
          || approval.repoHead !== proposal.repoHead
          || approval.targetPath !== proposal.targetPath
          || approval.targetBeforeHash !== proposal.targetBeforeHash) {
        throw new Error('Ontology maintainer approval does not bind its exact proposal');
      }
      assertOntologyMaintainerJobFresh(job);
      const successfulReceiptRow = getSuccessfulOntologyMaintainerReceiptStatement.get(proposal.id);
      if (approval.decision === 'approved' && !successfulReceiptRow) {
        throw new Error('Ontology maintainer approval requires an attested proposal artifact receipt');
      }
      if (approval.decision === 'approved' && !verifyOntologyMaintainerArtifactReference({
        job,
        proposal,
        artifactReference: mapOntologyMaintainerReceiptRow(successfulReceiptRow).artifactReference,
        artifactReader,
        attestationSecret,
        evidenceStorePath,
      })) {
        throw new Error('Ontology maintainer artifact attestation verification failed');
      }
      insertOntologyMaintainerApprovalStatement.run({
        id: approval.id,
        proposal_id: approval.proposalId,
        proposal_sha256: approval.proposalSha256,
        review_package_sha256: approval.reviewPackageSha256,
        candidate_fingerprint: approval.candidateFingerprint,
        repo_head: approval.repoHead,
        target_path: approval.targetPath,
        target_before_hash: approval.targetBeforeHash,
        decision: approval.decision,
        approver_id: approval.approverId,
        expires_at: approval.expiresAt,
        created_at: approval.createdAt,
      });
      return { ...approval };
    });
    return record();
  }

  function getOntologyMaintainerApprovalById(id) {
    const row = getOntologyMaintainerApprovalByIdStatement.get(id);
    return row ? mapOntologyMaintainerApprovalRow(row) : null;
  }

  function getOntologyMaintainerPromotionByApprovalId(approvalId) {
    const row = getOntologyMaintainerPromotionByApprovalIdStatement.get(approvalId);
    return row ? mapOntologyMaintainerPromotionRow(row) : null;
  }

  function assertOntologyMaintainerPromotionApproval(approvalId, {
    currentRepoHead, currentTargetBeforeHash, now, artifactReader, attestationSecret, evidenceStorePath,
  } = {}) {
    const checkedAt = now || new Date().toISOString();
    if (typeof currentRepoHead !== 'string' || typeof currentTargetBeforeHash !== 'string') {
      throw new Error('Ontology maintainer promotion requires current repo and target bindings');
    }
    const approvalRow = getOntologyMaintainerApprovalByIdStatement.get(approvalId);
    if (!approvalRow) throw new Error('Ontology maintainer promotion approval was not recorded');
    const approval = mapOntologyMaintainerApprovalRow(approvalRow);
    if (approval.decision !== 'approved') throw new Error('Ontology maintainer promotion requires an approved decision');
    if (Date.parse(approval.expiresAt) <= Date.parse(checkedAt)) {
      throw new Error('Ontology maintainer promotion approval is expired');
    }
    const proposalRow = getOntologyMaintainerProposalByIdStatement.get(approval.proposalId);
    if (!proposalRow) throw new Error('Ontology maintainer promotion proposal was not recorded');
    const proposal = mapOntologyMaintainerProposalRow(proposalRow);
    const jobRow = getOntologyMaintainerJobByIdStatement.get(proposal.jobId);
    if (!jobRow) throw new Error('Ontology maintainer promotion job was not claimed');
    const job = mapOntologyMaintainerJobRow(jobRow);
    if (currentRepoHead !== proposal.repoHead || currentTargetBeforeHash !== proposal.targetBeforeHash
        || approval.proposalSha256 !== proposal.proposalSha256
        || approval.reviewPackageSha256 !== proposal.reviewPackageSha256
        || approval.candidateFingerprint !== proposal.candidateFingerprint
        || approval.repoHead !== proposal.repoHead
        || approval.targetPath !== proposal.targetPath
        || approval.targetBeforeHash !== proposal.targetBeforeHash) {
      throw new Error('Ontology maintainer promotion has stale approval bindings');
    }
    assertOntologyMaintainerJobFresh(job);
    const receiptRow = getSuccessfulOntologyMaintainerReceiptStatement.get(proposal.id);
    if (!receiptRow) throw new Error('Ontology maintainer promotion requires an attested proposal artifact receipt');
    const receipt = mapOntologyMaintainerReceiptRow(receiptRow);
    if (!verifyOntologyMaintainerArtifactReference({
      job, proposal, artifactReference: receipt.artifactReference,
      artifactReader, attestationSecret, evidenceStorePath,
    })) {
      throw new Error('Ontology maintainer promotion artifact attestation verification failed');
    }
    return { approval, proposal, job, receipt };
  }

  function prepareOntologyMaintainerPromotion(promotion) {
    const required = [
      'id', 'approvalId', 'proposalId', 'repoRoot', 'targetPath',
      'targetBeforeHash', 'targetAfterHash', 'ownerToken', 'leaseExpiresAt', 'createdAt',
    ];
    if (!promotion || typeof promotion !== 'object'
        || required.some(field => typeof promotion[field] !== 'string' || promotion[field] === '')) {
      throw new Error('Invalid ontology maintainer promotion preparation');
    }
    const prepare = db.transaction(() => {
      const existing = getOntologyMaintainerPromotionByApprovalIdStatement.get(promotion.approvalId);
      if (existing) return mapOntologyMaintainerPromotionRow(existing);
      const record = {
        id: promotion.id,
        approval_id: promotion.approvalId,
        proposal_id: promotion.proposalId,
        repo_root: promotion.repoRoot,
        target_path: promotion.targetPath,
        target_before_hash: promotion.targetBeforeHash,
        target_after_hash: promotion.targetAfterHash,
        state: 'prepared',
        reason_code: null,
        owner_token: promotion.ownerToken,
        lease_expires_at: promotion.leaseExpiresAt,
        created_at: promotion.createdAt,
        completed_at: null,
      };
      insertOntologyMaintainerPromotionStatement.run(record);
      return mapOntologyMaintainerPromotionRow(record);
    });
    return prepare();
  }

  function completeOntologyMaintainerPromotion({ approvalId, ownerToken, state, reasonCode = null, completedAt } = {}) {
    if (typeof approvalId !== 'string' || !['applied', 'recovery_required'].includes(state)
        || typeof ownerToken !== 'string' || ownerToken === '' || typeof completedAt !== 'string') {
      throw new Error('Invalid ontology maintainer promotion completion');
    }
    const existing = getOntologyMaintainerPromotionByApprovalIdStatement.get(approvalId);
    if (!existing) throw new Error('Ontology maintainer promotion was not prepared');
    if (existing.state !== 'prepared') return mapOntologyMaintainerPromotionRow(existing);
    updateOntologyMaintainerPromotionStatement.run({
      approval_id: approvalId,
      owner_token: ownerToken,
      state,
      reason_code: reasonCode,
      completed_at: completedAt,
    });
    return getOntologyMaintainerPromotionByApprovalId(approvalId);
  }

  function listOntologyMaintainerReceipts(options = {}) {
    const limit = normalizeLimit(options.limit, 50);
    const proposalId = options.proposalId || null;
    return listOntologyMaintainerReceiptsStatement.all(proposalId, proposalId, limit)
      .map(mapOntologyMaintainerReceiptRow);
  }

  function listOntologyMaintainerApprovals(options = {}) {
    const limit = normalizeLimit(options.limit, 50);
    const proposalId = options.proposalId || null;
    return listOntologyMaintainerApprovalsStatement.all(proposalId, proposalId, limit)
      .map(mapOntologyMaintainerApprovalRow);
  }

  function listOntologyMaintainerPromotions(options = {}) {
    const limit = normalizeLimit(options.limit, 50);
    const approvalId = options.approvalId || null;
    return listOntologyMaintainerPromotionsStatement.all(approvalId, approvalId, limit)
      .map(mapOntologyMaintainerPromotionRow);
  }

  function applyOntologyObservationDrain({ spoolPath, entries, checkpointOffset, drainedAt } = {}) {
    if (typeof spoolPath !== 'string' || spoolPath.trim() === '') {
      throw new Error('spoolPath must be a non-empty string');
    }
    if (!Array.isArray(entries)) {
      throw new Error('entries must be an array');
    }
    if (!Number.isSafeInteger(checkpointOffset) || checkpointOffset < 0) {
      throw new Error('checkpointOffset must be a non-negative integer');
    }

    const result = { created: 0, updated: 0, duplicates: 0, rejected: 0 };
    const apply = db.transaction(() => {
      for (const entry of entries) {
        const candidate = entry && entry.candidate;
        const observation = entry && entry.observation;
        if (!candidate || !observation || typeof observation.id !== 'string'
            || !Number.isSafeInteger(entry.lineEndOffset) || entry.lineEndOffset < 0) {
          throw new Error('Invalid ontology observation drain entry');
        }
        if (getOntologyCandidateSourceStatement.get(observation.id)) {
          result.duplicates += 1;
          continue;
        }

        let existing = getOntologyCandidateByKeyStatement.get(candidate.candidateKey);
        if (!existing) {
          insertOntologyCandidateStatement.run({
            id: candidate.id,
            candidate_key: candidate.candidateKey,
            project_key: candidate.projectKey,
            domain_key: candidate.domainKey,
            file_path: candidate.filePath,
            kind: candidate.kind,
            status: candidate.status,
            latest_content_fingerprint: candidate.latestContentFingerprint,
            first_observed_at: candidate.firstObservedAt,
            last_observed_at: candidate.lastObservedAt,
            observation_count: 1,
            created_at: candidate.createdAt,
            updated_at: candidate.updatedAt,
          });
          existing = { id: candidate.id };
          result.created += 1;
        } else {
          updateOntologyCandidateStatement.run({
            id: existing.id,
            latest_content_fingerprint: candidate.latestContentFingerprint,
            last_observed_at: candidate.lastObservedAt,
            updated_at: candidate.updatedAt,
          });
          result.updated += 1;
        }

        insertOntologyCandidateSourceStatement.run({
          observation_id: observation.id,
          candidate_id: existing.id,
          spool_path: spoolPath,
          line_end_offset: entry.lineEndOffset,
          observed_at: observation.observedAt,
        });
      }
      upsertOntologyObservationCursorStatement.run({
        spool_path: spoolPath,
        byte_offset: checkpointOffset,
        updated_at: drainedAt || new Date().toISOString(),
      });
    });
    apply();
    return result;
  }

  return {
    applyOntologyObservationDrain,
    claimOntologyMaintainerJob,
    getSessionById,
    getSessionDetail,
    getStatus,
    insertDecision(decision) {
      const normalized = normalizeDecisionInput(decision);
      assertValidEntity('decision', normalized);
      insertDecisionStatement.run({
        id: normalized.id,
        session_id: normalized.sessionId,
        title: normalized.title,
        rationale: normalized.rationale,
        alternatives: stringifyJson(normalized.alternatives, 'decision.alternatives'),
        supersedes: normalized.supersedes,
        status: normalized.status,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    insertGovernanceEvent(governanceEvent) {
      const normalized = normalizeGovernanceEventInput(governanceEvent);
      assertValidEntity('governanceEvent', normalized);
      insertGovernanceEventStatement.run({
        id: normalized.id,
        session_id: normalized.sessionId,
        event_type: normalized.eventType,
        payload: stringifyJson(normalized.payload, 'governanceEvent.payload'),
        resolved_at: normalized.resolvedAt,
        resolution: normalized.resolution,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    insertSkillRun(skillRun) {
      const normalized = normalizeSkillRunInput(skillRun);
      assertValidEntity('skillRun', normalized);
      insertSkillRunStatement.run({
        id: normalized.id,
        skill_id: normalized.skillId,
        skill_version: normalized.skillVersion,
        session_id: normalized.sessionId,
        task_description: normalized.taskDescription,
        outcome: normalized.outcome,
        failure_reason: normalized.failureReason,
        tokens_used: normalized.tokensUsed,
        duration_ms: normalized.durationMs,
        user_feedback: normalized.userFeedback,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    getOntologyObservationCursor,
    getOntologyCandidateById,
    getOntologyMaintainerApprovalById,
    getOntologyMaintainerJobById,
    getOntologyMaintainerJobByIdempotencyKey,
    getOntologyMaintainerPolicyState,
    getOntologyMaintainerProposalById,
    getOntologyMaintainerPromotionByApprovalId,
    listOntologyCandidateEvidence,
    listOntologyCandidates,
    listOntologyMaintainerAttempts,
    listOntologyMaintainerApprovals,
    listOntologyMaintainerPromotions,
    listOntologyMaintainerReceipts,
    recordOntologyMaintainerAttempt,
    recordOntologyMaintainerApproval,
    recordOntologyMaintainerJobRetryableFailure,
    recordOntologyMaintainerProposal,
    recordOntologyMaintainerProposalAndReceipt,
    recordOntologyMaintainerReceipt,
    assertOntologyMaintainerPromotionApproval,
    completeOntologyMaintainerPromotion,
    prepareOntologyMaintainerPromotion,
    listRecentSessions,
    upsertInstallState(installState) {
      const normalized = normalizeInstallStateInput(installState);
      assertValidEntity('installState', normalized);
      upsertInstallStateStatement.run({
        target_id: normalized.targetId,
        target_root: normalized.targetRoot,
        profile: normalized.profile,
        modules: stringifyJson(normalized.modules, 'installState.modules'),
        operations: stringifyJson(normalized.operations, 'installState.operations'),
        installed_at: normalized.installedAt,
        source_version: normalized.sourceVersion,
      });
      return normalized;
    },
    upsertSession(session) {
      const normalized = normalizeSessionInput(session);
      assertValidEntity('session', normalized);
      upsertSessionStatement.run({
        id: normalized.id,
        adapter_id: normalized.adapterId,
        harness: normalized.harness,
        state: normalized.state,
        repo_root: normalized.repoRoot,
        started_at: normalized.startedAt,
        ended_at: normalized.endedAt,
        snapshot: stringifyJson(normalized.snapshot, 'session.snapshot'),
      });
      return getSessionById(normalized.id);
    },
    upsertSkillVersion(skillVersion) {
      const normalized = normalizeSkillVersionInput(skillVersion);
      assertValidEntity('skillVersion', normalized);
      upsertSkillVersionStatement.run({
        skill_id: normalized.skillId,
        version: normalized.version,
        content_hash: normalized.contentHash,
        amendment_reason: normalized.amendmentReason,
        promoted_at: normalized.promotedAt,
        rolled_back_at: normalized.rolledBackAt,
      });
      const row = getSkillVersionStatement.get(normalized.skillId, normalized.version);
      return row ? mapSkillVersionRow(row) : null;
    },
  };
}

module.exports = {
  ACTIVE_SESSION_STATES,
  FAILURE_OUTCOMES,
  SUCCESS_OUTCOMES,
  createQueryApi,
};
