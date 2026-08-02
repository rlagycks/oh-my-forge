'use strict';

/**
 * Crash-safe checkpointing for paired benchmark runs.
 *
 * A pilot is 90 provider episodes and tens of dollars. Today a run that hits
 * its cost ceiling — or any adapter error under `--require-comparable`, which
 * the runner converts into a thrown COMPARISON_CONFIG_MISMATCH — throws before
 * a report is ever written, so every pair that already completed is lost.
 *
 * Each finished pair is therefore appended to a JSONL ledger as it completes.
 * A later run reads that ledger and reuses the pairs instead of paying for
 * them again.
 *
 * Resuming is only sound when the second run is measuring the same thing, so
 * the ledger carries a header and a resume refuses on any mismatch. Merging
 * pairs across different seeds, snapshots or provider configurations would
 * silently pool incomparable data.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const HEADER_TYPE = 'checkpoint_header';
const PAIR_TYPE = 'pair_result';

/** Fields that must match for a resume to be sound. */
const COMPATIBILITY_FIELDS = Object.freeze([
  'seed',
  'repetitions',
  'suite',
  'snapshotId',
  'snapshotHash',
  'comparisonFingerprint',
  'guards',
]);

function pairKey(taskId, repetition) {
  return `${taskId}#${repetition}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function buildHeader(context) {
  return COMPATIBILITY_FIELDS.reduce(
    (header, field) => ({ ...header, [field]: context[field] ?? null }),
    { schemaVersion: SCHEMA_VERSION, type: HEADER_TYPE }
  );
}

/**
 * Reasons a checkpoint cannot be resumed into the current run.
 *
 * @returns {string[]} empty when compatible
 */
function compatibilityErrors(header, context) {
  if (!header) return ['checkpoint has no header'];
  if (header.schemaVersion !== SCHEMA_VERSION) {
    return [`checkpoint schemaVersion ${header.schemaVersion} != ${SCHEMA_VERSION}`];
  }
  const current = buildHeader(context);
  return COMPATIBILITY_FIELDS
    .filter(field => stableStringify(header[field]) !== stableStringify(current[field]))
    .map(field => `${field} differs: checkpoint ${stableStringify(header[field])} vs run ${stableStringify(current[field])}`);
}

/**
 * Append-only ledger writer. Every write is flushed, so a hard abort still
 * leaves the completed pairs on disk.
 */
function createCheckpointWriter(checkpointPath, context) {
  const resolved = path.resolve(checkpointPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const existing = fs.existsSync(resolved) && fs.statSync(resolved).size > 0;
  if (!existing) {
    fs.writeFileSync(resolved, `${JSON.stringify(buildHeader(context))}\n`, 'utf8');
  }

  return {
    path: resolved,
    appendPair(pair) {
      const record = { schemaVersion: SCHEMA_VERSION, type: PAIR_TYPE, pair };
      fs.appendFileSync(resolved, `${JSON.stringify(record)}\n`, 'utf8');
    },
  };
}

/**
 * @returns {{header: object|null, pairs: Map<string, object>, corrupt: number}}
 */
function readCheckpoint(checkpointPath) {
  const resolved = path.resolve(checkpointPath);
  if (!fs.existsSync(resolved)) return { header: null, pairs: new Map(), corrupt: 0 };

  return fs.readFileSync(resolved, 'utf8').split('\n').reduce((state, line) => {
    if (line.trim() === '') return state;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // A run killed mid-write can leave a torn final line; that is expected
      // and must not make the whole ledger unreadable.
      return { ...state, corrupt: state.corrupt + 1 };
    }
    if (record.type === HEADER_TYPE) return { ...state, header: record };
    if (record.type === PAIR_TYPE && record.pair?.taskId) {
      // Later records win, so a re-run of the same pair supersedes the old one.
      state.pairs.set(pairKey(record.pair.taskId, record.pair.repetition), record.pair);
    }
    return state;
  }, { header: null, pairs: new Map(), corrupt: 0 });
}

/**
 * Load a checkpoint for reuse, refusing anything that would pool incomparable
 * pairs. Only complete pairs are reusable: an incomplete one carries no paired
 * information and should simply be re-run.
 */
function loadResumablePairs(checkpointPath, context) {
  const { header, pairs, corrupt } = readCheckpoint(checkpointPath);
  if (header === null && pairs.size === 0) {
    throw new Error(`resume checkpoint is empty or missing: ${checkpointPath}`);
  }

  const errors = compatibilityErrors(header, context);
  if (errors.length > 0) {
    throw new Error(`checkpoint cannot be resumed into this run:\n  - ${errors.join('\n  - ')}`);
  }

  const reusable = new Map(
    [...pairs.entries()].filter(([, pair]) => pair.status === 'complete')
  );

  return { pairs: reusable, skipped: pairs.size - reusable.size, corrupt };
}

module.exports = {
  COMPATIBILITY_FIELDS,
  SCHEMA_VERSION,
  buildHeader,
  compatibilityErrors,
  createCheckpointWriter,
  loadResumablePairs,
  pairKey,
  readCheckpoint,
};
