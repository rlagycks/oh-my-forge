'use strict';

const assert = require('assert');

const {
  DEFAULT_MIN_CLUSTERS,
  analyzePairedReport,
  clusterBootstrap,
  createRandom,
  decideVerdict,
  exactBinomialTwoSided,
  extractObservations,
  groupByTask,
  passAtK,
  passCaretK,
  percentile,
} = require('../../scripts/lib/paired-stats');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

const close = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;

/** Build a synthetic report: outcomes[taskId] = [[onSuccess, offSuccess], ...] */
function buildReport(outcomes, { seed = 7, metrics = {} } = {}) {
  const pairs = Object.entries(outcomes).flatMap(([taskId, reps]) => reps.map((rep, index) => ({
    taskId,
    repetition: index + 1,
    status: 'complete',
    conditions: {
      on: {
        outcome: rep[0] ? 'success' : 'failure',
        inputTokens: metrics.onInput ?? 200,
        outputTokens: 20,
        costUsd: metrics.onCost ?? 0.2,
        durationMs: 1000,
      },
      off: {
        outcome: rep[1] ? 'success' : 'failure',
        inputTokens: metrics.offInput ?? 100,
        outputTokens: 10,
        costUsd: metrics.offCost ?? 0.1,
        durationMs: 1000,
      },
    },
  })));
  return { runId: 'test-run', seed, environmentIntegrity: 'adapter_attested', pairs };
}

/** n identical tasks, each with the given per-repetition outcomes. */
function repeatTasks(count, reps) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`task${index}`, reps]));
}

console.log('paired-stats');

// ------------------------------------------------------------- primitives

test('percentile interpolates between order statistics', () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.strictEqual(percentile(sorted, 0), 1);
  assert.strictEqual(percentile(sorted, 1), 5);
  assert.strictEqual(percentile(sorted, 0.5), 3);
  assert.ok(close(percentile(sorted, 0.25), 2));
  assert.strictEqual(percentile([], 0.5), null);
});

test('exact binomial matches hand-computed values', () => {
  // All 6 discordant pairs on one side: 2 * 0.5^6 = 0.03125
  assert.ok(close(exactBinomialTwoSided(6, 6), 0.03125), `got ${exactBinomialTwoSided(6, 6)}`);
  assert.ok(close(exactBinomialTwoSided(0, 6), 0.03125));
  // Perfectly split is never evidence.
  assert.strictEqual(exactBinomialTwoSided(3, 6), 1);
  // 5 of 6: 2 * (C(6,5) + C(6,6)) * 0.5^6 = 2 * 7/64 = 0.21875
  assert.ok(close(exactBinomialTwoSided(5, 6), 0.21875), `got ${exactBinomialTwoSided(5, 6)}`);
  // No discordant pairs carries no information.
  assert.strictEqual(exactBinomialTwoSided(0, 0), 1);
});

test('exact binomial stays in range for large n', () => {
  const p = exactBinomialTwoSided(150, 300);
  assert.ok(p > 0.9 && p <= 1, `expected near 1, got ${p}`);
  assert.ok(exactBinomialTwoSided(300, 300) > 0, 'must not underflow to zero');
});

test('pass@k and pass^k match the closed forms', () => {
  // 1 success in 3 attempts: pass@1 = 1/3, pass@3 = 1 (one of three is drawn).
  assert.ok(close(passAtK(1, 3, 1), 1 / 3));
  assert.ok(close(passAtK(1, 3, 3), 1));
  // 2 successes in 4: pass@2 = 1 - C(2,2)/C(4,2) = 1 - 1/6
  assert.ok(close(passAtK(2, 4, 2), 1 - 1 / 6));
  // pass^k requires all k to succeed.
  assert.ok(close(passCaretK(3, 3, 3), 1));
  assert.strictEqual(passCaretK(2, 3, 3), 0);
  assert.ok(close(passCaretK(2, 4, 2), 1 / 6));
  assert.strictEqual(passAtK(1, 2, 3), null, 'k above the repetition count is undefined');
});

test('the PRNG is deterministic for a given seed', () => {
  const a = Array.from({ length: 5 }, createRandom(42));
  const b = Array.from({ length: 5 }, createRandom(42));
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, Array.from({ length: 5 }, createRandom(43)));
});

// ------------------------------------------------------------ observations

