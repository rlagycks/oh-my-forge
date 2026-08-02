'use strict';

/**
 * Statistical analysis for paired harness benchmarks.
 *
 * Registered protocol: docs/research/harness-evidence-protocol-2026-08.md §7
 *
 * The unit of independence is the TASK, not the repetition. Repetitions of one
 * task share its difficulty, so treating them as independent understates the
 * standard error — by up to roughly 3x per Miller, "Adding Error Bars to Evals"
 * (arXiv 2411.00640). Every interval here therefore resamples tasks, and the
 * point estimate weights each task equally rather than each repetition.
 *
 * Deterministic: the bootstrap uses a seeded PRNG, so the same report and seed
 * always produce the same interval.
 */

const DEFAULT_BOOTSTRAP_SAMPLES = 10000;
const DEFAULT_CONFIDENCE = 0.95;
/** Registered non-inferiority margin, in percentage points. */
const DEFAULT_MARGIN_PP = 3;
/**
 * Minimum number of clusters (tasks) before a verdict may be issued.
 *
 * A percentile cluster bootstrap resamples whole tasks, so with k tasks it can
 * only ever produce k distinct values. At k = 1 every resample is the same task
 * and the interval collapses to a point, which reads as certainty when it is
 * the opposite. The floor is tied to the registered pilot design of >= 15
 * tasks: below that the run is a smoke test, not an experiment.
 */
const DEFAULT_MIN_CLUSTERS = 15;

// ---------------------------------------------------------------- primitives

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Lanczos log-gamma; used so binomial terms stay in range for large n. */
function logGamma(x) {
  // Lanczos g=5, n=6. Written in canonical double form so the literals
  // round-trip exactly.
  const coefficients = [
    76.18009172947146, -86.50532032941678, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * series) / x);
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Two-sided exact binomial test against p = 0.5.
 *
 * Used for both the task-level sign test and the pair-level McNemar test.
 */
function exactBinomialTwoSided(successes, trials) {
  if (trials === 0) return 1;
  const extreme = Math.max(successes, trials - successes);
  let tail = 0;
  for (let k = extreme; k <= trials; k += 1) {
    tail += Math.exp(logChoose(trials, k) + trials * Math.log(0.5));
  }
  return Math.min(1, 2 * tail);
}

/**
 * Unbiased pass@k over r repetitions with s successes (Chen et al., 2021).
 * Probability that at least one of k sampled attempts succeeds.
 */
function passAtK(successes, repetitions, k) {
  if (k > repetitions) return null;
  if (repetitions - successes < k) return 1;
  return 1 - Math.exp(logChoose(repetitions - successes, k) - logChoose(repetitions, k));
}

/** Probability that all k sampled attempts succeed. */
function passCaretK(successes, repetitions, k) {
  if (k > repetitions) return null;
  if (successes < k) return 0;
  return Math.exp(logChoose(successes, k) - logChoose(repetitions, k));
}

// ------------------------------------------------------------- observations

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Flatten a paired report into per-pair observations.
 *
 * Incomplete pairs are excluded rather than imputed: a pair where only one
 * condition ran carries no paired information and, because cost limits stop the
 * cheaper condition last, imputing it would bias the comparison.
 */
function extractObservations(report) {
  if (!isPlainObject(report) || !Array.isArray(report.pairs)) {
    throw new Error('report must contain a pairs array');
  }

  const excluded = [];
  const observations = report.pairs.flatMap(pair => {
    if (pair.status !== 'complete' || !pair.conditions?.on || !pair.conditions?.off) {
      excluded.push({ taskId: pair.taskId, repetition: pair.repetition, reason: pair.skippedReason || pair.status || 'incomplete' });
      return [];
    }
    const build = side => ({
      success: side.outcome === 'success',
      inputTokens: readNumber(side.inputTokens),
      outputTokens: readNumber(side.outputTokens),
      costUsd: readNumber(side.costUsd),
      durationMs: readNumber(side.durationMs),
      humanIntervention: side.humanIntervention === true,
      timedOut: side.timedOut === true,
    });
    return [{
      taskId: pair.taskId,
      repetition: pair.repetition,
      on: build(pair.conditions.on),
      off: build(pair.conditions.off),
    }];
  });

  return { observations, excluded };
}

const METRICS = Object.freeze(['inputTokens', 'outputTokens', 'costUsd', 'durationMs']);

