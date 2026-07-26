'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createStateStore } = require('../../scripts/lib/state-store');
const { runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');
const {
  createOntologyMaintainerArtifactSignature,
} = require('../../scripts/lib/ontology-maintainer-protocol');
const { promoteOntologyMaintainerApproval } = require('../../scripts/lib/ontology-maintainer-promotion');

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'scripts', 'ontology-maintain.js');
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NOW = '2026-07-26T04:00:00.000Z';
const CANDIDATE_ID = 'ontology-candidate-1234567890abcdef12345678';
const ATTESTATION_SECRET = 'e2e-attestation-secret-at-least-32-characters';

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-ontology-maintainer-e2e-'));
  const gitDirectory = `${root}.gitdir`;
  const detailPath = path.join(root, '.claude', 'ontology', 'domain_docs.json');
  writeJson(path.join(root, '.claude', 'ontology', 'index.json'), {
    $schema: './_schema.json',
    domain_docs: { files: ['docs/example.md'], spec: 'docs/features/example.md', detail: '.claude/ontology/domain_docs.json' },
  });
  writeJson(detailPath, { domain: 'domain_docs', version: '1.0', source: ['docs/example.md'] });
  fs.mkdirSync(path.join(gitDirectory, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git'), `gitdir: ${gitDirectory}\n`, 'utf8');
  fs.writeFileSync(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  fs.writeFileSync(path.join(gitDirectory, 'refs', 'heads', 'main'), `${HEAD}\n`, 'utf8');
  return { root, gitDirectory, detailPath, dbPath: path.join(root, 'state.db'), markerPath: path.join(root, 'provider-runs') };
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  fs.rmSync(fixture.gitDirectory, { recursive: true, force: true });
}

function writeMockProvider(fixture, stdout, { delaySeconds = 0 } = {}) {
  const binaryPath = path.join(fixture.root, 'mock-provider');
  const marker = JSON.stringify(fixture.markerPath);
  const delay = delaySeconds > 0 ? `printf r >> ${marker}\nsleep ${delaySeconds}\n` : '';
  fs.writeFileSync(binaryPath, `#!/bin/sh\n${delay}printf x >> ${marker}\nprintf '%s\\n' '${stdout.replace(/'/g, "'\\\"'\\\"'")}'\n`, { mode: 0o700 });
  return binaryPath;
}

async function seedCandidate(fixture) {
  const store = await createStateStore({ dbPath: fixture.dbPath });
  try {
    store.applyOntologyObservationDrain({
      spoolPath: path.join(fixture.root, 'observations.jsonl'), checkpointOffset: 1,
      entries: [{
        lineEndOffset: 1,
        observation: { id: 'ontology-observation-1234567890abcdef12345678', observedAt: NOW },
        candidate: {
          id: CANDIDATE_ID, candidateKey: 'e2e-candidate-key', projectKey: 'e2e-project', domainKey: 'domain_docs',
          filePath: 'docs/example.md', kind: 'observed_file_change', status: 'pending_review',
          latestContentFingerprint: 'a'.repeat(64), firstObservedAt: NOW, lastObservedAt: NOW, createdAt: NOW, updatedAt: NOW,
        },
      }],
    });
  } finally {
    store.close();
  }
}

function invokeCli(fixture, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: { PATH: '/does-not-contain-provider', HOME: fixture.root },
  });
}

