#!/usr/bin/env node
'use strict';

/**
 * Power / minimum-detectable-effect analysis for the registered design.
 *
 * This should have been run before building the apparatus, not after. The
 * protocol registers 15 tasks x 3 repetitions against a 3 pp non-inferiority
 * margin and defers power analysis to "once pilot variance is known" — but if
 * the design cannot resolve a verdict at any plausible effect size, the pilot
 * spends real money to return `inconclusive`.
 *
 * There is no closed form for this: the decision rule is a percentile cluster
 * bootstrap plus a margin comparison plus a sign-test corroboration check. So
 * simulate the actual procedure. Every number below comes from running
 * analyzePairedReport() on synthetic reports, not from a textbook formula.
 *
 * Usage:
 *   node benchmarks/power-analysis.js               # registered design
 *   node benchmarks/power-analysis.js --json
 *   node benchmarks/power-analysis.js --tasks 30 --reps 5
 */

const { analyzePairedReport, DEFAULT_MARGIN_PP } = require('./lib/paired-stats');

// Enough bootstrap draws to be admissible, few enough to sweep in seconds.
// Fewer draws widen intervals slightly, so reported power is a lower bound.
const SIM_BOOTSTRAP_SAMPLES = 1000;
const DEFAULT_SIMULATIONS = 400;

/** Deterministic PRNG so the whole analysis is reproducible. */
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

const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * One synthetic run.
 *
 * Task difficulty is heterogeneous — that is the whole reason tasks are the
 * cluster unit — so each task draws its own baseline success rate, and the
 * treatment shifts it by `effect`.
 */
function simulateReport({ tasks, reps, effect, baseMean, baseSpread, random }) {
  const pairs = [];
  for (let taskIndex = 0; taskIndex < tasks; taskIndex += 1) {
    const base = clamp01(baseMean + (random() - 0.5) * 2 * baseSpread);
    const treated = clamp01(base + effect);
    for (let repetition = 1; repetition <= reps; repetition += 1) {
      pairs.push({
        taskId: `task-${taskIndex}`,
        repetition,
        status: 'complete',
        conditions: {
          on: { outcome: random() < treated ? 'success' : 'failure', costUsd: 0.4, inputTokens: 110000, outputTokens: 1500, durationMs: 60000 },
          off: { outcome: random() < base ? 'success' : 'failure', costUsd: 0.3, inputTokens: 90000, outputTokens: 1500, durationMs: 60000 },
        },
      });
    }
  }
  return { runId: 'sim', seed: 1, environmentIntegrity: 'adapter_attested', pairs };
}

function runScenario({ tasks, reps, effect, baseMean, baseSpread, simulations, marginPp, seed }) {
  const random = createRandom(seed);
  const verdicts = { improvement: 0, non_inferior: 0, inconclusive: 0, degradation: 0, insufficient_data: 0 };
  let corroborated = 0;
  let directional = 0;

  for (let index = 0; index < simulations; index += 1) {
    const report = simulateReport({ tasks, reps, effect, baseMean, baseSpread, random });
    const analysis = analyzePairedReport(report, {
      samples: SIM_BOOTSTRAP_SAMPLES,
      marginPp,
      minClusters: tasks,
      seed: 1 + index,
    });
    verdicts[analysis.quality.verdict] += 1;
    if (analysis.quality.corroboration?.applicable) {
      directional += 1;
      if (analysis.quality.corroboration.agrees) corroborated += 1;
    }
  }

  return {
    effectPp: Math.round(effect * 1000) / 10,
    ...Object.fromEntries(Object.entries(verdicts).map(([key, count]) => [key, count / simulations])),
    corroborationRate: directional === 0 ? null : corroborated / directional,
  };
}

function parseArgs(argv) {
  const args = { tasks: 15, reps: 3, simulations: DEFAULT_SIMULATIONS, marginPp: DEFAULT_MARGIN_PP, json: false, seed: 20260803 };
  for (let index = 0; index < argv.length; index += 1) {
    const next = () => argv[++index];
    if (argv[index] === '--tasks') args.tasks = Number(next());
    else if (argv[index] === '--reps') args.reps = Number(next());
    else if (argv[index] === '--simulations') args.simulations = Number(next());
    else if (argv[index] === '--margin-pp') args.marginPp = Number(next());
    else if (argv[index] === '--seed') args.seed = Number(next());
    else if (argv[index] === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

const pct = value => (value === null ? '  n/a' : `${(value * 100).toFixed(0).padStart(4)}%`);

function main() {
  const args = parseArgs(process.argv.slice(2));
  // Base rates around 0.6 with wide task-to-task spread: the corpus is
  // deliberately mixed-difficulty, so heterogeneity is expected, not a
  // pessimistic assumption.
  const baseMean = 0.6;
  const baseSpread = 0.3;
  const effects = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40];

  const rows = effects.map((effect, index) => runScenario({
    ...args, effect, baseMean, baseSpread, seed: args.seed + index * 7919,
  }));

  if (args.json) {
    console.log(JSON.stringify({ design: args, baseMean, baseSpread, rows }, null, 2));
    return 0;
  }

  console.log('Power analysis — simulated against the actual decision rule');
  console.log('='.repeat(72));
  console.log(`design            ${args.tasks} tasks x ${args.reps} repetitions, margin ${args.marginPp} pp`);
  console.log(`simulations       ${args.simulations} per effect size, ${SIM_BOOTSTRAP_SAMPLES} bootstrap draws`);
  console.log(`baseline          success rate ~${baseMean} +/- ${baseSpread} across tasks`);
  console.log('');
  console.log('true effect | improve | non-inf | inconcl | degrade | sign-test agrees');
  console.log('-'.repeat(72));
  for (const row of rows) {
    console.log(
      `${String(row.effectPp).padStart(8)} pp |`
      + ` ${pct(row.improvement)} |`
      + ` ${pct(row.non_inferior)} |`
      + ` ${pct(row.inconclusive)} |`
      + ` ${pct(row.degradation)} |`
      + ` ${pct(row.corroborationRate)}`
    );
  }

  const detectable = rows.find(row => row.effectPp > 0 && row.improvement >= 0.8);
  console.log('');
  console.log(detectable
    ? `MDE at 80% power: ${detectable.effectPp} pp`
    : `MDE at 80% power: NOT REACHED within ${rows[rows.length - 1].effectPp} pp — this design cannot`
      + ' reliably return "improvement" at any effect size tested.');

  const nullRow = rows[0];
  console.log(`False "improvement" rate under a true zero effect: ${(nullRow.improvement * 100).toFixed(1)}%`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`power-analysis: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runScenario, simulateReport };
