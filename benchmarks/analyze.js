#!/usr/bin/env node
'use strict';

/**
 * Statistical analysis of a paired harness benchmark report.
 *
 * Registered protocol: docs/research/harness-evidence-protocol-2026-08.md §7
 *
 * The runner reports raw pair counts. This turns them into the quantities the
 * protocol requires before any claim may be made: a cluster-bootstrap interval,
 * an exact test, cost-of-pass, and a verdict against the registered margin.
 *
 * Usage:
 *   node benchmarks/analyze.js --report run.json [--suite s.json]
 *                                            [--json] [--samples N] [--seed N]
 *                                            [--margin-pp N]
 *
 * Exit code is 1 when the verdict is `degradation`, so CI can gate on it.
 */

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_BOOTSTRAP_SAMPLES,
  DEFAULT_MARGIN_PP,
  analyzePairedReport,
} = require('./lib/paired-stats');

const DEFAULT_SUITE = path.resolve(__dirname, '../docs/evals/model-performance-tasks.json');

function parseArgs(argv) {
  const args = { json: false, samples: DEFAULT_BOOTSTRAP_SAMPLES, marginPp: DEFAULT_MARGIN_PP };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };
    if (arg === '--report') args.reportPath = value();
    else if (arg === '--suite') args.suitePath = value();
    else if (arg === '--samples') args.samples = Number(value());
    else if (arg === '--seed') args.seed = Number(value());
    else if (arg === '--margin-pp') args.marginPp = Number(value());
    else if (arg === '--min-clusters') args.minClusters = Number(value());
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadTaskMetadata(suitePath) {
  if (!fs.existsSync(suitePath)) return {};
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  return (suite.tasks || []).reduce((map, task) => ({
    ...map,
    [task.id]: { stratum: task.stratum, difficulty: task.difficulty, omf_neutral: task.omf_neutral },
  }), {});
}