function summarizeTask(taskId, rows) {
  const repetitions = rows.length;
  const onSuccesses = rows.filter(row => row.on.success).length;
  const offSuccesses = rows.filter(row => row.off.success).length;

  const metricMeans = METRICS.reduce((acc, metric) => {
    const onValues = rows.map(row => row.on[metric]).filter(value => value !== null);
    const offValues = rows.map(row => row.off[metric]).filter(value => value !== null);
    return { ...acc, [metric]: { on: mean(onValues), off: mean(offValues) } };
  }, {});

  return {
    taskId,
    repetitions,
    on: { successes: onSuccesses, successRate: onSuccesses / repetitions },
    off: { successes: offSuccesses, successRate: offSuccesses / repetitions },
    // Task-level paired difference: the quantity every interval is built from.
    successRateDiff: (onSuccesses - offSuccesses) / repetitions,
    metricMeans,
    cleanOn: rows.filter(row => row.on.success && !row.on.humanIntervention).length,
    cleanOff: rows.filter(row => row.off.success && !row.off.humanIntervention).length,
  };
}

function groupByTask(observations) {
  const byTask = observations.reduce((map, row) => {
    const rows = map.get(row.taskId) || [];
    return map.set(row.taskId, [...rows, row]);
  }, new Map());

  return [...byTask.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([taskId, rows]) => summarizeTask(taskId, rows));
}

// ---------------------------------------------------------------- bootstrap

/**
 * Cluster bootstrap: resample TASKS with replacement, recompute the statistic.
 * Resampling individual repetitions would ignore within-task correlation.
 */
function clusterBootstrap(tasks, statistic, { samples, confidence, random }) {
  if (tasks.length === 0) return null;

  const draws = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const resampled = Array.from({ length: tasks.length }, () => tasks[Math.floor(random() * tasks.length)]);
    const value = statistic(resampled);
    if (value !== null && Number.isFinite(value)) draws.push(value);
  }

  if (draws.length === 0) return null;
  const sorted = [...draws].sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;

  return {
    lower: percentile(sorted, alpha),
    upper: percentile(sorted, 1 - alpha),
    samples: draws.length,
  };
}

function ratioStatistic(metric) {
  return tasks => {
    // Ratio of task-mean totals: each task contributes equally regardless of
    // how many repetitions it happened to get.
    const onTotal = sum(tasks.map(task => task.metricMeans[metric].on ?? 0));
    const offTotal = sum(tasks.map(task => task.metricMeans[metric].off ?? 0));
    return offTotal === 0 ? null : onTotal / offTotal;
  };
}

// ------------------------------------------------------------------ verdict

/**
 * Map the CI for (success_on - success_off) onto the registered decision rule.
 *
 * Refuses to issue a verdict when there are too few clusters to support one,
 * rather than reporting a degenerate interval as a finding.
 */
function decideVerdict(interval, marginPp, { clusters = Infinity, minClusters = DEFAULT_MIN_CLUSTERS } = {}) {
  if (interval === null) return { verdict: 'insufficient_data', rule: 'no interval could be computed' };
  if (clusters < minClusters) {
    return {
      verdict: 'insufficient_data',
      rule: `${clusters} task${clusters === 1 ? '' : 's'} is below the ${minClusters}-task floor; the interval shown is descriptive only`,
    };
  }

  const margin = -marginPp / 100;

  if (interval.lower > 0) {
    return { verdict: 'improvement', rule: 'CI lower bound > 0' };
  }
  if (interval.upper < margin) {
    return { verdict: 'degradation', rule: `CI upper bound < ${marginPp} pp below zero` };
  }
  if (interval.lower > margin) {
    return { verdict: 'non_inferior', rule: `CI lower bound within ${marginPp} pp of zero` };
  }
  return { verdict: 'inconclusive', rule: 'CI spans both zero and the margin' };
}

// ------------------------------------------------------------------ analysis

function costPerSuccess(tasks, side) {
  const successes = sum(tasks.map(task => task[side].successes));
  if (successes === 0) return null;
  const totalCost = sum(tasks.map(task => (task.metricMeans.costUsd[side] ?? 0) * task.repetitions));
  return totalCost / successes;
}

function summarizeCondition(tasks, side) {
  const attempted = sum(tasks.map(task => task.repetitions));
  const successes = sum(tasks.map(task => task[side].successes));
  return {
    attempted,
    successes,
    // Per-repetition rate, for reference only; inference uses task-level means.
    successRatePooled: attempted === 0 ? null : successes / attempted,
    successRateByTask: mean(tasks.map(task => task[side].successRate)),
    cleanSuccesses: sum(tasks.map(task => (side === 'on' ? task.cleanOn : task.cleanOff))),
    costPerSuccessUsd: costPerSuccess(tasks, side),
    ...METRICS.reduce((acc, metric) => ({
      ...acc,
      [metric]: sum(tasks.map(task => (task.metricMeans[metric][side] ?? 0) * task.repetitions)),
    }), {}),
  };
}

