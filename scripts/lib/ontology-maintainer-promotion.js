'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createEvidenceStoreArtifactReader } = require('./ontology-maintainer-protocol');

const PROMOTION_ARTIFACT_SCHEMA_VERSION = 1;
const MAX_PROMOTION_ARTIFACT_BYTES = 2 * 1024 * 1024;
const PROMOTION_OPERATION_TYPE = 'replace_json_document';
const PROMOTION_ARTIFACT_TYPE = 'ontology_maintainer_promotion_operation';
const TARGET_PATH = /^\.claude\/ontology\/domain_[a-z][a-z0-9_]*\.json$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PROPOSAL_ID = /^ontology-maintainer-proposal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isSafeJsonValue(value, depth = 0) {
  if (depth > 32 || value === null || typeof value === 'string' || typeof value === 'boolean') return depth <= 32;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => isSafeJsonValue(item, depth + 1));
  if (!isPlainObject(value) || Object.keys(value).length > 1000) return false;
  return Object.entries(value).every(([key, item]) => (
    typeof key === 'string' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
      && isSafeJsonValue(item, depth + 1)
  ));
}

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function validateOntologyMaintainerPromotionArtifact(artifact) {
  const errors = [];
  const artifactKeys = ['schemaVersion', 'type', 'proposalId', 'proposalSha256', 'targetPath', 'targetBeforeHash', 'operation'];
  if (!hasExactKeys(artifact, artifactKeys)) {
    return { valid: false, errors: ['promotion artifact has unknown or missing fields'] };
  }
  if (artifact.schemaVersion !== PROMOTION_ARTIFACT_SCHEMA_VERSION || artifact.type !== PROMOTION_ARTIFACT_TYPE) {
    errors.push('promotion artifact schema is invalid');
  }
  if (!PROPOSAL_ID.test(artifact.proposalId || '') || !/^[a-f0-9]{64}$/.test(artifact.proposalSha256 || '')) {
    errors.push('promotion artifact proposal binding is invalid');
  }
  if (!TARGET_PATH.test(artifact.targetPath || '') || !SHA256.test(artifact.targetBeforeHash || '')) {
    errors.push('promotion artifact target binding is invalid');
  }
  if (!hasExactKeys(artifact.operation, ['type', 'document'])
      || artifact.operation.type !== PROMOTION_OPERATION_TYPE
      || !isPlainObject(artifact.operation.document)
      || !isSafeJsonValue(artifact.operation.document)) {
    errors.push('promotion artifact must contain one structured JSON replacement operation');
  }
  return { valid: errors.length === 0, errors };
}

function assertValidOntologyMaintainerPromotionArtifact(artifact) {
  const result = validateOntologyMaintainerPromotionArtifact(artifact);
  if (!result.valid) throw new Error(`Invalid ontology maintainer promotion artifact: ${result.errors.join('; ')}`);
  return artifact;
}

function resolveRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error('Ontology maintainer promotion requires a repository root');
  }
  const resolved = path.resolve(repoRoot);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Ontology maintainer promotion repository root must be a real directory');
  }
  return fs.realpathSync(resolved);
}

function assertTrustedPromotionWorktree(repoRoot) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dotGit = path.join(repoRoot, '.git');
  const gitStats = fs.lstatSync(dotGit);
  if (!gitStats.isFile() || gitStats.isSymbolicLink()) {
    throw new Error('Ontology maintainer promotion requires an isolated Git worktree');
  }
  for (const [label, directory] of [
    ['repository root', repoRoot],
    ['.claude directory', path.join(repoRoot, '.claude')],
    ['ontology directory', path.join(repoRoot, '.claude', 'ontology')],
  ]) {
    const stats = fs.lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()
        || (uid !== null && stats.uid !== uid) || (stats.mode & 0o022) !== 0) {
      throw new Error(`Ontology maintainer promotion requires a trusted private ${label}`);
    }
  }
}

function resolveGitDirectory(repoRoot) {
  const dotGit = path.join(repoRoot, '.git');
  const stats = fs.lstatSync(dotGit);
  if (stats.isDirectory() && !stats.isSymbolicLink()) return dotGit;
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Ontology maintainer promotion repository metadata is invalid');
  const match = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  if (!match) throw new Error('Ontology maintainer promotion repository metadata is invalid');
  const gitDirectory = path.resolve(repoRoot, match[1]);
  if (!fs.statSync(gitDirectory).isDirectory()) throw new Error('Ontology maintainer promotion git directory is unavailable');
  return fs.realpathSync(gitDirectory);
}