const pp = value => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)} pp`);
const pct = value => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const usd = value => (value === null || value === undefined ? 'n/a (no successes)' : `$${value.toFixed(4)}`);
const ratio = value => (value === null || value === undefined ? 'n/a' : `${value.toFixed(3)}x`);

const VERDICT_LABEL = {
  improvement: 'IMPROVEMENT — the harness raised task success',
  non_inferior: 'NON-INFERIOR — no quality loss beyond the registered margin',
  degradation: 'DEGRADATION — the harness lowered task success',
  inconclusive: 'INCONCLUSIVE — the interval spans both zero and the margin',
  insufficient_data: 'INSUFFICIENT DATA',
};

function renderInterval(interval) {
  if (!interval) return 'n/a';
  return `[${pp(interval.lower)}, ${pp(interval.upper)}]`;
}

function renderRatioInterval(entry) {
  if (!entry?.ci) return ratio(entry?.ratio);
  return `${ratio(entry.ratio)}  95% CI [${entry.ci.lower.toFixed(3)}, ${entry.ci.upper.toFixed(3)}]`;
}

function renderText(analysis) {
  const { design, quality, efficiency, safety, strata } = analysis;
  const lines = [];

  lines.push('Paired harness benchmark — statistical analysis');
  lines.push('='.repeat(62));
  lines.push(`run                ${analysis.runId ?? 'n/a'}`);
  lines.push(`tasks / pairs      ${design.tasks} tasks, ${design.completePairs} complete pairs`
    + (design.excludedPairs > 0 ? `, ${design.excludedPairs} excluded` : ''));
  lines.push(`repetitions/task   ${design.repetitionsPerTask.join(', ')}`);
  lines.push(`cluster unit       ${design.clusterUnit} (repetitions are not independent)`);
  lines.push(`bootstrap          ${design.bootstrapSamples} resamples, seed ${design.bootstrapSeed}`);
  lines.push(`integrity          ${design.environmentIntegrity ?? 'unknown'}`);

  if (design.environmentIntegrity !== 'adapter_attested') {
    lines.push('  WARNING: not an isolation-verified run; barred from product claims.');
  }

  if (!analysis.protocolCompliant) {
    lines.push('');
    lines.push('*** NOT A PRE-REGISTERED RESULT ***');
    for (const deviation of analysis.protocolDeviations) lines.push(`  overridden: ${deviation}`);
    lines.push('  This output must not be quoted as a protocol result.');
  }

  lines.push('');
  lines.push(`QUALITY  ${VERDICT_LABEL[quality.verdict] ?? quality.verdict}`);
  lines.push('-'.repeat(62));
  lines.push(`success diff (on - off)   ${pp(quality.pointEstimate)}   95% CI ${renderInterval(quality.ci)}`);
  lines.push(`decision rule             ${quality.rule}  (margin ${design.marginPp} pp)`);
  lines.push(`success rate              on ${pct(quality.on.successRateByTask)}  |  off ${pct(quality.off.successRateByTask)}`);

  if (quality.corroboration?.applicable && !quality.corroboration.agrees) {
    lines.push(`  ! ${quality.corroboration.note}`);
  }

  const sign = quality.taskLevelSignTest;
  lines.push(`sign test (by task)       on better ${sign.onBetter}, off better ${sign.offBetter}, ties ${sign.ties}, p = ${sign.pValue.toFixed(4)}`);
  const mcnemar = quality.pairLevelMcNemar;
  lines.push(`McNemar (by pair)         ${mcnemar.onOnly}/${mcnemar.offOnly} discordant, p = ${mcnemar.pValue.toFixed(4)}  [anti-conservative]`);

  const passKeys = Object.keys(quality.on).filter(key => key.startsWith('pass'));
  if (passKeys.length > 0) {
    lines.push(`${'reliability'.padEnd(25)} ${passKeys.map(key => `${key} on ${pct(quality.on[key])} / off ${pct(quality.off[key])}`).join('   ')}`);
  }

  lines.push('');
  lines.push('EFFICIENCY');
  lines.push('-'.repeat(62));
  if (!efficiency.gated) {
    lines.push(`  Not interpretable: quality verdict is "${efficiency.gateReason}".`);
    lines.push('  A condition that fails cheaply would look efficient.');
  }
  for (const [metric, entry] of Object.entries(efficiency.ratios)) {
    lines.push(`  ${metric.padEnd(14)} ${renderRatioInterval(entry)}`);
  }
  lines.push(`  ${'cost-of-pass'.padEnd(14)} on ${usd(efficiency.costPerSuccessUsd.on)}  |  off ${usd(efficiency.costPerSuccessUsd.off)}`);

  lines.push('');
  lines.push('SAFETY');
  lines.push('-'.repeat(62));
  lines.push(`  timeouts             on ${safety.onTimeouts}  |  off ${safety.offTimeouts}`);
  lines.push(`  human intervention   on ${safety.onHumanIntervention}  |  off ${safety.offHumanIntervention}`);

  for (const [label, rows] of Object.entries(strata)) {
    if (rows.length <= 1) continue;
    lines.push('');
    lines.push(`BY ${label.toUpperCase()}`);
    lines.push('-'.repeat(62));
    for (const row of rows) {
      lines.push(`  ${row.group.padEnd(22)} n=${String(row.tasks).padStart(2)}  on ${pct(row.onSuccessRate).padStart(6)}  off ${pct(row.offSuccessRate).padStart(6)}  diff ${pp(row.meanDiff)}`);
    }
  }

  if (design.tasks < 15) {
    lines.push('');
    lines.push(`NOTE: ${design.tasks} tasks is below the registered pilot minimum of 15.`);
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.reportPath) {
    console.log('Usage: node benchmarks/analyze.js --report <file> [--suite <file>] [--json] [--samples N] [--seed N] [--margin-pp N]');
    return args.help ? 0 : 1;
  }

  const report = JSON.parse(fs.readFileSync(path.resolve(args.reportPath), 'utf8'));
  const taskMetadata = loadTaskMetadata(path.resolve(args.suitePath || DEFAULT_SUITE));

  const analysis = analyzePairedReport(report, {
    taskMetadata,
    samples: args.samples,
    seed: args.seed,
    marginPp: args.marginPp,
    ...(Number.isInteger(args.minClusters) ? { minClusters: args.minClusters } : {}),
  });

  console.log(args.json ? JSON.stringify(analysis, null, 2) : renderText(analysis));

  // Only a measured degradation is a failure; inconclusive is a valid outcome.
  // A run analyzed with overridden parameters must never drive a CI gate: it
  // would let a caller tune the margin until the build goes green.
  if (!analysis.protocolCompliant) return 0;
  return analysis.quality.verdict === 'degradation' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`analyze-paired-benchmark: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { renderText, loadTaskMetadata };
