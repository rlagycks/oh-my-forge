'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateStore } = require('../../scripts/lib/state-store');
const { runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');
const {
  createOntologyMaintainerArtifactSignature,
  createOntologyMaintainerProposal,
} = require('../../scripts/lib/ontology-maintainer-protocol');
const {
  promoteOntologyMaintainerApproval,
  validateOntologyMaintainerPromotionArtifact,
} = require('../../scripts/lib/ontology-maintainer-promotion');

const NOW = '2026-07-26T02:00:00.000Z';
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const CANDIDATE_ID = 'ontology-candidate-1234567890abcdef12345678';
const ATTESTATION_SECRET = 'promotion-test-attestation-secret-at-least-32-characters';

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-ontology-promotion-'));
  const gitDirectory = `${root}.gitdir`;
  writeJson(path.join(root, '.claude/ontology/index.json'), {
    $schema: './_schema.json',
    domain_docs: {
      files: ['docs/example.md'], spec: 'docs/features/example.md', codexWorkerHint: 'workspace-write',
      detail: '.claude/ontology/domain_docs.json',
    },
  });
  const detailPath = path.join(root, '.claude/ontology/domain_docs.json');
  writeJson(detailPath, { domain: 'domain_docs', version: '1.0', source: ['docs/example.md'] });
  fs.mkdirSync(path.join(gitDirectory, 'refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git'), `gitdir: ${gitDirectory}\n`, 'utf8');
  fs.writeFileSync(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  fs.writeFileSync(path.join(gitDirectory, 'refs/heads/main'), `${HEAD}\n`, 'utf8');
  return { root, gitDirectory, detailPath };
}

function cleanupRepo(repo) {
  fs.rmSync(repo.root, { recursive: true, force: true });
  fs.rmSync(repo.gitDirectory, { recursive: true, force: true });
}

function candidate() {
  return {
    id: CANDIDATE_ID, candidateKey: 'promotion-candidate-key', projectKey: 'project-key',
    domainKey: 'domain_docs', filePath: 'docs/example.md', kind: 'observed_file_change', status: 'pending_review',
    latestContentFingerprint: 'a'.repeat(64), firstObservedAt: NOW, lastObservedAt: NOW,
    createdAt: NOW, updatedAt: NOW,
  };
}

async function createApprovedPromotion({
  detailPath, operationDocument, expiresAt = '2026-07-27T02:00:00.000Z', approvalCreatedAt = NOW,
}) {
  const store = await createStateStore({ dbPath: ':memory:' });
  const beforeHash = sha256(fs.readFileSync(detailPath));
  store.applyOntologyObservationDrain({
    spoolPath: '/tmp/ontology-promotion-test.jsonl', checkpointOffset: 1,
    entries: [{
      lineEndOffset: 1,
      observation: { id: 'ontology-observation-1234567890abcdef12345678', observedAt: NOW },
      candidate: candidate(),
    }],
  });
  runOntologyMaintainerDryRun({ candidateId: CANDIDATE_ID, stateStore: store, now: NOW });
  const reviewPackageSha256 = store.listOntologyMaintainerAttempts({ candidateId: CANDIDATE_ID })[0].reviewPackageSha256;
  const job = {
    schemaVersion: 1, type: 'ontology_maintainer_job',
    id: 'ontology-maintainer-job-12345678-1234-1234-1234-123456789abc',
    idempotencyKey: 'ontology-maintainer-promotion-idempotency-1234567890abcdef',
    provider: 'claude_code', candidateId: CANDIDATE_ID, reviewPackageSha256,
    candidateFingerprint: 'a'.repeat(64), repoHead: HEAD, hop: 0, hopLimit: 1, createdAt: NOW,
  };
  store.claimOntologyMaintainerJob(job);
  const proposal = createOntologyMaintainerProposal({
    id: 'ontology-maintainer-proposal-12345678-1234-1234-1234-123456789abc',
    jobId: job.id, provider: job.provider, reviewPackageSha256, candidateFingerprint: job.candidateFingerprint,
    repoHead: HEAD, targetPath: '.claude/ontology/domain_docs.json', targetBeforeHash: beforeHash,
    intent: { action: 'sync_domain_metadata', subject: 'domain_docs' }, createdAt: NOW,
  });
  store.recordOntologyMaintainerProposal(proposal, { currentRepoHead: HEAD });
  const artifact = Buffer.from(JSON.stringify({
    schemaVersion: 1, type: 'ontology_maintainer_promotion_operation',
    proposalId: proposal.id, proposalSha256: proposal.proposalSha256,
    targetPath: proposal.targetPath, targetBeforeHash: beforeHash,
    operation: { type: 'replace_json_document', document: operationDocument },
  }));
  const reference = {
    artifactId: 'ontology-maintainer/artifacts/promotion-123', artifactHash: sha256(artifact), persistedAt: NOW,
  };
  const artifactReference = {
    ...reference,
    signature: createOntologyMaintainerArtifactSignature({ job, proposal, artifactReference: reference, attestationSecret: ATTESTATION_SECRET }),
  };
  store.recordOntologyMaintainerReceipt({
    schemaVersion: 1, type: 'ontology_maintainer_receipt',
    id: 'ontology-maintainer-receipt-12345678-1234-1234-1234-123456789abc',
    jobId: job.id, proposalId: proposal.id, provider: job.provider, outcome: 'succeeded', reasonCode: 'proposal_ready',
    artifactReference, createdAt: NOW,
  }, { artifactReader: () => artifact, attestationSecret: ATTESTATION_SECRET });
  const approval = {
    schemaVersion: 1, type: 'ontology_maintainer_approval',
    id: 'ontology-maintainer-approval-12345678-1234-1234-1234-123456789abc',
    proposalId: proposal.id, proposalSha256: proposal.proposalSha256, reviewPackageSha256,
    candidateFingerprint: job.candidateFingerprint, repoHead: HEAD, targetPath: proposal.targetPath,
    targetBeforeHash: beforeHash, decision: 'approved', approverId: 'maintainer/reviewer', expiresAt, createdAt: approvalCreatedAt,
  };
  store.recordOntologyMaintainerApproval(approval, {
    currentRepoHead: HEAD, currentTargetBeforeHash: beforeHash, now: approvalCreatedAt,
    artifactReader: () => artifact, attestationSecret: ATTESTATION_SECRET,
  });
  return { store, approval, artifact, artifactId: 'ontology-maintainer/artifacts/promotion-123' };
}

async function main() {
  console.log('\nontology-maintainer-promotion.test.js');
  const repo = setupRepo();
  const nextDocument = { domain: 'domain_docs', version: '1.1', source: ['docs/example.md'], summary: 'approved update' };
  const validArtifact = {
    schemaVersion: 1, type: 'ontology_maintainer_promotion_operation',
    proposalId: 'ontology-maintainer-proposal-12345678-1234-1234-1234-123456789abc', proposalSha256: 'a'.repeat(64),
    targetPath: '.claude/ontology/domain_docs.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
    operation: { type: 'replace_json_document', document: nextDocument },
  };
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact(validArtifact).valid, true);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, command: 'rm -rf .' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, targetPath: 'docs/README.md' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, operation: { type: 'shell', command: 'echo no' } }).valid, false);

  const approved = await createApprovedPromotion({ ...repo, operationDocument: nextDocument });
  try {
    const result = promoteOntologyMaintainerApproval({
      approvalId: approved.approval.id, stateStore: approved.store, repoRoot: repo.root,
      artifactReader: () => approved.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
    });
    assert.strictEqual(result.status, 'applied');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(repo.detailPath, 'utf8')), nextDocument);
    assert.strictEqual(approved.store.listOntologyMaintainerPromotions({ approvalId: approved.approval.id })[0].state, 'applied');
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: approved.approval.id, stateStore: approved.store, repoRoot: repo.root,
      attestationSecret: ATTESTATION_SECRET,
    }).status, 'already_applied');
  } finally {
    approved.store.close();
  }

  const recoveringRepo = setupRepo();
  const recovering = await createApprovedPromotion({ ...recoveringRepo, operationDocument: nextDocument });
  const original = fs.readFileSync(recoveringRepo.detailPath, 'utf8');
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: recovering.approval.id, stateStore: recovering.store, repoRoot: recoveringRepo.root,
      artifactReader: () => recovering.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
      failureInjector: stage => { if (stage === 'before_rename') throw new Error('simulated write failure'); },
    }), /simulated write failure/);
    assert.strictEqual(fs.readFileSync(recoveringRepo.detailPath, 'utf8'), original);
    assert.strictEqual(recovering.store.listOntologyMaintainerPromotions({ approvalId: recovering.approval.id })[0].state, 'recovery_required');
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: recovering.approval.id, stateStore: recovering.store, repoRoot: recoveringRepo.root,
      artifactReader: () => recovering.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
    }), /prepared or recovery state/);
  } finally {
    recovering.store.close();
    cleanupRepo(recoveringRepo);
    cleanupRepo(repo);
  }

  const symlinkRepo = setupRepo();
  const symlinkPromotion = await createApprovedPromotion({ ...symlinkRepo, operationDocument: nextDocument });
  const externalDetailPath = path.join(symlinkRepo.root, 'external-domain-docs.json');
  try {
    fs.renameSync(symlinkRepo.detailPath, externalDetailPath);
    fs.symlinkSync(externalDetailPath, symlinkRepo.detailPath);
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: symlinkPromotion.approval.id, stateStore: symlinkPromotion.store, repoRoot: symlinkRepo.root,
      artifactReader: () => symlinkPromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
    }), /real file/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(externalDetailPath, 'utf8')), {
      domain: 'domain_docs', version: '1.0', source: ['docs/example.md'],
    });
    assert.strictEqual(symlinkPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    symlinkPromotion.store.close();
    cleanupRepo(symlinkRepo);
  }

  const parentSymlinkRepo = setupRepo();
  const parentSymlinkPromotion = await createApprovedPromotion({ ...parentSymlinkRepo, operationDocument: nextDocument });
  const realClaudeDirectory = path.join(parentSymlinkRepo.root, '.claude-real');
  try {
    fs.renameSync(path.join(parentSymlinkRepo.root, '.claude'), realClaudeDirectory);
    fs.symlinkSync(realClaudeDirectory, path.join(parentSymlinkRepo.root, '.claude'));
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: parentSymlinkPromotion.approval.id, stateStore: parentSymlinkPromotion.store, repoRoot: parentSymlinkRepo.root,
      artifactReader: () => parentSymlinkPromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
    }), /trusted private \.claude directory/);
    assert.strictEqual(parentSymlinkPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    parentSymlinkPromotion.store.close();
    cleanupRepo(parentSymlinkRepo);
  }

  const mainCheckoutRepo = setupRepo();
  const mainCheckoutPromotion = await createApprovedPromotion({ ...mainCheckoutRepo, operationDocument: nextDocument });
  try {
    fs.unlinkSync(path.join(mainCheckoutRepo.root, '.git'));
    fs.mkdirSync(path.join(mainCheckoutRepo.root, '.git'));
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: mainCheckoutPromotion.approval.id, stateStore: mainCheckoutPromotion.store, repoRoot: mainCheckoutRepo.root,
      artifactReader: () => mainCheckoutPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /isolated Git worktree/);
    assert.strictEqual(mainCheckoutPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    mainCheckoutPromotion.store.close();
    cleanupRepo(mainCheckoutRepo);
  }

  const expiredRepo = setupRepo();
  const expiredPromotion = await createApprovedPromotion({
    ...expiredRepo, operationDocument: nextDocument,
    approvalCreatedAt: '2026-07-24T02:00:00.000Z', expiresAt: '2026-07-25T02:00:00.000Z',
  });
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: expiredPromotion.approval.id, stateStore: expiredPromotion.store, repoRoot: expiredRepo.root,
      artifactReader: () => expiredPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
      now: '2026-07-24T02:30:00.000Z',
    }), /approval is expired/);
    assert.strictEqual(expiredPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    expiredPromotion.store.close();
    cleanupRepo(expiredRepo);
  }

  const concurrentRepo = setupRepo();
  const concurrentPromotion = await createApprovedPromotion({ ...concurrentRepo, operationDocument: nextDocument });
  try {
    const concurrentResult = promoteOntologyMaintainerApproval({
      approvalId: concurrentPromotion.approval.id, stateStore: concurrentPromotion.store, repoRoot: concurrentRepo.root,
      artifactReader: () => concurrentPromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
      failureInjector: stage => {
        if (stage === 'before_rename') {
          assert.throws(() => promoteOntologyMaintainerApproval({
            approvalId: concurrentPromotion.approval.id, stateStore: concurrentPromotion.store, repoRoot: concurrentRepo.root,
            artifactReader: () => concurrentPromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
          }), /prepared or recovery state/);
        }
      },
    });
    assert.strictEqual(concurrentResult.status, 'applied');
    assert.strictEqual(concurrentPromotion.store.listOntologyMaintainerPromotions({ approvalId: concurrentPromotion.approval.id }).length, 1);
  } finally {
    concurrentPromotion.store.close();
    cleanupRepo(concurrentRepo);
  }

  const raceRepo = setupRepo();
  const racePromotion = await createApprovedPromotion({ ...raceRepo, operationDocument: nextDocument });
  const externalWriterDocument = { domain: 'domain_docs', version: 'external', source: ['docs/example.md'] };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: racePromotion.approval.id, stateStore: racePromotion.store, repoRoot: raceRepo.root,
      artifactReader: () => racePromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
      failureInjector: stage => {
        if (stage === 'after_rename') {
          writeJson(raceRepo.detailPath, externalWriterDocument);
          throw new Error('simulated post-rename failure');
        }
      },
    }), /simulated post-rename failure/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(raceRepo.detailPath, 'utf8')), externalWriterDocument);
    assert.strictEqual(racePromotion.store.listOntologyMaintainerPromotions({ approvalId: racePromotion.approval.id })[0].state, 'recovery_required');
  } finally {
    racePromotion.store.close();
    cleanupRepo(raceRepo);
  }

  const evidenceStoreRepo = setupRepo();
  const evidenceStorePromotion = await createApprovedPromotion({ ...evidenceStoreRepo, operationDocument: nextDocument });
  const evidenceStore = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-ontology-evidence-'));
  try {
    const artifactKey = crypto.createHash('sha256').update(evidenceStorePromotion.artifactId, 'utf8').digest('hex');
    fs.mkdirSync(path.join(evidenceStore, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(evidenceStore, 'artifacts', artifactKey), evidenceStorePromotion.artifact);
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: evidenceStorePromotion.approval.id, stateStore: evidenceStorePromotion.store, repoRoot: evidenceStoreRepo.root,
      evidenceStorePath: evidenceStore, attestationSecret: ATTESTATION_SECRET, now: NOW,
    }).status, 'applied');
  } finally {
    evidenceStorePromotion.store.close();
    cleanupRepo(evidenceStoreRepo);
    fs.rmSync(evidenceStore, { recursive: true, force: true });
  }

  const packedRefsRepo = setupRepo();
  const packedRefsPromotion = await createApprovedPromotion({ ...packedRefsRepo, operationDocument: nextDocument });
  try {
    fs.unlinkSync(path.join(packedRefsRepo.gitDirectory, 'refs/heads/main'));
    fs.writeFileSync(path.join(packedRefsRepo.gitDirectory, 'packed-refs'), `# pack-refs with: peeled fully-peeled\n${HEAD} refs/heads/main\n`);
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: packedRefsPromotion.approval.id, stateStore: packedRefsPromotion.store, repoRoot: packedRefsRepo.root,
      artifactReader: () => packedRefsPromotion.artifact, attestationSecret: ATTESTATION_SECRET, now: NOW,
    }).status, 'applied');
  } finally {
    packedRefsPromotion.store.close();
    cleanupRepo(packedRefsRepo);
  }
  console.log('  PASS promotes only approved, bound structured ontology JSON atomically and fails closed');
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
