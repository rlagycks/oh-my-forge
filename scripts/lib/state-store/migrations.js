'use strict';

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  harness TEXT NOT NULL,
  state TEXT NOT NULL,
  repo_root TEXT,
  started_at TEXT,
  ended_at TEXT,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
);

CREATE INDEX IF NOT EXISTS idx_sessions_state_started_at
  ON sessions (state, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at
  ON sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  session_id TEXT NOT NULL,
  task_description TEXT NOT NULL,
  outcome TEXT NOT NULL,
  failure_reason TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  user_feedback TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_session_id_created_at
  ON skill_runs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_created_at
  ON skill_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_outcome_created_at
  ON skill_runs (outcome, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  amendment_reason TEXT,
  promoted_at TEXT,
  rolled_back_at TEXT,
  PRIMARY KEY (skill_id, version)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_promoted_at
  ON skill_versions (promoted_at DESC);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  alternatives TEXT NOT NULL CHECK (json_valid(alternatives)),
  supersedes TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes) REFERENCES decisions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_session_id_created_at
  ON decisions (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_status_created_at
  ON decisions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS install_state (
  target_id TEXT NOT NULL,
  target_root TEXT NOT NULL,
  profile TEXT,
  modules TEXT NOT NULL CHECK (json_valid(modules)),
  operations TEXT NOT NULL CHECK (json_valid(operations)),
  installed_at TEXT NOT NULL,
  source_version TEXT,
  PRIMARY KEY (target_id, target_root)
);

CREATE INDEX IF NOT EXISTS idx_install_state_installed_at
  ON install_state (installed_at DESC);

CREATE TABLE IF NOT EXISTS governance_events (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  resolved_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_events_resolved_at_created_at
  ON governance_events (resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_events_session_id_created_at
  ON governance_events (session_id, created_at DESC);
`;

const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_state_store',
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    version: 2,
    name: '002_ontology_update_candidates',
    sql: `
      CREATE TABLE IF NOT EXISTS ontology_update_candidates (
        id TEXT PRIMARY KEY,
        candidate_key TEXT NOT NULL UNIQUE,
        project_key TEXT NOT NULL,
        domain_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        latest_content_fingerprint TEXT NOT NULL,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        observation_count INTEGER NOT NULL CHECK (observation_count >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_candidates_review
        ON ontology_update_candidates (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ontology_candidates_project_domain
        ON ontology_update_candidates (project_key, domain_key, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ontology_candidate_sources (
        observation_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        spool_path TEXT NOT NULL,
        line_end_offset INTEGER NOT NULL CHECK (line_end_offset >= 0),
        observed_at TEXT NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES ontology_update_candidates (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_candidate_sources_candidate
        ON ontology_candidate_sources (candidate_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS ontology_observation_spool_cursors (
        spool_path TEXT PRIMARY KEY,
        byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: '003_ontology_maintainer_attempts',
    sql: `
      CREATE TABLE IF NOT EXISTS ontology_maintainer_policy_state (
        policy_id TEXT PRIMARY KEY,
        policy_version TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        manual_dry_run_enabled INTEGER NOT NULL CHECK (manual_dry_run_enabled IN (0, 1)),
        provider_enabled INTEGER NOT NULL CHECK (provider_enabled = 0),
        apply_enabled INTEGER NOT NULL CHECK (apply_enabled = 0),
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO ontology_maintainer_policy_state (
        policy_id, policy_version, enabled, manual_dry_run_enabled,
        provider_enabled, apply_enabled, updated_at
      ) VALUES (
        'ontology-maintainer-v1', '1', 1, 1, 0, 0, CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ontology_maintainer_attempts (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        policy_id TEXT NOT NULL,
        policy_version TEXT,
        requested_mode TEXT NOT NULL,
        provider_requested INTEGER NOT NULL CHECK (provider_requested IN (0, 1)),
        apply_requested INTEGER NOT NULL CHECK (apply_requested IN (0, 1)),
        decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
        reason_code TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('review_package_ready', 'denied')),
        review_package_json TEXT CHECK (review_package_json IS NULL OR json_valid(review_package_json)),
        review_package_sha256 TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_attempts_candidate_created
        ON ontology_maintainer_attempts (candidate_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_attempts_decision_created
        ON ontology_maintainer_attempts (decision, created_at DESC);
    `,
  },
  {
    version: 4,
    name: '004_ontology_maintainer_requested_candidate_id',
    sql: `
      ALTER TABLE ontology_maintainer_attempts
        ADD COLUMN requested_candidate_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_attempts_requested_candidate_created
        ON ontology_maintainer_attempts (requested_candidate_id, created_at DESC);
    `,
  },
  {
    version: 5,
    name: '005_ontology_maintainer_protocol_ledger',
    sql: `
      CREATE TABLE IF NOT EXISTS ontology_maintainer_jobs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        review_package_sha256 TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        repo_head TEXT NOT NULL,
        hop INTEGER NOT NULL CHECK (hop = 0),
        hop_limit INTEGER NOT NULL CHECK (hop_limit = 1),
        created_at TEXT NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES ontology_update_candidates (id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_jobs_candidate_created
        ON ontology_maintainer_jobs (candidate_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ontology_maintainer_proposals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        review_package_sha256 TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        repo_head TEXT NOT NULL,
        target_path TEXT NOT NULL,
        target_before_hash TEXT NOT NULL,
        intent_action TEXT NOT NULL,
        intent_subject TEXT NOT NULL,
        proposal_sha256 TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES ontology_maintainer_jobs (id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_proposals_job_created
        ON ontology_maintainer_proposals (job_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ontology_maintainer_receipts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        artifact_id TEXT,
        artifact_hash TEXT,
        artifact_persisted_at TEXT,
        artifact_signature TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES ontology_maintainer_jobs (id) ON DELETE RESTRICT,
        FOREIGN KEY (proposal_id) REFERENCES ontology_maintainer_proposals (id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_receipts_proposal_created
        ON ontology_maintainer_receipts (proposal_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ontology_maintainer_approvals (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        proposal_sha256 TEXT NOT NULL,
        review_package_sha256 TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        repo_head TEXT NOT NULL,
        target_path TEXT NOT NULL,
        target_before_hash TEXT NOT NULL,
        decision TEXT NOT NULL,
        approver_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES ontology_maintainer_proposals (id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_approvals_proposal_created
        ON ontology_maintainer_approvals (proposal_id, created_at DESC);
    `,
  },
  {
    version: 6,
    name: '006_ontology_maintainer_promotion_ledger',
    sql: `
      CREATE TABLE IF NOT EXISTS ontology_maintainer_promotions (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE,
        proposal_id TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        target_path TEXT NOT NULL,
        target_before_hash TEXT NOT NULL,
        target_after_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('prepared', 'applied', 'recovery_required')),
        reason_code TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (approval_id) REFERENCES ontology_maintainer_approvals (id) ON DELETE RESTRICT,
        FOREIGN KEY (proposal_id) REFERENCES ontology_maintainer_proposals (id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_promotions_proposal_created
        ON ontology_maintainer_promotions (proposal_id, created_at DESC);
    `,
  },
  {
    version: 7,
    name: '007_ontology_maintainer_job_retry_state',
    sql: `
      ALTER TABLE ontology_maintainer_jobs
        ADD COLUMN state TEXT NOT NULL DEFAULT 'claimed'
        CHECK (state IN ('claimed', 'retryable_failure', 'proposal_recorded'));

      ALTER TABLE ontology_maintainer_jobs
        ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1);

      ALTER TABLE ontology_maintainer_jobs
        ADD COLUMN last_reason_code TEXT;

      ALTER TABLE ontology_maintainer_jobs
        ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

      CREATE INDEX IF NOT EXISTS idx_ontology_maintainer_jobs_state_updated
        ON ontology_maintainer_jobs (state, updated_at DESC);
    `,
  },
  {
    version: 8,
    name: '008_ontology_maintainer_promotion_owner_lease',
    sql: `
      ALTER TABLE ontology_maintainer_promotions
        ADD COLUMN owner_token TEXT NOT NULL DEFAULT '';

      ALTER TABLE ontology_maintainer_promotions
        ADD COLUMN lease_expires_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
    `,
  },
];

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function getAppliedMigrations(db) {
  ensureMigrationTable(db);
  return db
    .prepare(`
      SELECT version, name, applied_at
      FROM schema_migrations
      ORDER BY version ASC
    `)
    .all()
    .map(row => ({
      version: row.version,
      name: row.name,
      appliedAt: row.applied_at,
    }));
}

function applyMigrations(db) {
  ensureMigrationTable(db);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
  );
  const insertMigration = db.prepare(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (@version, @name, @applied_at)
  `);

  const applyPending = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      db.exec(migration.sql);
      insertMigration.run({
        version: migration.version,
        name: migration.name,
        applied_at: new Date().toISOString(),
      });
    }
  });

  applyPending();
  return getAppliedMigrations(db);
}

module.exports = {
  MIGRATIONS,
  applyMigrations,
  getAppliedMigrations,
};