function passAtKSummary(tasks, side) {
  const minRepetitions = Math.min(...tasks.map(task => task.repetitions));
  const ks = [1, 3].filter(k => k <= minRepetitions);

  return ks.reduce((acc, k) => ({
    ...acc,
    [`pass@${k}`]: mean(tasks.map(task => passAtK(task[side].successes, task.repetitions, k))),
    [`pass^${k}`]: mean(tasks.map(task => passCaretK(task[side].successes, task.repetitions, k))),
  }), {});
}

function pairLevelMcNemar(observations) {
  const onOnly = observations.filter(row => row.on.success && !row.off.success).length;
  const offOnly = observations.filter(row => !row.on.success && row.off.success).length;
  return {
    onOnly,
    offOnly,
    discordant: onOnly + offOnly,
    pValue: exactBinomialTwoSided(onOnly, onOnly + offOnly),
    caveat: 'Treats repetitions of one task as independent, so this p-value is anti-conservative. The task-level sign test is the cluster-valid analogue.',
  };
}

/**
 * Cross-check a directional verdict against the cluster-level exact test.
 *
 * The registered decision rule is the bootstrap interval, but the sign test
 * discards magnitude and is more conservative, so the two can disagree. A
 * directional claim the exact test does not support must be labelled, not
 * quietly reported as a finding.
 */
function corroborate(verdict, signTest, alpha = 0.05) {
  const directional = verdict === 'improvement' || verdict === 'degradation';
  if (!directional) return { applicable: false, agrees: null, note: 'no directional claim to corroborate' };

  const agrees = signTest.pValue < alpha;
  return {
    applicable: true,
    agrees,
    alpha,
    note: agrees
      ? `the task-level sign test agrees (p = ${signTest.pValue.toFixed(4)})`
      : `NOT corroborated: the interval supports "${verdict}" but the task-level sign test does not reach p < ${alpha} (p = ${signTest.pValue.toFixed(4)}). Report the direction as suggestive, not established.`,
  };
}

function taskLevelSignTest(tasks) {
  const onBetter = tasks.filter(task => task.successRateDiff > 0).length;
  const offBetter = tasks.filter(task => task.successRateDiff < 0).length;
  return {
    onBetter,
    offBetter,
    ties: tasks.length - onBetter - offBetter,
    pValue: exactBinomialTwoSided(onBetter, onBetter + offBetter),
  };
}

function stratify(tasks, taskMetadata, key) {
  const groups = tasks.reduce((map, task) => {
    const value = taskMetadata[task.taskId]?.[key];
    const label = value === undefined ? 'unknown' : String(value);
    return map.set(label, [...(map.get(label) || []), task]);
  }, new Map());

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, group]) => ({
      group: label,
      tasks: group.length,
      onSuccessRate: mean(group.map(task => task.on.successRate)),
      offSuccessRate: mean(group.map(task => task.off.successRate)),
      meanDiff: mean(group.map(task => task.successRateDiff)),
    }));
}

/**
 * Analyze a paired benchmark report.
 *
 * @param {object} report                Parsed paired-benchmark report JSON.
 * @param {object} [options]
 * @param {object} [options.taskMetadata] taskId -> { stratum, difficulty, omf_neutral }
 * @param {number} [options.samples]      Bootstrap resamples.
 * @param {number} [options.seed]         PRNG seed; defaults to the report seed.
 * @param {number} [options.marginPp]     Non-inferiority margin in points.
 * @param {number} [options.confidence]   Interval confidence level.
 */