function readPackedReference(gitDirectory, referenceName) {
  const packedRefsPath = path.join(gitDirectory, 'packed-refs');
  if (!fs.existsSync(packedRefsPath)) return null;
  const packedRefs = fs.readFileSync(packedRefsPath, 'utf8').split('\n');
  for (const line of packedRefs) {
    if (line === '' || line.startsWith('#') || line.startsWith('^')) continue;
    const match = /^([a-f0-9]{40}(?:[a-f0-9]{24})?)\s+(.+)$/.exec(line);
    if (match && match[2] === referenceName) return match[1];
  }
  return null;
}

function readRepoHead(repoRoot) {
  const gitDirectory = resolveGitDirectory(repoRoot);
  const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
  const reference = /^ref:\s+(.+)$/.exec(head);
  if (!reference) {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) throw new Error('Ontology maintainer repository HEAD is invalid');
    return head;
  }
  const referenceName = reference[1];
  if (!/^refs\/[A-Za-z0-9._/-]+$/.test(referenceName) || referenceName.includes('..')) {
    throw new Error('Ontology maintainer repository HEAD reference is invalid');
  }
  const refPath = path.resolve(gitDirectory, referenceName);
  if (!refPath.startsWith(`${gitDirectory}${path.sep}`)) throw new Error('Ontology maintainer repository HEAD reference is unavailable');
  const value = fs.existsSync(refPath)
    ? fs.readFileSync(refPath, 'utf8').trim()
    : readPackedReference(gitDirectory, referenceName);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) throw new Error('Ontology maintainer repository HEAD is invalid');
  return value;
}

function resolveCanonicalTarget(repoRoot, targetPath) {
  if (!TARGET_PATH.test(targetPath || '')) throw new Error('Ontology maintainer promotion target is not a canonical domain detail file');
  const claudeDirectory = path.join(repoRoot, '.claude');
  const ontologyDirectory = path.join(repoRoot, '.claude', 'ontology');
  const target = path.resolve(repoRoot, targetPath);
  if (!target.startsWith(`${ontologyDirectory}${path.sep}`)) throw new Error('Ontology maintainer promotion target escapes ontology directory');
  for (const directory of [claudeDirectory, ontologyDirectory]) {
    const directoryStats = fs.lstatSync(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('Ontology maintainer promotion ontology directory must be real');
    }
  }
  const realOntologyDirectory = fs.realpathSync(ontologyDirectory);
  if (!realOntologyDirectory.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error('Ontology maintainer promotion ontology directory escapes repository root');
  }
  const targetStats = fs.lstatSync(target);
  if (!targetStats.isFile() || targetStats.isSymbolicLink()) throw new Error('Ontology maintainer promotion target must be a real file');
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(`${realOntologyDirectory}${path.sep}`)) {
    throw new Error('Ontology maintainer promotion target escapes ontology directory');
  }
  const indexPath = path.join(ontologyDirectory, 'index.json');
  const indexStats = fs.lstatSync(indexPath);
  if (!indexStats.isFile() || indexStats.isSymbolicLink()) throw new Error('Ontology maintainer promotion index must be a real file');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const matchingDomains = Object.entries(index)
    .filter(([domain, entry]) => domain.startsWith('domain_') && entry && entry.detail === targetPath);
  if (matchingDomains.length !== 1) throw new Error('Ontology maintainer promotion target is not uniquely registered in the ontology index');
  return { target: realTarget, domainKey: matchingDomains[0][0] };
}

function assertTargetBindings({ repoRoot, targetPath, target, beforeHash, repoHead }) {
  assertTrustedPromotionWorktree(repoRoot);
  const canonical = resolveCanonicalTarget(repoRoot, targetPath);
  if (canonical.target !== target || sha256(fs.readFileSync(canonical.target)) !== beforeHash || readRepoHead(repoRoot) !== repoHead) {
    throw new Error('Ontology maintainer promotion bindings changed before apply');
  }
  return canonical;
}

