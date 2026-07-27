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
  markRetryableFailure,
  parseSemanticProviderOutput,
  runBoundedOntologyMaintainerProcess,
} = require('../../scripts/lib/ontology-maintainer-runtime');
const {
  MAX_PROCESS_INPUT_BYTES,
  MAX_PROCESS_OUTPUT_BYTES,
  getTrustedWindowsTaskkillPath,
  terminateProcessTree,
  terminateWindowsProcessTree,
} = require('../../scripts/lib/ontology-maintainer-process');

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

function createAttestedArtifactPersister(artifact) {
  return ({ job: claimedJob, proposal }) => {
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
  assert.strictEqual(parseSemanticProviderOutput(''), null);
  assert.strictEqual(parseSemanticProviderOutput('{not-json'), null);
  assert.strictEqual(parseSemanticProviderOutput(JSON.stringify({
    targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
    intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' }, extra: true,
  })), null);
  assert.strictEqual(parseSemanticProviderOutput(JSON.stringify({
    targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
    intent: { action: 'sync_domain_metadata', subject: 'domain_state_store', raw: 'must-not-persist' },
  })), null);
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
  assert.throws(() => runBoundedOntologyMaintainerProcess({
    command: 'claude\n--unsafe', args: [], input: '{}', spawnProcess: spawn,
  }), /bounded single-line string/);
  assert.throws(() => runBoundedOntologyMaintainerProcess({
    command: 'claude', args: Array.from({ length: 13 }, () => '--print'), input: '{}', spawnProcess: spawn,
  }), /fixed bounded array/);
  assert.throws(() => runBoundedOntologyMaintainerProcess({
    command: 'claude', args: [], input: 'x'.repeat(MAX_PROCESS_INPUT_BYTES + 1), spawnProcess: spawn,
  }), /at most/);
  assert.throws(() => runBoundedOntologyMaintainerProcess({
    command: 'claude', args: [], input: '{}', timeoutMs: 0, spawnProcess: spawn,
  }), /timeoutMs must be an integer/);
  await assert.rejects(
    runBoundedOntologyMaintainerProcess({
      command: 'claude', args: [], input: '{}', spawnProcess: () => { throw new Error('spawn unavailable'); },
    }),
    /spawn unavailable/
  );
  await assert.rejects(
    runBoundedOntologyMaintainerProcess({ command: 'claude', args: [], input: '{}', spawnProcess: () => ({}) }),
    /standard streams/
  );
  const outputLimited = await runBoundedOntologyMaintainerProcess({
    command: 'claude', args: [], input: '{}', timeoutMs: 1_000,
    spawnProcess: createMockSpawn({ stdout: 'x'.repeat(MAX_PROCESS_OUTPUT_BYTES + 1) }),
  });
  assert.strictEqual(outputLimited.outputLimitExceeded, true);
  assert.strictEqual(outputLimited.stdout.length, MAX_PROCESS_OUTPUT_BYTES);
  assert.strictEqual(getTrustedWindowsTaskkillPath('C:\\Windows\\..\\Windows'), 'C:\\Windows\\System32\\taskkill.exe');
  assert.strictEqual(getTrustedWindowsTaskkillPath('C:\\unsafe'), 'C:\\Windows\\System32\\taskkill.exe');
  await terminateWindowsProcessTree({ pid: 0 }, { spawnTreeKiller: () => { throw new Error('must not spawn'); } });
  const childKillSignals = [];
  await terminateProcessTree({ kill: signal => childKillSignals.push(signal) }, 'SIGTERM', { platform: 'darwin' });
  assert.deepStrictEqual(childKillSignals, ['SIGTERM']);

  const epipeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {
      process.nextTick(() => {
        const error = new Error('write EPIPE');
        error.code = 'EPIPE';
        child.stdin.emit('error', error);
        child.emit('close', 0, null);
      });
    };
    child.kill = () => true;
    return child;
  };
  const epipeResult = await runBoundedOntologyMaintainerProcess({
    command: 'claude', args: ['--print'], input: '{}', spawnProcess: epipeSpawn, timeoutMs: 1000,
  });
  assert.strictEqual(epipeResult.exitCode, 0, 'stdin EPIPE from an exited provider must be handled');

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
    command: 'codex', args: ['exec'], input: '{}', spawnProcess: nonClosingSpawn, timeoutMs: 1, terminationGraceMs: 1,
  });
  assert.strictEqual(timedOut.timedOut, true);

  const posixSignals = [];
  let posixRunPending = true;
  const posixRun = runBoundedOntologyMaintainerProcess({
    command: 'codex', args: ['exec'], input: '{}', timeoutMs: 1, terminationGraceMs: 1, platform: 'darwin',
    spawnProcess: (_command, _args, _options) => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {}, destroy() {} };
      child.kill = signal => {
        posixSignals.push(signal);
        if (signal === 'SIGTERM') process.nextTick(() => child.emit('close', null, signal));
        return true;
      };
      return child;
    },
  }).then(result => {
    posixRunPending = false;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(posixRunPending, true);
  assert.strictEqual((await posixRun).timedOut, true);
  assert.deepStrictEqual(posixSignals, ['SIGTERM', 'SIGKILL']);

  let hangingChild;
  let pending = true;
  const hangingRun = runBoundedOntologyMaintainerProcess({
    command: 'codex', args: ['exec'], input: '{}', timeoutMs: 1, terminationGraceMs: 1,
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

  let windowsChild;
  let windowsKiller;
  const windowsTreeCalls = [];
  let windowsRunPending = true;
  const windowsRun = runBoundedOntologyMaintainerProcess({
    command: 'codex', args: ['exec'], input: '{}', timeoutMs: 1, platform: 'win32', systemRoot: 'C:\\Windows',
    spawnProcess: (_command, _args, _options) => {
      windowsChild = new EventEmitter();
      windowsChild.pid = 4242;
      windowsChild.stdout = new EventEmitter();
      windowsChild.stderr = new EventEmitter();
      windowsChild.stdin = { end() {}, destroy() {} };
      windowsChild.kill = () => true;
      return windowsChild;
    },
    spawnTreeKiller: (command, args, options) => {
      windowsTreeCalls.push({ command, args, options });
      windowsKiller = new EventEmitter();
      return windowsKiller;
    },
  }).then(result => {
    windowsRunPending = false;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepStrictEqual(windowsTreeCalls, [{
    command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', '4242', '/T', '/F'],
    options: {
      shell: false, stdio: 'ignore', windowsHide: true, detached: false,
      env: { PATH: calls[0].options.env.PATH, LANG: 'C', LC_ALL: 'C' },
    },
  }]);
  windowsChild.emit('close', null, 'SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.strictEqual(windowsRunPending, true);
  windowsKiller.emit('close', 0, null);
  assert.strictEqual((await windowsRun).timedOut, true);

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
      persistArtifact: createAttestedArtifactPersister(artifact),
      now: NOW,
      ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.strictEqual(execution.status, 'succeeded');
    assert.strictEqual(execution.proposal.provider, 'claude_code');
    assert.strictEqual(execution.receipt.outcome, 'succeeded');
    assert.strictEqual(store.listOntologyMaintainerReceipts({ proposalId: execution.proposal.id }).length, 1);

    const defaultTimestampJob = job(review.reviewPackageSha256, {
      id: 'ontology-maintainer-job-33333333-3333-3333-3333-333333333333',
      idempotencyKey: 'ontology-maintainer-runtime-default-retry-1234567890abcdef',
    });
    store.claimOntologyMaintainerJob(defaultTimestampJob);
    assert.deepStrictEqual(
      markRetryableFailure(store, defaultTimestampJob, 'provider_timeout'),
      { status: 'retryable_failure', reasonCode: 'provider_timeout' }
    );
    assert.strictEqual(store.getOntologyMaintainerJobById(defaultTimestampJob.id).state, 'retryable_failure');

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

    const atomicFailureStore = {
      ...store,
      recordOntologyMaintainerProposalAndReceipt: () => {
        throw new Error('simulated receipt write failure');
      },
    };
    const atomicFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-44444444-4444-4444-4444-444444444444',
        idempotencyKey: 'ontology-maintainer-runtime-atomic-failure-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: atomicFailureStore, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }), persistArtifact: createAttestedArtifactPersister(artifact), now: NOW, ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(atomicFailure, {
      status: 'retryable_failure', reasonCode: 'proposal_receipt_persistence_failed',
    });
    assert.strictEqual(
      store.getOntologyMaintainerJobById('ontology-maintainer-job-44444444-4444-4444-4444-444444444444').state,
      'retryable_failure'
    );

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

    assert.deepStrictEqual(await executeOntologyMaintainerJob({
      job: { ...job(review.reviewPackageSha256), provider: 'auto' }, reviewPackage: review.reviewPackage, stateStore: store,
      currentRepoHead: REVIEW_HEAD, providerCapabilities: PROVIDER_CAPABILITIES, spawnProcess: createMockSpawn(),
      ...RUNTIME_SECURITY_OPTIONS,
    }), { status: 'denied', reasonCode: 'job_invalid' });
    assert.deepStrictEqual(await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-12121212-1212-1212-1212-121212121212',
        idempotencyKey: 'ontology-maintainer-runtime-binding-1234567890abcdef',
      }), reviewPackage: { ...review.reviewPackage, candidate: { ...review.reviewPackage.candidate, id: CANDIDATE_ID } },
      stateStore: store, currentRepoHead: 'f'.repeat(40), providerCapabilities: PROVIDER_CAPABILITIES,
      spawnProcess: createMockSpawn(), ...RUNTIME_SECURITY_OPTIONS,
    }), { status: 'denied', reasonCode: 'job_binding_invalid' });
    assert.deepStrictEqual(await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-13131313-1313-1313-1313-131313131313',
        idempotencyKey: 'ontology-maintainer-runtime-store-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: null, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, spawnProcess: createMockSpawn(), ...RUNTIME_SECURITY_OPTIONS,
    }), { status: 'denied', reasonCode: 'state_store_unavailable' });
    assert.deepStrictEqual(await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-14141414-1414-1414-1414-141414141414',
        idempotencyKey: 'ontology-maintainer-runtime-runner-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, ...RUNTIME_SECURITY_OPTIONS,
    }), { status: 'denied', reasonCode: 'process_runner_unavailable' });
    assert.deepStrictEqual(await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-15151515-1515-1515-1515-151515151515',
        idempotencyKey: 'ontology-maintainer-runtime-claim-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: { ...store, claimOntologyMaintainerJob: () => { throw new Error('locked'); } },
      currentRepoHead: REVIEW_HEAD, providerCapabilities: PROVIDER_CAPABILITIES, spawnProcess: createMockSpawn(),
      ...RUNTIME_SECURITY_OPTIONS,
    }), { status: 'denied', reasonCode: 'job_claim_rejected' });
    const duplicateExecution = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256), reviewPackage: review.reviewPackage, stateStore: store,
      currentRepoHead: REVIEW_HEAD, providerCapabilities: PROVIDER_CAPABILITIES, spawnProcess: createMockSpawn(),
      ...RUNTIME_SECURITY_OPTIONS,
    });
    assert.deepStrictEqual(duplicateExecution.status, 'duplicate');
    assert.strictEqual(duplicateExecution.job.id, 'ontology-maintainer-job-12345678-1234-1234-1234-123456789abc');

    const timeoutExecution = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-16161616-1616-1616-1616-161616161616',
        idempotencyKey: 'ontology-maintainer-runtime-timeout-1234567890abcdef',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, timeoutMs: 1, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
      spawnProcess: nonClosingSpawn,
    });
    assert.deepStrictEqual(timeoutExecution, { status: 'retryable_failure', reasonCode: 'provider_timeout' });
    const outputLimitExecution = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-17171717-1717-1717-1717-171717171717',
        idempotencyKey: 'ontology-maintainer-runtime-output-limit-1234567890abcd',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
      spawnProcess: createMockSpawn({ stdout: 'x'.repeat(MAX_PROCESS_OUTPUT_BYTES + 1) }),
    });
    assert.deepStrictEqual(outputLimitExecution, { status: 'rejected', reasonCode: 'provider_output_too_large' });
    const processFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-18181818-1818-1818-1818-181818181818',
        idempotencyKey: 'ontology-maintainer-runtime-process-fail-1234567890ab',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
      spawnProcess: createMockSpawn({ exitCode: 2 }),
    });
    assert.deepStrictEqual(processFailure, { status: 'retryable_failure', reasonCode: 'provider_process_failed' });
    const semanticFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-19191919-1919-1919-1919-191919191919',
        idempotencyKey: 'ontology-maintainer-runtime-semantic-fail-1234567890ab',
      }), reviewPackage: review.reviewPackage, stateStore: store, currentRepoHead: REVIEW_HEAD,
      providerCapabilities: PROVIDER_CAPABILITIES, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.git/config', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }),
    });
    assert.deepStrictEqual(semanticFailure, { status: 'rejected', reasonCode: 'semantic_proposal_rejected' });
    const proposalWriteFailure = await executeOntologyMaintainerJob({
      job: job(review.reviewPackageSha256, {
        id: 'ontology-maintainer-job-20202020-2020-2020-2020-202020202020',
        idempotencyKey: 'ontology-maintainer-runtime-proposal-write-1234567890',
      }), reviewPackage: review.reviewPackage,
      stateStore: { ...store, recordOntologyMaintainerProposal: () => { throw new Error('readonly'); } },
      currentRepoHead: REVIEW_HEAD, providerCapabilities: PROVIDER_CAPABILITIES, now: NOW, ...RUNTIME_SECURITY_OPTIONS,
      spawnProcess: createMockSpawn({ stdout: JSON.stringify({
        targetPath: '.claude/ontology/domain_state_store.json', targetBeforeHash: `sha256:${'b'.repeat(64)}`,
        intent: { action: 'sync_domain_metadata', subject: 'domain_state_store' },
      }) }),
    });
    assert.deepStrictEqual(proposalWriteFailure, { status: 'retryable_failure', reasonCode: 'proposal_persistence_failed' });
    console.log('  PASS enforces fixed dual-provider process contracts and records semantic proposals only');
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