test('incomplete pairs are excluded, not imputed', () => {
  const report = {
    pairs: [
      { taskId: 't', repetition: 1, status: 'complete', conditions: { on: { outcome: 'success' }, off: { outcome: 'failure' } } },
      { taskId: 't', repetition: 2, status: 'skipped', skippedReason: 'cost_limit' },
      { taskId: 't', repetition: 3, status: 'complete', conditions: { on: { outcome: 'success' } } },
    ],
  };
  const { observations, excluded } = extractObservations(report);
  assert.strictEqual(observations.length, 1);
  assert.strictEqual(excluded.length, 2);
  assert.strictEqual(excluded[0].reason, 'cost_limit');
});

test('rejects a report with no pairs array', () => {
  assert.throws(() => extractObservations({}), /pairs array/);
});

test('task grouping computes the paired difference per task', () => {
  const { observations } = extractObservations(buildReport({
    a: [[true, false], [true, false], [false, false]],
    b: [[false, true]],
  }));
  const tasks = groupByTask(observations);
  assert.deepStrictEqual(tasks.map(task => task.taskId), ['a', 'b']);
  assert.ok(close(tasks[0].successRateDiff, 2 / 3));
  assert.strictEqual(tasks[1].successRateDiff, -1);
  assert.strictEqual(tasks[0].repetitions, 3);
});

// --------------------------------------------------------------- bootstrap

test('cluster bootstrap resamples tasks, not repetitions', () => {
  // Two tasks with opposite constant outcomes: any resample yields -1, 0, or 1.
  const tasks = groupByTask(extractObservations(buildReport({
    a: [[true, false], [true, false], [true, false]],
    b: [[false, true], [false, true], [false, true]],
  })).observations);

  const random = createRandom(1);
  const interval = clusterBootstrap(
    tasks,
    resampled => resampled.reduce((total, task) => total + task.successRateDiff, 0) / resampled.length,
    { samples: 500, confidence: 0.95, random }
  );
  // Resampling repetitions would produce many intermediate values; resampling
  // whole tasks can only give -1, 0, or 1.
  assert.ok(interval.lower >= -1 && interval.upper <= 1);
  assert.strictEqual(clusterBootstrap([], () => 0, { samples: 10, confidence: 0.95, random }), null);
});

test('analysis is reproducible for a fixed seed and varies with the seed', () => {
  const report = buildReport(repeatTasks(15, [[true, false], [false, false], [true, true]]));
  const a = analyzePairedReport(report, { samples: 400, seed: 5 });
  const b = analyzePairedReport(report, { samples: 400, seed: 5 });
  assert.deepStrictEqual(a.quality.ci, b.quality.ci);
  const c = analyzePairedReport(report, { samples: 400, seed: 6 });
  assert.strictEqual(typeof c.quality.ci.lower, 'number');
});

// ----------------------------------------------------------------- verdict

test('refuses a verdict below the cluster floor', () => {
  // The defect this guards: one task makes the bootstrap collapse to a point,
  // which reads as certainty.
  const report = buildReport({ only: [[false, true]] });
  const analysis = analyzePairedReport(report, { samples: 200 });
  assert.strictEqual(analysis.quality.verdict, 'insufficient_data');
  assert.match(analysis.quality.rule, /below the 15-task floor/);
  assert.strictEqual(analysis.quality.ci.lower, analysis.quality.ci.upper, 'the interval is degenerate');
});

test('the cluster floor is configurable', () => {
  const report = buildReport(repeatTasks(3, [[false, true]]));
  assert.strictEqual(analyzePairedReport(report, { samples: 200 }).quality.verdict, 'insufficient_data');
  assert.strictEqual(
    analyzePairedReport(report, { samples: 200, minClusters: 2 }).quality.verdict,
    'degradation'
  );
  assert.strictEqual(DEFAULT_MIN_CLUSTERS, 15);
});

test('decideVerdict maps intervals onto the registered rule', () => {
  const opts = { clusters: 20, minClusters: 15 };
  assert.strictEqual(decideVerdict({ lower: 0.02, upper: 0.10 }, 3, opts).verdict, 'improvement');
  assert.strictEqual(decideVerdict({ lower: -0.01, upper: 0.05 }, 3, opts).verdict, 'non_inferior');
  assert.strictEqual(decideVerdict({ lower: -0.20, upper: -0.05 }, 3, opts).verdict, 'degradation');
  assert.strictEqual(decideVerdict({ lower: -0.10, upper: 0.05 }, 3, opts).verdict, 'inconclusive');
  assert.strictEqual(decideVerdict(null, 3, opts).verdict, 'insufficient_data');
});

