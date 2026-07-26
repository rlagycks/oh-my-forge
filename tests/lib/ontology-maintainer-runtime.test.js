'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createStateStore } = require('../../scripts/lib/state-store');
const { runOntologyMaintainerDryRun } = require('../../scripts/lib/ontology-maintainer');
const {
  createOntologyMaintainerArtifactSignature,
} = require('../../scripts/lib/ontology-maintainer-protocol');
const { resolveOntologyMaintainerProviderBinary } = require('../../scripts/lib/ontology-maintainer-providers');
const {
  buildOntologyMaintainerProviderInvocation,
  executeOntologyMaintainerJob,
  runBoundedOntologyMaintainerProcess,
} = require('../../scripts/lib/ontology-maintainer-runtime');

const NOW = '2026-07-26T02:00:00.000Z';
const CANDIDATE_ID = 'ontology-candidate-1234567890abcdef12345678';
const REVIEW_HEAD = '0123456789abcdef0123456789abcdef01234567';
const ATTESTATION_SECRET = 'runtime-test-attestation-secret-at-least-32-characters';
const TRUSTED_PROVIDER_FILE_SYSTEM = {
  realpathSync: Object.assign(value => value, { native: value => value }),
  statSync: () => ({ isFile: () => true, mode: 0o755, uid: 501 }),
};
const PROVIDER_CAPABILITIES = {
  claude_code: { binaryPath: '/trusted/claude' },
  codex_cli: { binaryPath: '/trusted/codex' },
};
const RUNTIME_SECURITY_OPTIONS = {
  providerFileSystem: TRUSTED_PROVIDER_FILE_SYSTEM,
  getProcessUid: () => 501,
};

function createMockSpawn({ stdout = '', stderr = '', exitCode = 0, signal = null } = {}) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    child.kill = signal => {
      process.nextTick(() => child.emit('close', null, signal));
      return true;
    };
    process.nextTick(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode, signal);
    });
    child.command = command;
    child.args = args;
    child.options = options;
    return child;
  };
}

function job(reviewPackageSha256, overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'ontology_maintainer_job',
    id: 'ontology-maintainer-job-12345678-1234-1234-1234-123456789abc',
    idempotencyKey: 'ontology-maintainer-runtime-idempotency-1234567890abcdef',
    provider: 'claude_code',
    candidateId: CANDIDATE_ID,
    reviewPackageSha256,
    candidateFingerprint: 'a'.repeat(64),
    repoHead: REVIEW_HEAD,
    hop: 0,
    hopLimit: 1,
    createdAt: NOW,
    ...overrides,
  };
}

async function seedReview(store) {
  store.applyOntologyObservationDrain({
    spoolPath: '/tmp/ontology-maintainer-runtime.jsonl', checkpointOffset: 1,
    entries: [{
      lineEndOffset: 1,
      observation: { id: 'ontology-observation-1234567890abcdef12345678', observedAt: NOW },
      candidate: {
        id: CANDIDATE_ID, candidateKey: 'runtime-candidate-key', projectKey: 'project-key',
        domainKey: 'domain_state_store', filePath: 'scripts/lib/state-store/queries.js',
        kind: 'observed_file_change', status: 'pending_review', latestContentFingerprint: 'a'.repeat(64),
        firstObservedAt: NOW, lastObservedAt: NOW, createdAt: NOW, updatedAt: NOW,
      },
    }],
  });
  const result = runOntologyMaintainerDryRun({ candidateId: CANDIDATE_ID, stateStore: store, now: NOW });
  assert.strictEqual(result.status, 'review_package_ready');
  const attempt = store.listOntologyMaintainerAttempts({ candidateId: CANDIDATE_ID })[0];
  return { reviewPackage: result.reviewPackage, reviewPackageSha256: attempt.reviewPackageSha256 };
}