function analyzePairedReport(report, options = {}) {
  const {
    taskMetadata = {},
    samples = DEFAULT_BOOTSTRAP_SAMPLES,
    marginPp = DEFAULT_MARGIN_PP,
    confidence = DEFAULT_CONFIDENCE,
    minClusters = DEFAULT_MIN_CLUSTERS,
  } = options;
  const seed = Number.isInteger(options.seed) ? options.seed : (Number.isInteger(report?.seed) ? report.seed : 1);

  // A run analyzed with anything other than the registered parameters is no
  // longer a pre-registered result and must not be labelled as one.
  const deviations = [
    ...(marginPp === DEFAULT_MARGIN_PP ? [] : [`marginPp ${marginPp} (registered ${DEFAULT_MARGIN_PP})`]),
    ...(minClusters === DEFAULT_MIN_CLUSTERS ? [] : [`minClusters ${minClusters} (registered ${DEFAULT_MIN_CLUSTERS})`]),
    ...(confidence === DEFAULT_CONFIDENCE ? [] : [`confidence ${confidence} (registered ${DEFAULT_CONFIDENCE})`]),
  ];
  const protocolCompliant = deviations.length === 0;

  const { observations, excluded } = extractObservations(report);
  const tasks = groupByTask(observations);

  if (tasks.length === 0) {
    return {
      schemaVersion: 1,
      runId: report.runId ?? null,
      protocolCompliant,
      protocolDeviations: deviations,
      design: { tasks: 0, completePairs: 0, excludedPairs: excluded.length, excluded },
      quality: { verdict: 'insufficient_data', rule: 'no complete pairs' },
    };
  }

  const random = createRandom(seed);
  const bootstrapOptions = { samples, confidence, random };

  const successInterval = clusterBootstrap(
    tasks,
    resampled => mean(resampled.map(task => task.successRateDiff)),
    bootstrapOptions
  );

  const pointEstimate = mean(tasks.map(task => task.successRateDiff));
  const decision = decideVerdict(successInterval, marginPp, { clusters: tasks.length, minClusters });

  const efficiency = METRICS.reduce((acc, metric) => {
    const statistic = ratioStatistic(metric);
    return {
      ...acc,
      [metric]: {
        ratio: statistic(tasks),
        ci: clusterBootstrap(tasks, statistic, bootstrapOptions),
      },
    };
  }, {});

  const onSummary = summarizeCondition(tasks, 'on');
  const offSummary = summarizeCondition(tasks, 'off');
  const signTest = taskLevelSignTest(tasks);

  return {
    schemaVersion: 1,
    runId: report.runId ?? null,
    // Only a compliant run may cite the registered protocol.
    protocol: protocolCompliant ? 'docs/research/harness-evidence-protocol-2026-08.md' : null,
    protocolCompliant,
    protocolDeviations: deviations,
    design: {
      tasks: tasks.length,
      completePairs: observations.length,
      excludedPairs: excluded.length,
      excluded,
      repetitionsPerTask: [...new Set(tasks.map(task => task.repetitions))].sort((a, b) => a - b),
      bootstrapSamples: samples,
      bootstrapSeed: seed,
      confidence,
      marginPp,
      minClusters,
      clusterUnit: 'task',
      environmentIntegrity: report.environmentIntegrity ?? null,
      guards: report.guards ?? null,
      snapshot: report.snapshot ?? null,
      providers: report.providers ?? null,
    },
    quality: {
      pointEstimate,
      ci: successInterval,
      ...decision,
      corroboration: corroborate(decision.verdict, signTest),
      taskLevelSignTest: signTest,
      pairLevelMcNemar: pairLevelMcNemar(observations),
      on: { ...onSummary, ...passAtKSummary(tasks, 'on') },
      off: { ...offSummary, ...passAtKSummary(tasks, 'off') },
    },
    efficiency: {
      // Efficiency is only interpretable once quality is non-inferior: a
      // condition that fails fast looks cheap.
      gated: decision.verdict === 'improvement' || decision.verdict === 'non_inferior',
      gateReason: decision.verdict,
      ratios: efficiency,
      costPerSuccessUsd: { on: onSummary.costPerSuccessUsd, off: offSummary.costPerSuccessUsd },
    },
    safety: {
      onTimeouts: observations.filter(row => row.on.timedOut).length,
      offTimeouts: observations.filter(row => row.off.timedOut).length,
      onHumanIntervention: observations.filter(row => row.on.humanIntervention).length,
      offHumanIntervention: observations.filter(row => row.off.humanIntervention).length,
    },
    strata: {
      stratum: stratify(tasks, taskMetadata, 'stratum'),
      difficulty: stratify(tasks, taskMetadata, 'difficulty'),
      omfNeutral: stratify(tasks, taskMetadata, 'omf_neutral'),
    },
    tasks,
  };
}

module.exports = {
  DEFAULT_BOOTSTRAP_SAMPLES,
  DEFAULT_CONFIDENCE,
  DEFAULT_MARGIN_PP,
  DEFAULT_MIN_CLUSTERS,
  analyzePairedReport,
  clusterBootstrap,
  corroborate,
  createRandom,
  decideVerdict,
  exactBinomialTwoSided,
  extractObservations,
  groupByTask,
  passAtK,
  passCaretK,
  percentile,
};
