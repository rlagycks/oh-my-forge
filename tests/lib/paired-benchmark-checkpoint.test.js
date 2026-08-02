'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  compatibilityErrors,
  createCheckpointWriter,
  loadResumablePairs,
  readCheckpoint,
} = require('../../scripts/lib/paired-benchmark-checkpoint');
const { runPairedBenchmark } = require('../../scripts/lib/paired-benchmark-runner');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

/** Awaits async bodies before cleaning up, so the temp dir outlives the run. */
async function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-checkpoint-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const CONTEXT = {
  seed: 42,
  repetitions: 1,
  suite: 'demo',
  snapshotId: 'snap',
  snapshotHash: 'sha256:abc',
  comparisonFingerprint: 'sha256:def',
  guards: { isolation: true, comparable: true, failingBaseline: false },
};

/** Suite whose verification always passes, so outcomes are deterministic. */
function writeSuite(root, taskCount) {
  const suitePath = path.join(root, 'suite.json');
  fs.writeFileSync(suitePath, JSON.stringify({
    suite: 'demo',
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `task-${index}`,
      prompt: 'do the thing',
      provenance: { source: 'tests', incident: 'synthetic' },
      tags: ['test'],
      difficulty: 'easy',
      success_criteria: ['passes'],
      verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
    })),
  }));
  return suitePath;
}

const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const METADATA = Object.freeze({
  provider: 'fake',
  model: 'fake-1',
  config: { reasoningEffort: 'medium' },
  comparisonFingerprint: FINGERPRINT,
});

/**
 * Adapter that charges a fixed price and can be told to refuse after N calls,
 * which is exactly how the budget guard aborts a real run: under
 * --require-comparable the runner turns any adapter error into a thrown
 * COMPARISON_CONFIG_MISMATCH.
 */
function createAdapter({ costUsd = 1, failAfter = Infinity } = {}) {
  const state = { calls: 0 };
  return {
    state,
    adapter: {
      measurementMetadata: { ...METADATA },
      async run() {
        state.calls += 1;
        if (state.calls > failAfter) {
          const error = new Error('adapter refused: out of budget');
          error.code = 'INSUFFICIENT_PAIR_BUDGET';
          throw error;
        }
        return { ...METADATA, costUsd, inputTokens: 10, outputTokens: 1 };
      },
    },
  };
}

(async () => {
  console.log('paired-benchmark-checkpoint');

  await test('a torn final line does not make the ledger unreadable', async () => {
    await withTempRoot(root => {
      const file = path.join(root, 'ck.jsonl');
      const writer = createCheckpointWriter(file, CONTEXT);
      writer.appendPair({ taskId: 'a', repetition: 1, status: 'complete', conditions: { on: {}, off: {} } });
      // Simulate a process killed mid-write.
      fs.appendFileSync(file, '{"type":"pair_result","pai');

      const { header, pairs, corrupt } = readCheckpoint(file);
      assert.ok(header, 'header must survive');
      assert.strictEqual(pairs.size, 1);
      assert.strictEqual(corrupt, 1);
    });
  });

  await test('resuming refuses a checkpoint from a different measurement', async () => {
    await withTempRoot(root => {
      const file = path.join(root, 'ck.jsonl');
      createCheckpointWriter(file, CONTEXT).appendPair({ taskId: 'a', repetition: 1, status: 'complete' });

      assert.throws(
        () => loadResumablePairs(file, { ...CONTEXT, seed: 43 }),
        /seed differs/,
        'a different seed produces a different pair plan'
      );
      assert.throws(() => loadResumablePairs(file, { ...CONTEXT, snapshotHash: 'sha256:zzz' }), /snapshotHash differs/);
      assert.throws(() => loadResumablePairs(file, { ...CONTEXT, comparisonFingerprint: 'sha256:zzz' }), /comparisonFingerprint differs/);
      assert.doesNotThrow(() => loadResumablePairs(file, CONTEXT));
    });
  });

  await test('only complete pairs are reusable', async () => {
    await withTempRoot(root => {
      const file = path.join(root, 'ck.jsonl');
      const writer = createCheckpointWriter(file, CONTEXT);
      writer.appendPair({ taskId: 'a', repetition: 1, status: 'complete', conditions: { on: {}, off: {} } });
      writer.appendPair({ taskId: 'b', repetition: 1, status: 'incomplete', conditions: { on: {} } });
      writer.appendPair({ taskId: 'c', repetition: 1, status: 'skipped', skippedReason: 'cost_limit' });

      const { pairs, skipped } = loadResumablePairs(file, CONTEXT);
      assert.deepStrictEqual([...pairs.keys()], ['a#1']);
      assert.strictEqual(skipped, 2, 'incomplete and skipped pairs are re-run, not reused');
    });
  });

  await test('compatibilityErrors names every mismatching field', () => {
    const errors = compatibilityErrors({ schemaVersion: 1, ...CONTEXT }, { ...CONTEXT, seed: 1, suite: 'other' });
    assert.strictEqual(errors.length, 2);
    assert.ok(errors.some(e => e.startsWith('seed')));
    assert.ok(errors.some(e => e.startsWith('suite')));
  });

  await test('an aborted run keeps its finished pairs, and a resume completes them', async () => {
    await withTempRoot(async root => {
      const suitePath = writeSuite(root, 4);
      const checkpointPath = path.join(root, 'ck.jsonl');
      const shared = {
        suitePath,
        seed: 42,
        repetitions: 1,
        snapshot: { id: 'snap', hash: 'sha256:abc' },
        logPath: path.join(root, 'events.jsonl'),
        requireComparable: true,
      };

      // First run dies part-way: the adapter refuses after 4 episodes (2 pairs).
      const first = createAdapter({ failAfter: 4 });
      await assert.rejects(
        runPairedBenchmark({ ...shared, adapter: first.adapter, checkpointPath }),
        /out of budget/
      );

      const afterAbort = loadResumablePairs(checkpointPath, {
        seed: 42,
        repetitions: 1,
        suite: 'demo',
        snapshotId: 'snap',
        snapshotHash: 'sha256:abc',
        comparisonFingerprint: FINGERPRINT,
        guards: { isolation: false, comparable: true, failingBaseline: false },
      });
      assert.strictEqual(afterAbort.pairs.size, 2, 'the two finished pairs survived the abort');

      // Second run resumes and only pays for what is left.
      const second = createAdapter();
      const report = await runPairedBenchmark({
        ...shared,
        adapter: second.adapter,
        checkpointPath,
        resumeFrom: checkpointPath,
      });

      assert.strictEqual(report.resume.resumedPairs, 2);
      assert.strictEqual(report.resume.executedPairs, 2);
      assert.strictEqual(second.state.calls, 4, 'only the remaining two pairs were executed');
      assert.strictEqual(report.comparison.pairs, 4, 'all four pairs are in the comparison');
      assert.strictEqual(report.pairs.filter(pair => pair.status === 'complete').length, 4);
    });
  });

  await test('a run without checkpoint flags behaves exactly as before', async () => {
    await withTempRoot(async root => {
      const { adapter } = createAdapter();
      const report = await runPairedBenchmark({
        suitePath: writeSuite(root, 2),
        adapter,
        seed: 7,
        repetitions: 1,
        snapshot: { id: 'snap', hash: 'sha256:abc' },
        logPath: path.join(root, 'events.jsonl'),
        requireComparable: true,
      });
      assert.strictEqual(report.resume.checkpointPath, null);
      assert.strictEqual(report.resume.resumedPairs, 0);
      assert.strictEqual(report.resume.executedPairs, 2);
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
