'use strict';

const crypto = require('crypto');
const path = require('path');

const {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  executeVerification,
  findGoldenTask,
  readGoldenTaskSuite,
  recordVerificationOutcome,
} = require('./golden-task-runner');

const DEFAULT_REPETITIONS = 1;
const MAX_REPETITIONS = 100;
const MAX_SEED = 0xffffffff;
const CONDITIONS = Object.freeze(['on', 'off']);
const SENSITIVE_KEY_PATTERN = /prompt|source|context|payload|message|content|raw|output|input|code|stdout|stderr|transcript|response|request|secret|password|token|authorization|credential|cookie|header|api[_-]?key|access[_-]?key|private[_-]?key/i;
const ADAPTER_METADATA_FIELDS = Object.freeze([
  'provider',
  'model',
  'config',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'toolCalls',
  'durationMs',
  'costUsd',
  'humanIntervention',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateNonNegativeNumber(value, field, integer = false) {
  const valid = typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && (!integer || Number.isInteger(value));
  if (!valid) throw new Error(`${field} must be a non-negative ${integer ? 'integer' : 'number'}`);
  return value;
}

function sanitizeConfig(config) {
  if (config === undefined) return undefined;
  if (!isPlainObject(config)) throw new Error('config must be an object');

  const sanitized = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (Array.isArray(value) && value.every(item => (
      item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))
    ))) {
      sanitized[key] = [...value];
    }
  }
  return sanitized;
}

function sanitizeAdapterMetadata(metadata = {}) {
  if (!isPlainObject(metadata)) throw new Error('Adapter result must be an object');
  const sanitized = {};

  for (const field of ADAPTER_METADATA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) continue;
    const value = metadata[field];
    if (field === 'provider' || field === 'model') {
      if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
      sanitized[field] = value;
    } else if (field === 'config') {
      sanitized.config = sanitizeConfig(value);
    } else if (field === 'humanIntervention') {
      if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
      sanitized[field] = value;
    } else {
      sanitized[field] = validateNonNegativeNumber(value, field, field !== 'costUsd' && field !== 'durationMs');
    }
  }

  return sanitized;
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSnapshot(snapshot, snapshotId, snapshotHash) {
  const candidate = snapshot === undefined
    ? { id: snapshotId, hash: snapshotHash }
    : snapshot;
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate === 'string') return { id: candidate };
  if (!isPlainObject(candidate)) throw new Error('snapshot must be an object or string');

  const normalized = {};
  if (typeof candidate.id === 'string' && candidate.id.trim() !== '') normalized.id = candidate.id;
  if (typeof candidate.hash === 'string' && candidate.hash.trim() !== '') normalized.hash = candidate.hash;
  if (Object.keys(normalized).length === 0) throw new Error('snapshot must include a non-empty id or hash');
  return normalized;
}