function validateOntologyDocument({ document, domainKey }) {
  if (!isPlainObject(document) || !isSafeJsonValue(document)) {
    throw new Error('Ontology maintainer promotion document is not safe JSON');
  }
  if (document.domain !== domainKey) {
    throw new Error('Ontology maintainer promotion document does not match its registered domain');
  }
  JSON.stringify(document);
}

function parsePromotionArtifact(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PROMOTION_ARTIFACT_BYTES) {
    throw new Error('Ontology maintainer promotion artifact is unavailable or exceeds the size limit');
  }
  let artifact;
  try {
    artifact = JSON.parse(buffer.toString('utf8'));
  } catch (_error) {
    throw new Error('Ontology maintainer promotion artifact is not valid JSON');
  }
  return assertValidOntologyMaintainerPromotionArtifact(artifact);
}

function atomicReplace(targetPath, contents, failureInjector) {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (typeof failureInjector === 'function') failureInjector('before_rename');
    fs.renameSync(temporaryPath, targetPath);
    try {
      const directoryDescriptor = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryDescriptor);
      fs.closeSync(directoryDescriptor);
    } catch (_error) {
      // Directory fsync is unavailable on some supported platforms; rename remains atomic.
    }
  } finally {
    if (descriptor !== undefined && descriptor !== null) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function acquirePromotionTargetLock(targetPath) {
  const lockPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.ontology-maintainer.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, 'ontology-maintainer-promotion-lock\n', 'utf8');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error && error.code === 'EEXIST') throw new Error('Ontology maintainer promotion target is already locked');
    throw error;
  }
  return () => {
    fs.closeSync(descriptor);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  };
}

function resolveArtifactReader({ artifactReader, evidenceStorePath }) {
  return typeof artifactReader === 'function'
    ? artifactReader
    : createEvidenceStoreArtifactReader({ evidenceStorePath });
}

function promotionId() {
  return `ontology-maintainer-promotion-${crypto.randomUUID()}`;
}

