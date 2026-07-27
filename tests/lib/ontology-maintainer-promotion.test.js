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
  readRepoHead,
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
  detailPath, operationDocument, expiresAt = '2099-07-27T02:00:00.000Z', approvalCreatedAt = NOW, artifactOverrides = {},
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
    ...artifactOverrides,
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
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, schemaVersion: 2 }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, proposalId: 'unbound-proposal' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, proposalId: null }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, targetPath: 'docs/README.md' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, targetPath: '' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, targetBeforeHash: 'sha1:untrusted' }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, targetBeforeHash: null }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({ ...validArtifact, operation: { type: 'shell', command: 'echo no' } }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({
    ...validArtifact,
    operation: { type: 'replace_json_document', document: ['documents must be keyed by domain'] },
  }).valid, false);
  const prototypePollutionArtifact = JSON.parse(JSON.stringify({
    ...validArtifact,
    operation: {
      type: 'replace_json_document',
      document: JSON.parse('{"domain":"domain_docs","metadata":{"__proto__":"must-not-be-accepted"}}'),
    },
  }));
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact(prototypePollutionArtifact).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({
    ...validArtifact,
    operation: { type: 'replace_json_document', document: { domain: 'domain_docs', count: Infinity } },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({
    ...validArtifact,
    operation: { type: 'replace_json_document', document: { domain: 'domain_docs', values: Array(1001).fill('x') } },
  }).valid, false);
  assert.strictEqual(validateOntologyMaintainerPromotionArtifact({
    ...validArtifact,
    operation: {
      type: 'replace_json_document',
      document: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`key_${index}`, index])),
    },
  }).valid, false);
  assert.throws(() => promoteOntologyMaintainerApproval(), /state store is unavailable/);
  assert.throws(() => promoteOntologyMaintainerApproval({
    stateStore: {
      assertOntologyMaintainerPromotionApproval() {},
      prepareOntologyMaintainerPromotion() {},
      completeOntologyMaintainerPromotion() {},
    },
    repoRoot: '',
  }), /requires a repository root/);
  assert.throws(() => promoteOntologyMaintainerApproval({
    stateStore: {
      assertOntologyMaintainerPromotionApproval() {},
      prepareOntologyMaintainerPromotion() {},
      completeOntologyMaintainerPromotion() {},
    },
    repoRoot: null,
  }), /requires a repository root/);

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

  const wrongDomainRepo = setupRepo();
  const wrongDomainPromotion = await createApprovedPromotion({
    ...wrongDomainRepo,
    operationDocument: { ...nextDocument, domain: 'domain_other' },
  });
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: wrongDomainPromotion.approval.id, stateStore: wrongDomainPromotion.store, repoRoot: wrongDomainRepo.root,
      artifactReader: () => wrongDomainPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /document does not match its registered domain/);
    assert.strictEqual(wrongDomainPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    wrongDomainPromotion.store.close();
    cleanupRepo(wrongDomainRepo);
  }

  const changedArtifactRepo = setupRepo();
  const changedArtifactPromotion = await createApprovedPromotion({ ...changedArtifactRepo, operationDocument: nextDocument });
  let artifactReadCount = 0;
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: changedArtifactPromotion.approval.id, stateStore: changedArtifactPromotion.store, repoRoot: changedArtifactRepo.root,
      artifactReader: () => {
        artifactReadCount += 1;
        return artifactReadCount === 1
          ? changedArtifactPromotion.artifact
          : Buffer.from(`${changedArtifactPromotion.artifact.toString('utf8')} `);
      },
      attestationSecret: ATTESTATION_SECRET,
    }), /artifact hash changed after attestation/);
    assert.strictEqual(artifactReadCount, 2);
    assert.strictEqual(changedArtifactPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    changedArtifactPromotion.store.close();
    cleanupRepo(changedArtifactRepo);
  }

  const lockedRepo = setupRepo();
  const lockedPromotion = await createApprovedPromotion({ ...lockedRepo, operationDocument: nextDocument });
  const lockPath = path.join(path.dirname(lockedRepo.detailPath), `.${path.basename(lockedRepo.detailPath)}.ontology-maintainer.lock`);
  try {
    fs.writeFileSync(lockPath, 'held by another guarded promotion\n', { mode: 0o600 });
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: lockedPromotion.approval.id, stateStore: lockedPromotion.store, repoRoot: lockedRepo.root,
      artifactReader: () => lockedPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /target is already locked/);
    assert.strictEqual(lockedPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    lockedPromotion.store.close();
    cleanupRepo(lockedRepo);
  }

  const rollbackRepo = setupRepo();
  const rollbackPromotion = await createApprovedPromotion({ ...rollbackRepo, operationDocument: nextDocument });
  const rollbackOriginal = fs.readFileSync(rollbackRepo.detailPath, 'utf8');
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: rollbackPromotion.approval.id, stateStore: rollbackPromotion.store, repoRoot: rollbackRepo.root,
      artifactReader: () => rollbackPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
      failureInjector: stage => { if (stage === 'after_rename') throw new Error('simulate completion outage'); },
    }), /simulate completion outage/);
    assert.strictEqual(fs.readFileSync(rollbackRepo.detailPath, 'utf8'), rollbackOriginal);
    assert.strictEqual(rollbackPromotion.store.listOntologyMaintainerPromotions({ approvalId: rollbackPromotion.approval.id })[0].state, 'recovery_required');
  } finally {
    rollbackPromotion.store.close();
    cleanupRepo(rollbackRepo);
  }

  const invalidHeadRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(invalidHeadRepo.gitDirectory, 'HEAD'), 'ref: ../outside\n', 'utf8');
    assert.throws(() => readRepoHead(invalidHeadRepo.root), /HEAD reference is invalid/);
  } finally {
    cleanupRepo(invalidHeadRepo);
  }

  const detachedHeadRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(detachedHeadRepo.gitDirectory, 'HEAD'), `${HEAD}\n`, 'utf8');
    assert.strictEqual(readRepoHead(detachedHeadRepo.root), HEAD);
  } finally {
    cleanupRepo(detachedHeadRepo);
  }

  const malformedDetachedHeadRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(malformedDetachedHeadRepo.gitDirectory, 'HEAD'), 'not-a-git-object\n', 'utf8');
    assert.throws(() => readRepoHead(malformedDetachedHeadRepo.root), /HEAD is invalid/);
  } finally {
    cleanupRepo(malformedDetachedHeadRepo);
  }

  const malformedGitFileRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(malformedGitFileRepo.root, '.git'), 'not a gitdir pointer\n', 'utf8');
    assert.throws(() => readRepoHead(malformedGitFileRepo.root), /repository metadata is invalid/);
  } finally {
    cleanupRepo(malformedGitFileRepo);
  }

  const unavailableGitDirectoryRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(unavailableGitDirectoryRepo.root, '.git'), 'gitdir: ../missing-git-directory\n', 'utf8');
    assert.throws(() => readRepoHead(unavailableGitDirectoryRepo.root), /ENOENT/);
  } finally {
    cleanupRepo(unavailableGitDirectoryRepo);
  }

  const missingPackedRefRepo = setupRepo();
  try {
    fs.unlinkSync(path.join(missingPackedRefRepo.gitDirectory, 'refs/heads/main'));
    assert.throws(() => readRepoHead(missingPackedRefRepo.root), /HEAD is invalid/);
  } finally {
    cleanupRepo(missingPackedRefRepo);
  }

  const invalidReferenceValueRepo = setupRepo();
  try {
    fs.writeFileSync(path.join(invalidReferenceValueRepo.gitDirectory, 'refs/heads/main'), 'not-a-git-object\n', 'utf8');
    assert.throws(() => readRepoHead(invalidReferenceValueRepo.root), /HEAD is invalid/);
  } finally {
    cleanupRepo(invalidReferenceValueRepo);
  }

  const directGitDirectoryRepo = setupRepo();
  try {
    fs.unlinkSync(path.join(directGitDirectoryRepo.root, '.git'));
    fs.cpSync(directGitDirectoryRepo.gitDirectory, path.join(directGitDirectoryRepo.root, '.git'), { recursive: true });
    assert.strictEqual(readRepoHead(directGitDirectoryRepo.root), HEAD);
  } finally {
    cleanupRepo(directGitDirectoryRepo);
  }

  const symlinkRootRepo = setupRepo();
  const symlinkRoot = `${symlinkRootRepo.root}-link`;
  try {
    fs.symlinkSync(symlinkRootRepo.root, symlinkRoot);
    assert.throws(() => promoteOntologyMaintainerApproval({
      stateStore: {
        assertOntologyMaintainerPromotionApproval() {},
        prepareOntologyMaintainerPromotion() {},
        completeOntologyMaintainerPromotion() {},
      },
      repoRoot: symlinkRoot,
    }), /repository root must be a real directory/);
  } finally {
    fs.unlinkSync(symlinkRoot);
    cleanupRepo(symlinkRootRepo);
  }

  const writableOntologyRepo = setupRepo();
  const writableOntologyPromotion = await createApprovedPromotion({ ...writableOntologyRepo, operationDocument: nextDocument });
  try {
    fs.chmodSync(path.join(writableOntologyRepo.root, '.claude/ontology'), 0o777);
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: writableOntologyPromotion.approval.id, stateStore: writableOntologyPromotion.store,
      repoRoot: writableOntologyRepo.root, artifactReader: () => writableOntologyPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }), /trusted private ontology directory/);
  } finally {
    writableOntologyPromotion.store.close();
    cleanupRepo(writableOntologyRepo);
  }

  const platformNeutralRepo = setupRepo();
  const platformNeutralPromotion = await createApprovedPromotion({ ...platformNeutralRepo, operationDocument: nextDocument });
  const originalGetuid = process.getuid;
  process.getuid = undefined;
  try {
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: platformNeutralPromotion.approval.id, stateStore: platformNeutralPromotion.store,
      repoRoot: platformNeutralRepo.root, artifactReader: () => platformNeutralPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }).status, 'applied');
  } finally {
    process.getuid = originalGetuid;
    platformNeutralPromotion.store.close();
    cleanupRepo(platformNeutralRepo);
  }

  const indexSymlinkRepo = setupRepo();
  const indexSymlinkPromotion = await createApprovedPromotion({ ...indexSymlinkRepo, operationDocument: nextDocument });
  const indexPath = path.join(indexSymlinkRepo.root, '.claude/ontology/index.json');
  const externalIndexPath = path.join(indexSymlinkRepo.root, 'external-index.json');
  try {
    fs.renameSync(indexPath, externalIndexPath);
    fs.symlinkSync(externalIndexPath, indexPath);
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: indexSymlinkPromotion.approval.id, stateStore: indexSymlinkPromotion.store,
      repoRoot: indexSymlinkRepo.root, artifactReader: () => indexSymlinkPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }), /index must be a real file/);
  } finally {
    indexSymlinkPromotion.store.close();
    cleanupRepo(indexSymlinkRepo);
  }

  const partialIndexRepo = setupRepo();
  const partialIndexPromotion = await createApprovedPromotion({ ...partialIndexRepo, operationDocument: nextDocument });
  try {
    const partialIndexPath = path.join(partialIndexRepo.root, '.claude/ontology/index.json');
    const partialIndex = JSON.parse(fs.readFileSync(partialIndexPath, 'utf8'));
    writeJson(partialIndexPath, { ...partialIndex, domain_without_entry: null });
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: partialIndexPromotion.approval.id, stateStore: partialIndexPromotion.store,
      repoRoot: partialIndexRepo.root, artifactReader: () => partialIndexPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }).status, 'applied');
  } finally {
    partialIndexPromotion.store.close();
    cleanupRepo(partialIndexRepo);
  }

  const bindingRaceRepo = setupRepo();
  const bindingRacePromotion = await createApprovedPromotion({ ...bindingRaceRepo, operationDocument: nextDocument });
  const originalReadFile = fs.readFileSync;
  let bindingRefReads = 0;
  fs.readFileSync = (filePath, ...args) => {
    const contents = originalReadFile(filePath, ...args);
    if (String(filePath).endsWith('/refs/heads/main')) {
      bindingRefReads += 1;
      if (bindingRefReads === 1) fs.writeFileSync(filePath, `${'f'.repeat(40)}\n`, 'utf8');
    }
    return contents;
  };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: bindingRacePromotion.approval.id, stateStore: bindingRacePromotion.store,
      repoRoot: bindingRaceRepo.root, artifactReader: () => bindingRacePromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }), /bindings changed before apply/);
    assert.strictEqual(bindingRacePromotion.store.listOntologyMaintainerPromotions({ approvalId: bindingRacePromotion.approval.id }).length, 0);
  } finally {
    fs.readFileSync = originalReadFile;
    bindingRacePromotion.store.close();
    cleanupRepo(bindingRaceRepo);
  }

  const stringArtifactRepo = setupRepo();
  const stringArtifactPromotion = await createApprovedPromotion({ ...stringArtifactRepo, operationDocument: nextDocument });
  try {
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: stringArtifactPromotion.approval.id, stateStore: stringArtifactPromotion.store, repoRoot: stringArtifactRepo.root,
      artifactReader: () => stringArtifactPromotion.artifact.toString('utf8'), attestationSecret: ATTESTATION_SECRET,
    }).status, 'applied');
  } finally {
    stringArtifactPromotion.store.close();
    cleanupRepo(stringArtifactRepo);
  }

  const postWriteMismatchRepo = setupRepo();
  const postWriteMismatchPromotion = await createApprovedPromotion({ ...postWriteMismatchRepo, operationDocument: nextDocument });
  const competingDocument = { domain: 'domain_docs', version: 'competing', source: ['docs/example.md'] };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: postWriteMismatchPromotion.approval.id, stateStore: postWriteMismatchPromotion.store, repoRoot: postWriteMismatchRepo.root,
      artifactReader: () => postWriteMismatchPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
      failureInjector: stage => { if (stage === 'after_rename') writeJson(postWriteMismatchRepo.detailPath, competingDocument); },
    }), /post-write hash verification failed/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(postWriteMismatchRepo.detailPath, 'utf8')), competingDocument);
    assert.strictEqual(postWriteMismatchPromotion.store.listOntologyMaintainerPromotions({ approvalId: postWriteMismatchPromotion.approval.id })[0].state, 'recovery_required');
  } finally {
    postWriteMismatchPromotion.store.close();
    cleanupRepo(postWriteMismatchRepo);
  }

  const completionRepo = setupRepo();
  const completionPromotion = await createApprovedPromotion({ ...completionRepo, operationDocument: nextDocument });
  const completionStore = Object.create(completionPromotion.store);
  const completePromotion = completionPromotion.store.completeOntologyMaintainerPromotion;
  completionStore.completeOntologyMaintainerPromotion = input => {
    const promotion = completePromotion(input);
    return input.state === 'applied' ? { ...promotion, state: 'recovery_required' } : promotion;
  };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: completionPromotion.approval.id, stateStore: completionStore, repoRoot: completionRepo.root,
      artifactReader: () => completionPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /completion was not applied/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(completionRepo.detailPath, 'utf8')), {
      domain: 'domain_docs', version: '1.0', source: ['docs/example.md'],
    });
  } finally {
    completionPromotion.store.close();
    cleanupRepo(completionRepo);
  }

  const mismatchedRootRepo = setupRepo();
  const mismatchedRootPromotion = await createApprovedPromotion({ ...mismatchedRootRepo, operationDocument: nextDocument });
  const mismatchedRootStore = Object.create(mismatchedRootPromotion.store);
  mismatchedRootStore.getOntologyMaintainerPromotionByApprovalId = () => ({ repoRoot: '/other/repository', state: 'prepared' });
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: mismatchedRootPromotion.approval.id, stateStore: mismatchedRootStore, repoRoot: mismatchedRootRepo.root,
      artifactReader: () => mismatchedRootPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /repository root does not match the prepared record/);
  } finally {
    mismatchedRootPromotion.store.close();
    cleanupRepo(mismatchedRootRepo);
  }

  const unboundArtifactRepo = setupRepo();
  const unboundArtifactPromotion = await createApprovedPromotion({
    ...unboundArtifactRepo, operationDocument: nextDocument, artifactOverrides: { proposalSha256: 'b'.repeat(64) },
  });
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: unboundArtifactPromotion.approval.id, stateStore: unboundArtifactPromotion.store, repoRoot: unboundArtifactRepo.root,
      artifactReader: () => unboundArtifactPromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /artifact does not bind the approved proposal/);
    assert.strictEqual(unboundArtifactPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    unboundArtifactPromotion.store.close();
    cleanupRepo(unboundArtifactRepo);
  }

  const unregisteredTargetRepo = setupRepo();
  const unregisteredTargetPromotion = await createApprovedPromotion({ ...unregisteredTargetRepo, operationDocument: nextDocument });
  try {
    writeJson(path.join(unregisteredTargetRepo.root, '.claude/ontology/index.json'), {});
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: unregisteredTargetPromotion.approval.id, stateStore: unregisteredTargetPromotion.store,
      repoRoot: unregisteredTargetRepo.root, artifactReader: () => unregisteredTargetPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }), /target is not uniquely registered in the ontology index/);
    assert.strictEqual(unregisteredTargetPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    unregisteredTargetPromotion.store.close();
    cleanupRepo(unregisteredTargetRepo);
  }

  const missingApprovalRepo = setupRepo();
  const missingApprovalStore = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: 'ontology-maintainer-approval-12345678-1234-1234-1234-123456789abc', stateStore: missingApprovalStore,
      repoRoot: missingApprovalRepo.root, artifactReader: () => Buffer.from('unused'), attestationSecret: ATTESTATION_SECRET,
    }), /approval was not recorded/);
  } finally {
    missingApprovalStore.close();
    cleanupRepo(missingApprovalRepo);
  }

  const rejectedPrepareRepo = setupRepo();
  const rejectedPreparePromotion = await createApprovedPromotion({ ...rejectedPrepareRepo, operationDocument: nextDocument });
  const rejectedPrepareStore = Object.create(rejectedPreparePromotion.store);
  const preparePromotion = rejectedPreparePromotion.store.prepareOntologyMaintainerPromotion;
  rejectedPrepareStore.prepareOntologyMaintainerPromotion = input => {
    preparePromotion(input);
    return { state: 'recovery_required', ownerToken: input.ownerToken };
  };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: rejectedPreparePromotion.approval.id, stateStore: rejectedPrepareStore, repoRoot: rejectedPrepareRepo.root,
      artifactReader: () => rejectedPreparePromotion.artifact, attestationSecret: ATTESTATION_SECRET,
    }), /prepared or recovery state/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(rejectedPrepareRepo.detailPath, 'utf8')), {
      domain: 'domain_docs', version: '1.0', source: ['docs/example.md'],
    });
  } finally {
    rejectedPreparePromotion.store.close();
    cleanupRepo(rejectedPrepareRepo);
  }

  const unavailableArtifactRepo = setupRepo();
  const unavailableArtifactPromotion = await createApprovedPromotion({ ...unavailableArtifactRepo, operationDocument: nextDocument });
  let unavailableArtifactReads = 0;
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: unavailableArtifactPromotion.approval.id, stateStore: unavailableArtifactPromotion.store,
      repoRoot: unavailableArtifactRepo.root,
      artifactReader: () => {
        unavailableArtifactReads += 1;
        return unavailableArtifactReads === 1 ? unavailableArtifactPromotion.artifact : null;
      },
      attestationSecret: ATTESTATION_SECRET,
    }), /artifact is unavailable or exceeds the size limit/);
    assert.strictEqual(unavailableArtifactPromotion.store.listOntologyMaintainerPromotions().length, 0);
  } finally {
    unavailableArtifactPromotion.store.close();
    cleanupRepo(unavailableArtifactRepo);
  }

  const recoveryStoreFailureRepo = setupRepo();
  const recoveryStoreFailurePromotion = await createApprovedPromotion({ ...recoveryStoreFailureRepo, operationDocument: nextDocument });
  const recoveryStoreFailureStore = Object.create(recoveryStoreFailurePromotion.store);
  const completeRecoveryPromotion = recoveryStoreFailurePromotion.store.completeOntologyMaintainerPromotion;
  recoveryStoreFailureStore.completeOntologyMaintainerPromotion = input => {
    if (input.state === 'recovery_required') throw new Error('simulated durable recovery outage');
    return completeRecoveryPromotion(input);
  };
  try {
    assert.throws(() => promoteOntologyMaintainerApproval({
      approvalId: recoveryStoreFailurePromotion.approval.id, stateStore: recoveryStoreFailureStore,
      repoRoot: recoveryStoreFailureRepo.root, artifactReader: () => recoveryStoreFailurePromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
      failureInjector: stage => { if (stage === 'after_rename') throw new Error('simulate original apply failure'); },
    }), /simulate original apply failure/);
    assert.strictEqual(recoveryStoreFailurePromotion.store.listOntologyMaintainerPromotions({
      approvalId: recoveryStoreFailurePromotion.approval.id,
    })[0].state, 'prepared');
  } finally {
    recoveryStoreFailurePromotion.store.close();
    cleanupRepo(recoveryStoreFailureRepo);
  }

  const directoryFsyncRepo = setupRepo();
  const directoryFsyncPromotion = await createApprovedPromotion({ ...directoryFsyncRepo, operationDocument: nextDocument });
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = descriptor => {
    if (fs.fstatSync(descriptor).isDirectory()) throw new Error('directory fsync unsupported by test filesystem');
    return originalFsync(descriptor);
  };
  try {
    assert.strictEqual(promoteOntologyMaintainerApproval({
      approvalId: directoryFsyncPromotion.approval.id, stateStore: directoryFsyncPromotion.store,
      repoRoot: directoryFsyncRepo.root, artifactReader: () => directoryFsyncPromotion.artifact,
      attestationSecret: ATTESTATION_SECRET,
    }).status, 'applied');
  } finally {
    fs.fsyncSync = originalFsync;
    directoryFsyncPromotion.store.close();
    cleanupRepo(directoryFsyncRepo);
  }
  console.log('  PASS promotes only approved, bound structured ontology JSON atomically and fails closed');
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