function hashTask(task) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(task)).digest('hex')}`;
}

function createSeed(seed) {
  if (seed === undefined) return crypto.randomInt(0, MAX_SEED + 1);
  validateNonNegativeNumber(seed, 'seed', true);
  if (seed > MAX_SEED) throw new Error(`seed must be <= ${MAX_SEED}`);
  return seed;
}

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

function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createRunId(seed) {
  return `paired-${Date.now()}-${seed}-${crypto.randomBytes(4).toString('hex')}`;
}

function getAdapterRunner(adapter) {
  if (typeof adapter === 'function') return adapter;
  if (adapter && typeof adapter.run === 'function') return request => adapter.run(request);
  throw new Error('adapter must be a function or an object with a run function');
}

async function runAdapter(adapter, request, timeoutMs) {
  const controller = new AbortController();
  const runner = getAdapterRunner(adapter);
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Adapter timed out');
      error.code = 'ETIMEDOUT';
      controller.abort();
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => runner({ ...request, signal: controller.signal })),
      timeout,
    ]);
    return { result: result || {}, timedOut: false, error: null };
  } catch (error) {
    return {
      result: {},
      timedOut: error?.code === 'ETIMEDOUT',
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildEpisodeId(runId, repetition, taskId, condition) {
  return `${runId}:r${repetition + 1}:${taskId}:${condition}`;
}

function buildMetadata({ metadata, taskHash, snapshot, condition, repetition, seed, runId }) {
  const safeMetadata = sanitizeAdapterMetadata(metadata);
  const reportMetadata = {};
  const eventMetadata = {
    condition,
    harnessEnabled: condition === 'on',
    repetition: repetition + 1,
    seed,
    runId,
    taskHash,
    snapshotId: snapshot?.id || null,
    snapshotHash: snapshot?.hash || null,
  };
  for (const [key, value] of Object.entries(safeMetadata)) {
    const reportKey = key === 'durationMs' ? 'providerDurationMs' : key;
    reportMetadata[reportKey] = value;
    eventMetadata[reportKey] = value;
  }
  return { reportMetadata, eventMetadata };
}

function createAdapterFailureResult(task, error, timedOut, durationMs) {
  return {
    taskId: task.id,
    expectedExitCode: task.verification.expected_exit_code,
    exitCode: null,
    outcome: 'failure',
    testsPassed: false,
    timedOut,
    errorCode: timedOut ? 'ETIMEDOUT' : (error?.code || 'ADAPTER_ERROR'),
    durationMs,
  };
}

function createPairPlan(tasks, repetitions, random, runId) {
  const pairs = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const task of shuffle(tasks, random)) {
      const order = shuffle(CONDITIONS, random);
      pairs.push({
        taskId: task.id,
        taskHash: hashTask(task),
        repetition: repetition + 1,
        order,
        conditions: {},
        complete: false,
        episodeIds: Object.fromEntries(order.map(condition => [
          condition,
          buildEpisodeId(runId, repetition, task.id, condition),
        ])),
      });
    }
  }
  return pairs;
}

function addNumeric(total, value) {
  return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

function summarizeCondition(results) {
  const passed = results.filter(result => result.outcome === 'success').length;
  return {
    attempted: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length > 0 ? Number(((passed / results.length) * 100).toFixed(1)) : null,
    inputTokens: results.reduce((total, result) => addNumeric(total, result.inputTokens), 0),
    outputTokens: results.reduce((total, result) => addNumeric(total, result.outputTokens), 0),
    toolCalls: results.reduce((total, result) => addNumeric(total, result.toolCalls), 0),
    durationMs: results.reduce((total, result) => addNumeric(total, result.durationMs), 0),
    costUsd: Number(results.reduce((total, result) => addNumeric(total, result.costUsd), 0).toFixed(6)),
  };
}

function buildComparison(results, pairs) {
  const completePairs = pairs.filter(pair => pair.complete);
  const conditionResults = condition => results.filter(result => result.condition === condition);
  return {
    pairs: completePairs.length,
    on: summarizeCondition(conditionResults('on')),
    off: summarizeCondition(conditionResults('off')),
    successRateDelta: completePairs.length > 0
      ? Number((summarizeCondition(conditionResults('on')).successRate - summarizeCondition(conditionResults('off')).successRate).toFixed(1))
      : null,
  };
}

function formatValue(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function formatComparison(report) {
  const lines = [
    `Paired benchmark comparison — ${report.suite || 'unnamed suite'}`,
    `Seed: ${report.seed}  Repetitions: ${report.repetitions}  Snapshot: ${report.snapshot?.id || report.snapshot?.hash || 'n/a'}`,
    `Provider(s): ${report.providers.length > 0 ? report.providers.join(', ') : 'n/a'}`,
    `Completed pairs: ${report.comparison.pairs}/${report.pairs.length}  Cost: $${report.limits.costUsd.toFixed(6)}`,
    '',
    'Condition  Attempted  Passed  Success %  Input tokens  Output tokens  Tool calls  Duration ms  Cost USD',
  ];
  for (const condition of CONDITIONS) {
    const summary = report.comparison[condition];
    lines.push([
      condition.padEnd(9),
      String(summary.attempted).padStart(9),
      String(summary.passed).padStart(7),
      formatValue(summary.successRate).padStart(10),
      String(summary.inputTokens).padStart(13),
      String(summary.outputTokens).padStart(14),
      String(summary.toolCalls).padStart(11),
      String(summary.durationMs).padStart(12),
      summary.costUsd.toFixed(6).padStart(9),
    ].join('  '));
  }
  if (report.limits.costExceeded) lines.push('Cost limit reached; remaining pairs were skipped.');
  if (report.limits.timeoutCount > 0) lines.push(`Timeouts: ${report.limits.timeoutCount}`);
  return lines.join('\n');
}

async function runPairedBenchmark(options = {}) {
  const suite = readGoldenTaskSuite(options.suitePath);
  const tasks = options.taskId ? [findGoldenTask(suite, options.taskId)] : suite.tasks;
  if (tasks.some(task => !task)) throw new Error(`Unknown golden task: ${options.taskId}`);
  if (tasks.length === 0) throw new Error('Golden task suite is empty');

  const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
  validateNonNegativeNumber(repetitions, 'repetitions', true);
  if (repetitions < 1 || repetitions > MAX_REPETITIONS) throw new Error(`repetitions must be from 1 to ${MAX_REPETITIONS}`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  validateNonNegativeNumber(timeoutMs, 'timeoutMs', true);
  if (timeoutMs > MAX_TIMEOUT_MS) throw new Error(`timeoutMs must be <= ${MAX_TIMEOUT_MS}`);
  const maxCostUsd = options.maxCostUsd === undefined ? null : options.maxCostUsd;
  if (maxCostUsd !== null) validateNonNegativeNumber(maxCostUsd, 'maxCostUsd');
  const seed = createSeed(options.seed);
  const snapshot = normalizeSnapshot(options.snapshot, options.snapshotId, options.snapshotHash);
  const adapter = getAdapterRunner(options.adapter);
  const runId = options.runId || createRunId(seed);
  const random = createRandom(seed);
  const pairs = createPairPlan(tasks, repetitions, random, runId);
  const results = [];
  let costUsd = 0;
  let costExceeded = false;

  for (const pair of pairs) {
    if (costExceeded) {
      pair.status = 'skipped';
      pair.skippedReason = 'cost_limit';
      continue;
    }
    const task = tasks.find(candidate => candidate.id === pair.taskId);
    for (const condition of pair.order) {
      if (costExceeded) {
        pair.status = 'skipped';
        pair.skippedReason = 'cost_limit';
        break;
      }
      const episodeId = pair.episodeIds[condition];
      const startedAt = Date.now();
      const request = {
        task: cloneValue(task),
        snapshot: snapshot ? cloneValue(snapshot) : null,
        harnessEnabled: condition === 'on',
        condition,
        episodeId,
        repetition: pair.repetition,
        seed,
        timeoutMs,
        remainingCostUsd: maxCostUsd === null ? null : Math.max(0, maxCostUsd - costUsd),
      };
      const adapterRun = await runAdapter(adapter, request, timeoutMs);
      let metadata = {};
      let baseResult;
      if (adapterRun.error) {
        baseResult = createAdapterFailureResult(task, adapterRun.error, adapterRun.timedOut, Date.now() - startedAt);
      } else {
        try {
          metadata = sanitizeAdapterMetadata(adapterRun.result);
          const verification = executeVerification(task, {
            cwd: options.cwd,
            timeoutMs,
          });
          baseResult = {
            ...verification,
            durationMs: Date.now() - startedAt,
            verificationDurationMs: verification.durationMs,
          };
        } catch (error) {
          baseResult = createAdapterFailureResult(task, error, false, Date.now() - startedAt);
          baseResult.errorCode = 'ADAPTER_METADATA_ERROR';
        }
      }

      let builtMetadata;
      try {
        builtMetadata = buildMetadata({
          metadata,
          taskHash: pair.taskHash,
          snapshot,
          condition,
          repetition: pair.repetition - 1,
          seed,
          runId,
        });
      } catch (error) {
        baseResult = createAdapterFailureResult(task, error, false, Date.now() - startedAt);
        baseResult.errorCode = 'ADAPTER_METADATA_ERROR';
        builtMetadata = buildMetadata({
          metadata: {},
          taskHash: pair.taskHash,
          snapshot,
          condition,
          repetition: pair.repetition - 1,
          seed,
          runId,
        });
      }

      recordVerificationOutcome(baseResult, {
        episodeId,
        sessionId: options.sessionId,
        logPath: options.logPath,
        source: 'run-paired-benchmark',
        metadata: {
          ...builtMetadata.eventMetadata,
          verificationDurationMs: baseResult.verificationDurationMs,
        },
      });

      const result = {
        ...baseResult,
        episodeId,
        condition,
        harnessEnabled: condition === 'on',
        repetition: pair.repetition,
        seed,
        runId,
        taskHash: pair.taskHash,
        snapshotId: snapshot?.id || null,
        snapshotHash: snapshot?.hash || null,
        ...builtMetadata.reportMetadata,
      };
      if (result.durationMs === undefined) result.durationMs = Date.now() - startedAt;
      if (result.costUsd !== undefined) costUsd += result.costUsd;
      results.push(result);
      pair.conditions[condition] = result;
      if (maxCostUsd !== null && costUsd > maxCostUsd) {
        costExceeded = true;
        pair.status = 'complete';
      }
    }
    if (pair.conditions.on && pair.conditions.off) {
      pair.complete = true;
      pair.status = 'complete';
    } else {
      pair.complete = false;
      pair.status = 'incomplete';
    }
  }

  const providers = [...new Set(results.map(result => result.provider).filter(Boolean))];
  const executionOrder = pairs.flatMap(pair => pair.order.map(condition => `${pair.repetition}:${pair.taskId}:${condition}`));
  const report = {
    schemaVersion: 1,
    benchmark: 'paired',
    runId,
    suite: suite.suite || null,
    suitePath: path.basename(suite.suite_path),
    repetitions,
    seed,
    snapshot,
    pairs,
    results,
    executionOrder,
    providers,
    comparison: buildComparison(results, pairs),
    limits: {
      timeoutMs,
      maxCostUsd,
      costUsd: Number(costUsd.toFixed(6)),
      costExceeded,
      timeoutCount: results.filter(result => result.timedOut).length,
    },
  };
  return report;
}

module.exports = {
  CONDITIONS,
  DEFAULT_REPETITIONS,
  MAX_REPETITIONS,
  formatComparison,
  runPairedBenchmark,
  sanitizeAdapterMetadata,
};