function promoteOntologyMaintainerApproval({
  approvalId, stateStore, repoRoot, artifactReader, attestationSecret, evidenceStorePath, failureInjector,
} = {}) {
  if (!stateStore || typeof stateStore.assertOntologyMaintainerPromotionApproval !== 'function'
      || typeof stateStore.prepareOntologyMaintainerPromotion !== 'function'
      || typeof stateStore.completeOntologyMaintainerPromotion !== 'function') {
    throw new Error('Ontology maintainer promotion state store is unavailable');
  }
  const root = resolveRepoRoot(repoRoot);
  assertTrustedPromotionWorktree(root);
  const checkedAt = new Date().toISOString();
  const priorPromotion = stateStore.getOntologyMaintainerPromotionByApprovalId(approvalId);
  if (priorPromotion) {
    if (priorPromotion.repoRoot !== root) throw new Error('Ontology maintainer promotion repository root does not match the prepared record');
    if (priorPromotion.state === 'applied') return { status: 'already_applied', promotion: priorPromotion };
    throw new Error('Ontology maintainer promotion is in a prepared or recovery state');
  }
  const readArtifact = resolveArtifactReader({ artifactReader, evidenceStorePath });
  const firstHead = readRepoHead(root);
  const approval = stateStore.getOntologyMaintainerApprovalById(approvalId);
  if (!approval) throw new Error('Ontology maintainer promotion approval was not recorded');
  const { target } = resolveCanonicalTarget(root, approval.targetPath);
  const beforeContents = fs.readFileSync(target);
  const beforeHash = sha256(beforeContents);
  const bindings = stateStore.assertOntologyMaintainerPromotionApproval(approvalId, {
    currentRepoHead: firstHead, currentTargetBeforeHash: beforeHash, now: checkedAt,
    artifactReader: readArtifact, attestationSecret, evidenceStorePath,
  });
  const artifactBuffer = readArtifact(bindings.receipt.artifactReference.artifactId);
  const artifact = parsePromotionArtifact(Buffer.isBuffer(artifactBuffer) ? artifactBuffer : Buffer.from(artifactBuffer || ''));
  if (sha256(Buffer.isBuffer(artifactBuffer) ? artifactBuffer : Buffer.from(artifactBuffer || '')) !== bindings.receipt.artifactReference.artifactHash) {
    throw new Error('Ontology maintainer promotion artifact hash changed after attestation');
  }
  if (artifact.proposalId !== bindings.proposal.id || artifact.proposalSha256 !== bindings.proposal.proposalSha256
      || artifact.targetPath !== bindings.proposal.targetPath || artifact.targetBeforeHash !== bindings.proposal.targetBeforeHash) {
    throw new Error('Ontology maintainer promotion artifact does not bind the approved proposal');
  }
  const canonical = resolveCanonicalTarget(root, artifact.targetPath);
  validateOntologyDocument({ document: artifact.operation.document, domainKey: canonical.domainKey });
  const nextContents = Buffer.from(`${JSON.stringify(artifact.operation.document, null, 2)}\n`, 'utf8');
  const targetAfterHash = sha256(nextContents);
  const ownerToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(checkedAt) + (5 * 60 * 1000)).toISOString();
  const releaseLock = acquirePromotionTargetLock(canonical.target);
  let prepared = false;
  let wroteTarget = false;
  try {
    assertTargetBindings({
      repoRoot: root, targetPath: artifact.targetPath, target: canonical.target, beforeHash, repoHead: firstHead,
    });
    stateStore.assertOntologyMaintainerPromotionApproval(approvalId, {
      currentRepoHead: firstHead, currentTargetBeforeHash: beforeHash, now: checkedAt,
      artifactReader: readArtifact, attestationSecret, evidenceStorePath,
    });
    const claimedPromotion = stateStore.prepareOntologyMaintainerPromotion({
      id: promotionId(), approvalId, proposalId: bindings.proposal.id, repoRoot: root,
      targetPath: artifact.targetPath, targetBeforeHash: beforeHash, targetAfterHash,
      ownerToken, leaseExpiresAt, createdAt: checkedAt,
    });
    if (claimedPromotion.state !== 'prepared' || claimedPromotion.ownerToken !== ownerToken) {
      throw new Error('Ontology maintainer promotion is in a prepared or recovery state');
    }
    prepared = true;
    atomicReplace(canonical.target, nextContents, stage => {
      if (stage === 'before_rename') {
        assertTargetBindings({
          repoRoot: root, targetPath: artifact.targetPath, target: canonical.target, beforeHash, repoHead: firstHead,
        });
        stateStore.assertOntologyMaintainerPromotionApproval(approvalId, {
          currentRepoHead: firstHead, currentTargetBeforeHash: beforeHash, now: checkedAt,
          artifactReader: readArtifact, attestationSecret, evidenceStorePath,
        });
      }
      if (typeof failureInjector === 'function') failureInjector(stage);
    });
    wroteTarget = true;
    if (typeof failureInjector === 'function') failureInjector('after_rename');
    if (sha256(fs.readFileSync(canonical.target)) !== targetAfterHash) {
      throw new Error('Ontology maintainer promotion post-write hash verification failed');
    }
    const promotion = stateStore.completeOntologyMaintainerPromotion({
      approvalId, ownerToken, state: 'applied', completedAt: checkedAt,
    });
    if (promotion.state !== 'applied') throw new Error('Ontology maintainer promotion completion was not applied');
    return { status: 'applied', promotion };
  } catch (error) {
    try {
      if (prepared && wroteTarget && sha256(fs.readFileSync(canonical.target)) === targetAfterHash) {
        atomicReplace(canonical.target, beforeContents, stage => {
          if (stage === 'before_rename' && sha256(fs.readFileSync(canonical.target)) !== targetAfterHash) {
            throw new Error('Ontology maintainer promotion target changed during recovery');
          }
        });
      }
    } finally {
      if (prepared) {
        try {
          stateStore.completeOntologyMaintainerPromotion({
            approvalId, ownerToken, state: 'recovery_required', reasonCode: 'promotion_apply_failed', completedAt: checkedAt,
          });
        } catch (_recoveryError) {
          // The prepared record remains fail-closed if the durable recovery transition cannot be recorded.
        }
      }
    }
    throw error;
  } finally {
    releaseLock();
  }
}

module.exports = {
  MAX_PROMOTION_ARTIFACT_BYTES,
  PROMOTION_ARTIFACT_SCHEMA_VERSION,
  PROMOTION_ARTIFACT_TYPE,
  PROMOTION_OPERATION_TYPE,
  assertValidOntologyMaintainerPromotionArtifact,
  promoteOntologyMaintainerApproval,
  readRepoHead,
  validateOntologyMaintainerPromotionArtifact,
};