function invokeCliAsync(fixture, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: fixture.root,
      env: { PATH: '/does-not-contain-provider', HOME: fixture.root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(filePath)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function parseResult(result) {
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function recordApproval(fixture, proposal) {
  const store = await createStateStore({ dbPath: fixture.dbPath });
  const beforeHash = sha256(fs.readFileSync(fixture.detailPath));
  const operation = Buffer.from(JSON.stringify({
    schemaVersion: 1, type: 'ontology_maintainer_promotion_operation', proposalId: proposal.id,
    proposalSha256: proposal.proposalSha256, targetPath: proposal.targetPath, targetBeforeHash: beforeHash,
    operation: { type: 'replace_json_document', document: { domain: 'domain_docs', version: '1.1', source: ['docs/example.md'] } },
  }));
  const storedJob = store.getOntologyMaintainerJobById(proposal.jobId);
  const job = {
    schemaVersion: storedJob.schemaVersion, type: storedJob.type, id: storedJob.id, idempotencyKey: storedJob.idempotencyKey,
    provider: storedJob.provider, candidateId: storedJob.candidateId, reviewPackageSha256: storedJob.reviewPackageSha256,
    candidateFingerprint: storedJob.candidateFingerprint, repoHead: storedJob.repoHead, hop: storedJob.hop,
    hopLimit: storedJob.hopLimit, createdAt: storedJob.createdAt,
  };
  const reference = { artifactId: 'ontology-maintainer/artifacts/e2e-operation', artifactHash: sha256(operation), persistedAt: NOW };
  const artifactReference = {
    ...reference,
    signature: createOntologyMaintainerArtifactSignature({ job, proposal, artifactReference: reference, attestationSecret: ATTESTATION_SECRET }),
  };
  const receipt = store.recordOntologyMaintainerReceipt({
    schemaVersion: 1, type: 'ontology_maintainer_receipt', id: 'ontology-maintainer-receipt-12345678-1234-1234-1234-123456789abc',
    jobId: job.id, proposalId: proposal.id, provider: job.provider, outcome: 'succeeded', reasonCode: 'proposal_ready', artifactReference, createdAt: NOW,
  }, { artifactReader: () => operation, attestationSecret: ATTESTATION_SECRET });
  const approval = store.recordOntologyMaintainerApproval({
    schemaVersion: 1, type: 'ontology_maintainer_approval', id: 'ontology-maintainer-approval-12345678-1234-1234-1234-123456789abc',
    proposalId: proposal.id, proposalSha256: proposal.proposalSha256, reviewPackageSha256: proposal.reviewPackageSha256,
    candidateFingerprint: proposal.candidateFingerprint, repoHead: HEAD, targetPath: proposal.targetPath, targetBeforeHash: beforeHash,
    decision: 'approved', approverId: 'maintainer/reviewer', expiresAt: '2026-07-27T04:00:00.000Z', createdAt: NOW,
  }, { currentRepoHead: HEAD, currentTargetBeforeHash: beforeHash, now: NOW, artifactReader: () => operation, attestationSecret: ATTESTATION_SECRET });
  return { store, approval, operation, receipt };
}

async function main() {
  console.log('\nontology-maintainer-release-gate.test.js');
  const fixture = makeFixture();
  try {
    await seedCandidate(fixture);
    const beforeHash = sha256(fs.readFileSync(fixture.detailPath));
    const semantic = JSON.stringify({ targetPath: '.claude/ontology/domain_docs.json', targetBeforeHash: beforeHash, intent: { action: 'sync_domain_metadata', subject: 'domain_docs' } });
    const binaryPath = writeMockProvider(fixture, semantic);
    const base = ['propose', '--candidate', CANDIDATE_ID, '--provider', 'claude_code', '--binary', binaryPath, '--db', fixture.dbPath, '--repo', fixture.root, '--idempotency-key', 'ontology-maintainer-e2e-idempotency-1234567890abcdef'];

    const proposalResult = parseResult(invokeCli(fixture, base));
    assert.strictEqual(proposalResult.status, 'proposal_recorded', JSON.stringify(proposalResult));
    assert.strictEqual(proposalResult.proposal.provider, 'claude_code');
    assert.strictEqual(fs.readFileSync(fixture.markerPath, 'utf8'), 'x');

    const duplicate = parseResult(invokeCli(fixture, base));
    assert.strictEqual(duplicate.status, 'duplicate', JSON.stringify(duplicate));
    assert.strictEqual(fs.readFileSync(fixture.markerPath, 'utf8'), 'x');
    const crossProvider = parseResult(invokeCli(fixture, base.map(value => value === 'claude_code' ? 'codex_cli' : value)));
    assert.deepStrictEqual(crossProvider, { status: 'denied', reasonCode: 'idempotency_binding_invalid' });
    assert.strictEqual(fs.readFileSync(fixture.markerPath, 'utf8'), 'x');
    const relativeRepoArgs = base.map(value => value === fixture.root ? '.' : value)
      .map(value => value === 'ontology-maintainer-e2e-idempotency-1234567890abcdef' ? 'ontology-maintainer-e2e-relative-repo-123456' : value);
    const relativeDbArgs = base.map(value => value === fixture.dbPath ? 'state.db' : value)
      .map(value => value === 'ontology-maintainer-e2e-idempotency-1234567890abcdef' ? 'ontology-maintainer-e2e-relative-db-123456' : value);
    assert.strictEqual(invokeCli(fixture, relativeRepoArgs).status, 1);
    assert.strictEqual(invokeCli(fixture, relativeDbArgs).status, 1);

    const concurrentFixture = makeFixture();
    try {
      await seedCandidate(concurrentFixture);
      const concurrentBinary = writeMockProvider(concurrentFixture, semantic, { delaySeconds: 1 });
      const concurrentArgs = ['propose', '--candidate', CANDIDATE_ID, '--provider', 'claude_code', '--binary', concurrentBinary, '--db', concurrentFixture.dbPath, '--repo', concurrentFixture.root, '--idempotency-key', 'ontology-maintainer-e2e-concurrent-1234567890abcdef'];
      const first = invokeCliAsync(concurrentFixture, concurrentArgs);
      await waitForFile(concurrentFixture.markerPath);
      const second = await invokeCliAsync(concurrentFixture, concurrentArgs);
      const firstResult = await first;
      assert.strictEqual(JSON.parse(firstResult.stdout).status, 'proposal_recorded', firstResult.stderr);
      assert.deepStrictEqual(JSON.parse(second.stdout), { status: 'denied', reasonCode: 'workflow_locked' });
      assert.strictEqual(fs.readFileSync(concurrentFixture.markerPath, 'utf8'), 'rx');
    } finally {
      cleanup(concurrentFixture);
    }

    const approvalState = await recordApproval(fixture, proposalResult.proposal);
    try {
      const applied = promoteOntologyMaintainerApproval({
        approvalId: approvalState.approval.id, stateStore: approvalState.store, repoRoot: fixture.root,
        artifactReader: () => approvalState.operation, attestationSecret: ATTESTATION_SECRET, now: NOW,
      });
      assert.strictEqual(applied.status, 'applied');
      assert.strictEqual(JSON.parse(fs.readFileSync(fixture.detailPath, 'utf8')).version, '1.1');
      assert.strictEqual(promoteOntologyMaintainerApproval({
        approvalId: approvalState.approval.id, stateStore: approvalState.store, repoRoot: fixture.root,
        artifactReader: () => approvalState.operation, attestationSecret: ATTESTATION_SECRET, now: NOW,
      }).status, 'already_applied');
    } finally {
      approvalState.store.close();
    }

    const invalidFixture = makeFixture();
    try {
      await seedCandidate(invalidFixture);
      const invalidBinary = writeMockProvider(invalidFixture, JSON.stringify({ patch: 'not allowed' }));
      const invalid = invokeCli(invalidFixture, ['propose', '--candidate', CANDIDATE_ID, '--provider', 'codex_cli', '--binary', invalidBinary, '--db', invalidFixture.dbPath, '--repo', invalidFixture.root, '--idempotency-key', 'ontology-maintainer-e2e-invalid-1234567890abcdef']);
      assert.strictEqual(invalid.status, 0, invalid.stderr);
      assert.strictEqual(JSON.parse(invalid.stdout).reasonCode, 'provider_output_invalid');
      assert.strictEqual(fs.readFileSync(invalidFixture.markerPath, 'utf8'), 'x');
      const automatic = invokeCli(invalidFixture, ['propose', '--candidate', CANDIDATE_ID, '--provider', 'auto', '--binary', invalidBinary, '--db', invalidFixture.dbPath, '--repo', invalidFixture.root, '--idempotency-key', 'ontology-maintainer-e2e-auto-1234567890abcdef']);
      assert.strictEqual(JSON.parse(automatic.stdout).reasonCode, 'job_invalid');
      assert.strictEqual(invokeCli(invalidFixture, ['propose', '--candidate', CANDIDATE_ID, '--provider', 'claude_code', '--binary', '/missing/mock', '--db', invalidFixture.dbPath, '--repo', invalidFixture.root, '--idempotency-key', 'ontology-maintainer-e2e-missing-1234567890abcdef']).status, 0);
      const maxed = invokeCli(invalidFixture, ['propose', '--candidate', CANDIDATE_ID, '--provider', 'claude_code', '--binary', invalidBinary, '--db', invalidFixture.dbPath, '--repo', invalidFixture.root, '--idempotency-key', 'ontology-maintainer-e2e-hop-1234567890abcdef', '--hop', '1', '--hop-limit', '1']);
      assert.strictEqual(maxed.status, 1, maxed.stderr);
    } finally {
      cleanup(invalidFixture);
    }

    const recoveryFixture = makeFixture();
    try {
      await seedCandidate(recoveryFixture);
      const reviewStore = await createStateStore({ dbPath: recoveryFixture.dbPath });
      runOntologyMaintainerDryRun({ candidateId: CANDIDATE_ID, stateStore: reviewStore, now: NOW });
      const reviewHash = reviewStore.listOntologyMaintainerAttempts({ candidateId: CANDIDATE_ID })[0].reviewPackageSha256;
      const job = { schemaVersion: 1, type: 'ontology_maintainer_job', id: 'ontology-maintainer-job-87654321-4321-4321-4321-cba987654321', idempotencyKey: 'ontology-maintainer-e2e-recovery-1234567890abcdef', provider: 'claude_code', candidateId: CANDIDATE_ID, reviewPackageSha256: reviewHash, candidateFingerprint: 'a'.repeat(64), repoHead: HEAD, hop: 0, hopLimit: 1, createdAt: NOW };
      reviewStore.claimOntologyMaintainerJob(job);
      const proposal = { id: 'ontology-maintainer-proposal-87654321-4321-4321-4321-cba987654321', jobId: job.id, provider: job.provider, reviewPackageSha256: job.reviewPackageSha256, candidateFingerprint: job.candidateFingerprint, repoHead: HEAD, targetPath: '.claude/ontology/domain_docs.json', targetBeforeHash: sha256(fs.readFileSync(recoveryFixture.detailPath)), intent: { action: 'sync_domain_metadata', subject: 'domain_docs' }, createdAt: NOW };
      const { createOntologyMaintainerProposal } = require('../../scripts/lib/ontology-maintainer-protocol');
      const normalizedProposal = createOntologyMaintainerProposal(proposal);
      reviewStore.recordOntologyMaintainerProposal(normalizedProposal, { currentRepoHead: HEAD });
      const record = await recordApproval(recoveryFixture, normalizedProposal);
      reviewStore.close();
      try {
        assert.throws(() => promoteOntologyMaintainerApproval({ approvalId: record.approval.id, stateStore: record.store, repoRoot: recoveryFixture.root, artifactReader: () => record.operation, attestationSecret: ATTESTATION_SECRET, now: NOW, failureInjector: stage => { if (stage === 'before_rename') throw new Error('forced recovery'); } }), /forced recovery/);
        assert.strictEqual(record.store.getOntologyMaintainerPromotionByApprovalId(record.approval.id).state, 'recovery_required');
      } finally { record.store.close(); }
    } finally { cleanup(recoveryFixture); }

    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const hookCommands = Object.values(hooks.hooks).flatMap(entries => entries.flatMap(entry => entry.hooks.map(hook => hook.command)));
    assert.ok(hookCommands.every(command => !/ontology-maintain\.js|ontology-maintainer-(runtime|providers)|(?:^|\\s)(claude|codex)\s+(?:--print|exec)/.test(command)));
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'release.sh'), 'utf8'), /npm run release:ontology-maintainer/);
    console.log('  PASS runs only explicit mock providers, preserves hook boundaries, and gates approved isolated promotion');
  } finally {
    cleanup(fixture);
  }
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