async function main() {
  console.log('\nontology-maintainer-runtime.test.js');

  const claude = buildOntologyMaintainerProviderInvocation({
    provider: 'claude_code', binaryPath: '/trusted/claude', input: '{}',
  });
  assert.deepStrictEqual(claude, {
    command: '/trusted/claude', args: ['--print', '--output-format', 'json', '--permission-mode', 'plan'], input: '{}',
  });
  const codex = buildOntologyMaintainerProviderInvocation({
    provider: 'codex_cli', binaryPath: '/trusted/codex', input: '{}',
  });
  assert.deepStrictEqual(codex, {
    command: '/trusted/codex', args: ['exec', '--json', '--sandbox', 'read-only'], input: '{}',
  });
  assert.throws(
    () => buildOntologyMaintainerProviderInvocation({ provider: 'auto', binaryPath: '/trusted/auto', input: '{}' }),
    /explicitly allowed/
  );
  assert.throws(
    () => buildOntologyMaintainerProviderInvocation({ provider: 'claude_code', binaryPath: 'claude', input: '{}' }),
    /trusted absolute binary path/
  );
  assert.strictEqual(resolveOntologyMaintainerProviderBinary('claude_code', {
    claude_code: { binaryPath: 'claude' },
  }, RUNTIME_SECURITY_OPTIONS), null);
  assert.strictEqual(resolveOntologyMaintainerProviderBinary('claude_code', PROVIDER_CAPABILITIES, {
    fileSystem: {
      realpathSync: Object.assign(value => value, { native: value => value }),
      statSync: () => ({ isFile: () => true, mode: 0o777, uid: 501 }),
    },
    getUid: () => 501,
  }), null);

  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return createMockSpawn({ stdout: '{"ok":true}' })(command, args, options);
  };
  const processResult = await runBoundedOntologyMaintainerProcess({
    command: 'claude', args: ['--print'], input: '{}', spawnProcess: spawn,
    environment: { PATH: '/usr/bin', SECRET_TOKEN: 'must-not-pass' }, timeoutMs: 1000,
  });
  assert.strictEqual(processResult.exitCode, 0);
  assert.strictEqual(processResult.stdout, '{"ok":true}');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.shell, false);
  assert.deepStrictEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.strictEqual(calls[0].options.detached, process.platform !== 'win32');
  assert.strictEqual(calls[0].options.env.SECRET_TOKEN, undefined);
  assert.notStrictEqual(calls[0].options.env.PATH, '/usr/bin');
  assert.deepStrictEqual(Object.keys(calls[0].options.env).sort(), ['LANG', 'LC_ALL', 'PATH']);

  const nonClosingSpawn = (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    child.kill = signal => {
      process.nextTick(() => child.emit('close', null, signal));
      return true;
    };
    return child;
  };
  const timedOut = await runBoundedOntologyMaintainerProcess({
    command: 'codex', args: ['exec'], input: '{}', spawnProcess: nonClosingSpawn, timeoutMs: 1,
  });
  assert.strictEqual(timedOut.timedOut, true);

  let hangingChild;
  let pending = true;
  const hangingRun = runBoundedOntologyMaintainerProcess({
    command: 'codex', args: ['exec'], input: '{}', timeoutMs: 1,
    spawnProcess: (_command, _args, _options) => {
      hangingChild = new EventEmitter();
      hangingChild.stdout = new EventEmitter();
      hangingChild.stderr = new EventEmitter();
      hangingChild.stdin = { end() {}, destroy() {} };
      hangingChild.kill = () => true;
      return hangingChild;
    },
  }).then(result => {
    pending = false;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(pending, true);
  hangingChild.emit('close', null, 'SIGTERM');
  assert.strictEqual((await hangingRun).timedOut, true);

  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    const review = await seedReview(store);
    const artifact = Buffer.from('opaque-runtime-artifact');
    const execution = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256), reviewPackage: review.reviewPackage, stateStore: store,
      currentRepoHead: REVIEW_HEAD, providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }),
      persistArtifact: ({ job: claimedJob, proposal }) => {
        const reference = {
          artifactId: 'ontology-maintainer/artifacts/runtime-proposal-123',
          artifactHash: `sha256:${crypto.createHash('sha256').update(artifact).digest('hex')}`,
          persistedAt: NOW,
        };
        return {
          artifactReference: {
            ...reference,
            signature: createOntologyMaintainerArtifactSignature({
              job: claimedJob, proposal, artifactReference: reference, attestationSecret: ATTESTATION_SECRET,
            }),
          },
          artifactReader: artifactId => {
            assert.strictEqual(artifactId, reference.artifactId);
            return artifact;
          },
          attestationSecret: ATTESTATION_SECRET,
        };
      },
      now: NOW,
      ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.strictEqual(execution.status, 'succeeded');
    assert.strictEqual(execution.proposal.provider, 'claude_code');
    assert.strictEqual(execution.receipt.outcome, 'succeeded');
    assert.strictEqual(store.listOntologyMaintainerReceipts({ proposalId: execution.proposal.id }).length, 1);

    const codexExecution = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-87654321-4321-4321-4321-cba987654321',
        idempotencyKey: 'ontology-maintainer-runtime-codex-1234567890abcdef', provider: 'codex_cli',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }), now: NOW, ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.strictEqual(codexExecution.status, 'proposal_recorded');
    assert.strictEqual(codexExecution.proposal.provider, 'codex_cli');

    const persistenceFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-11111111-1111-1111-1111-111111111111',
        idempotencyKey: 'ontology-maintainer-runtime-artifact-failure-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }),
      persistArtifact: () => { throw new Error('evidence store is unavailable'); }, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(persistenceFailure, { status: 'retryable_failure', reasonCode: 'artifact_persistence_failed' });
    assert.strictEqual(
      store.getOntologyMaintainerJobById('ontology-maintainer-job-11111111-1111-1111-1111-111111111111').state,
      'retryable_failure'
    );
    const reclaimed = store.claimOntologyMaintainerJob(job(review.reviewPackageSha256, {
      id: 'ontology-maintainer-job-11111111-1111-1111-1111-111111111111',
      idempotencyKey: 'ontology-maintainer-runtime-artifact-failure-1234567890abcdef',
    }));
    assert.strictEqual(reclaimed.claimed, true);
    assert.strictEqual(reclaimed.reclaimed, true);

    const attestationFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-22222222-2222-2222-2222-222222222222',
        idempotencyKey: 'ontology-maintainer-runtime-attestation-failure-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }),
      persistArtifact: () => ({ artifactReference: null }), now: NOW, ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(attestationFailure, { status: 'retryable_failure', reasonCode: 'artifact_receipt_rejected' });
    assert.strictEqual(
      store.getOntologyMaintainerJobById('ontology-maintainer-job-22222222-2222-2222-2222-222222222222').state,
      'retryable_failure'
    );

    const unavailable = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-87654321-4321-4321-4321-cba987654321',
        idempotencyKey: 'ontology-maintainer-runtime-unavailable-1234567890abcdef', provider: 'codex_cli',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: { claude_code: { binaryPath: '/trusted/claude' } }, spawnProcess: createMockSpawn(), now: NOW,
      ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(unavailable, { status: 'denied', reasonCode: 'provider_binary_unavailable' });

    const invalidOutput = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-abcdef12-1234-1234-1234-123456789abc',
        idempotencyKey: 'ontology-maintainer-runtime-invalid-output-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' }, patch: '--- secret patch',
      }) }), now: NOW, ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(invalidOutput, { status: 'rejected', reasonCode: 'provider_output_invalid' });
    console.log('  PASS enforces fixed dual-provider process contracts and records semantic proposals only');
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