test('identical conditions yield a non-inferior verdict, not an improvement', () => {
  const analysis = analyzePairedReport(
    buildReport(repeatTasks(15, [[true, true], [false, false], [true, true]])),
    { samples: 400 }
  );
  assert.strictEqual(analysis.quality.pointEstimate, 0);
  assert.strictEqual(analysis.quality.verdict, 'non_inferior');
});

test('a uniform harness win is reported as an improvement', () => {
  const analysis = analyzePairedReport(
    buildReport(repeatTasks(15, [[true, false], [true, false]])),
    { samples: 400 }
  );
  assert.strictEqual(analysis.quality.verdict, 'improvement');
  assert.strictEqual(analysis.quality.taskLevelSignTest.onBetter, 15);
  assert.ok(analysis.quality.taskLevelSignTest.pValue < 0.001);
});

// -------------------------------------------------------------- efficiency

test('efficiency is gated on the quality verdict', () => {
  const degraded = analyzePairedReport(
    buildReport(repeatTasks(15, [[false, true], [false, true]])),
    { samples: 400 }
  );
  assert.strictEqual(degraded.quality.verdict, 'degradation');
  assert.strictEqual(degraded.efficiency.gated, false, 'a condition that fails cheaply must not look efficient');

  const fine = analyzePairedReport(
    buildReport(repeatTasks(15, [[true, true], [true, true]])),
    { samples: 400 }
  );
  assert.strictEqual(fine.efficiency.gated, true);
});

test('efficiency ratios reflect the underlying metrics', () => {
  const analysis = analyzePairedReport(
    buildReport(repeatTasks(15, [[true, true]]), { metrics: { onInput: 300, offInput: 100 } }),
    { samples: 400 }
  );
  assert.ok(close(analysis.efficiency.ratios.inputTokens.ratio, 3), 'on/off input token ratio');
  assert.ok(close(analysis.efficiency.ratios.durationMs.ratio, 1));
});

test('cost-of-pass is undefined when a condition never succeeds', () => {
  const analysis = analyzePairedReport(
    buildReport(repeatTasks(15, [[false, true]]), { metrics: { onCost: 1, offCost: 0.5 } }),
    { samples: 400 }
  );
  assert.strictEqual(analysis.efficiency.costPerSuccessUsd.on, null, 'zero successes means no cost-of-pass');
  assert.ok(close(analysis.efficiency.costPerSuccessUsd.off, 0.5));
});

test('cost-of-pass divides total cost by successes, not by attempts', () => {
  // 15 tasks x 2 reps, on succeeds once per task: 30 attempts, 15 successes.
  const analysis = analyzePairedReport(
    buildReport(repeatTasks(15, [[true, true], [false, true]]), { metrics: { onCost: 1 } }),
    { samples: 400 }
  );
  assert.ok(close(analysis.efficiency.costPerSuccessUsd.on, 2), 'two attempts of cost 1 per success');
});

// ------------------------------------------------------------------ strata

test('strata split by task metadata', () => {
  const report = buildReport({
    ...repeatTasks(8, [[true, false]]),
    hard0: [[false, false]],
    hard1: [[false, false]],
  });
  const taskMetadata = {
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`task${i}`, { difficulty: 'medium' }])),
    hard0: { difficulty: 'hard' },
    hard1: { difficulty: 'hard' },
  };
  const analysis = analyzePairedReport(report, { samples: 200, taskMetadata });
  const byDifficulty = Object.fromEntries(analysis.strata.difficulty.map(row => [row.group, row]));
  assert.strictEqual(byDifficulty.medium.tasks, 8);
  assert.strictEqual(byDifficulty.hard.tasks, 2);
  assert.strictEqual(byDifficulty.medium.meanDiff, 1);
  assert.strictEqual(byDifficulty.hard.meanDiff, 0);
});

test('an empty report yields insufficient data rather than throwing', () => {
  const analysis = analyzePairedReport({ pairs: [] }, { samples: 100 });
  assert.strictEqual(analysis.design.tasks, 0);
  assert.strictEqual(analysis.quality.verdict, 'insufficient_data');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
