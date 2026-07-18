'use strict';

/**
 * Offline analysis backend for ~/.claude/logs/recall-hits.jsonl.
 *
 * domain-context-inject.js appends one JSONL line per domain-context
 * injection (fire-and-forget, never blocking the hook), but until this
 * module existed nothing ever read the log back — it was a write-only
 * instrumentation stream. This gives it a first consumer: per-domain
 * hit counts and a time-window filter, surfaced via scripts/recall-report.js.
 */

const {
  EVENT_TYPES,
  getDefaultEventLogPath,
  readEvents,
} = require('./harness-events');

const SINCE_UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
const SINCE_PATTERN = /^(\d+)([smhd])$/;
const UTC_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function compareTimestamps(left, right) {
  if (UTC_ISO_TIMESTAMP_PATTERN.test(left) && UTC_ISO_TIMESTAMP_PATTERN.test(right)) {
    return left < right ? -1 : (left > right ? 1 : 0);
  }
  return Date.parse(left) - Date.parse(right);
}
const MIN_RECURRENCE_SAMPLE_SIZE = 2;
const MIN_USEFULNESS_SAMPLE_SIZE = 3;

function getDefaultRecallLogPath() {
  return getDefaultEventLogPath();
}

function toLegacyRecallRecord(event) {
  if (!event || event.event_type !== EVENT_TYPES.CONTEXT_INJECTION) return null;
  return {
    ts: event.ts,
    domain: event.payload?.domain,
    episode_id: event.episode_id || null,
    session_id: event.session_id || null,
    kinds: {
      constraints: Number(event.payload?.item_counts?.constraints) || 0,
      decisions: Number(event.payload?.item_counts?.decisions) || 0,
      instincts: Number(event.payload?.item_counts?.instincts) || 0,
    },
    chars: Number(event.payload?.chars) || 0,
    token_estimate: Number(event.payload?.token_estimate) || 0,
  };
}

function toLegacyRecallRecords(events) {
  return events
    .filter(event => event.event_type === EVENT_TYPES.CONTEXT_INJECTION)
    .map(toLegacyRecallRecord);
}

function readHarnessEvents(logPath) {
  return readEvents(logPath);
}

/**
 * Read and parse a recall-hits.jsonl file, tolerating malformed lines.
 * @param {string} [logPath] - defaults to getDefaultRecallLogPath()
 * @returns {{records: object[], skipped: number}}
 */
function readRecallHits(logPath) {
  const { events, skipped } = readHarnessEvents(logPath || getDefaultRecallLogPath());
  return {
    records: toLegacyRecallRecords(events),
    skipped,
  };
}

/**
 * Parse a "<n><unit>" window string (e.g. "24h", "7d") into milliseconds.
 * @param {string} [since]
 * @returns {number|null} milliseconds, or null when since is empty/invalid
 */
function parseSince(since) {
  if (!since) return null;
  const match = SINCE_PATTERN.exec(String(since).trim());
  if (!match) return null;
  return Number(match[1]) * SINCE_UNIT_MS[match[2]];
}

/**
 * @param {object[]} records
 * @param {number|null} sinceMs
 * @param {number} [now]
 * @returns {object[]}
 */
function filterSince(records, sinceMs, now = Date.now()) {
  if (sinceMs === null) return records;
  const cutoff = now - sinceMs;
  return records.filter((record) => {
    const ts = Date.parse(record.ts);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

/**
 * Sum hit counts and kinds per domain, sorted by hits descending.
 * @param {object[]} records
 * @returns {object[]}
 */
function aggregateByDomain(records) {
  const byDomain = new Map();

  for (const record of records) {
    if (!record || typeof record.domain !== 'string') continue;
    const key = record.domain;
    if (!byDomain.has(key)) {
      byDomain.set(key, { domain: key, hits: 0, constraints: 0, decisions: 0, instincts: 0, chars: 0 });
    }
    const entry = byDomain.get(key);
    entry.hits += 1;
    entry.constraints += Number(record.kinds?.constraints) || 0;
    entry.decisions += Number(record.kinds?.decisions) || 0;
    entry.instincts += Number(record.kinds?.instincts) || 0;
    entry.chars += Number(record.chars) || 0;
  }

  return [...byDomain.values()].sort((a, b) => b.hits - a.hits);
}

function percent(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
}

function metadataIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter(id => typeof id === 'string' && id.trim() !== ''))];
}

function eventMetadataIds(payload, pluralKey, singularKey) {
  return [...new Set([
    ...metadataIds(payload?.[pluralKey]),
    ...metadataIds(payload?.[singularKey]),
  ])];
}

function recurrenceRows(observations) {
  const groups = new Map();
  for (const observation of observations) {
    const current = groups.get(observation.key) || {
      key: observation.key,
      occurrences: 0,
      uniqueEpisodes: new Set(),
      firstSeen: observation.ts,
      lastSeen: observation.ts,
    };
    current.occurrences += 1;
    if (observation.episodeId) current.uniqueEpisodes.add(observation.episodeId);
    if (compareTimestamps(observation.ts, current.firstSeen) < 0) current.firstSeen = observation.ts;
    if (compareTimestamps(observation.ts, current.lastSeen) > 0) current.lastSeen = observation.ts;
    groups.set(observation.key, current);
  }

  return [...groups.values()]
    .map(group => {
      const repeatOccurrences = Math.max(group.occurrences - 1, 0);
      return {
        key: group.key,
        occurrences: group.occurrences,
        uniqueEpisodes: group.uniqueEpisodes.size,
        repeatOccurrences,
        recurrenceRate: group.occurrences >= MIN_RECURRENCE_SAMPLE_SIZE
          ? percent(repeatOccurrences, group.occurrences)
          : null,
        insufficientSample: group.occurrences < MIN_RECURRENCE_SAMPLE_SIZE,
        sampleSize: group.occurrences,
        minimumSampleSize: MIN_RECURRENCE_SAMPLE_SIZE,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

/**
 * Calculate repeat-observation rates from metadata only. The first observation
 * of a key is its baseline; subsequent observations are repeats, so
 * recurrenceRate = repeatOccurrences / occurrences. Raw prompts and context
 * are intentionally not inputs to this calculation.
 */
function aggregateRecurrence(events) {
  const injections = events.filter(event => event.event_type === EVENT_TYPES.CONTEXT_INJECTION);
  const observations = {
    domain: [],
    constraint: [],
    memoryId: [],
  };

  for (const event of injections) {
    const payload = event.payload || {};
    if (typeof payload.domain === 'string' && payload.domain.trim() !== '') {
      observations.domain.push({ key: payload.domain, episodeId: event.episode_id, ts: event.ts });
    }
    for (const key of eventMetadataIds(payload, 'constraint_ids', 'constraint_id')) {
      observations.constraint.push({ key, episodeId: event.episode_id, ts: event.ts });
    }
    for (const key of eventMetadataIds(payload, 'memory_ids', 'memory_id')) {
      observations.memoryId.push({ key, episodeId: event.episode_id, ts: event.ts });
    }
  }

  const makeSummary = rows => {
    const occurrences = rows.reduce((sum, row) => sum + row.occurrences, 0);
    const repeatOccurrences = rows.reduce((sum, row) => sum + row.repeatOccurrences, 0);
    return {
      observations: occurrences,
      uniqueKeys: rows.length,
      repeatOccurrences,
      recurrenceRate: occurrences >= MIN_RECURRENCE_SAMPLE_SIZE
        ? percent(repeatOccurrences, occurrences)
        : null,
      insufficientSample: occurrences < MIN_RECURRENCE_SAMPLE_SIZE,
      sampleSize: occurrences,
      minimumSampleSize: MIN_RECURRENCE_SAMPLE_SIZE,
    };
  };

  const byDomain = recurrenceRows(observations.domain);
  const byConstraint = recurrenceRows(observations.constraint);
  const byMemoryId = recurrenceRows(observations.memoryId);
  return {
    byDomain,
    byConstraint,
    byMemoryId,
    summary: {
      domain: makeSummary(byDomain),
      constraint: makeSummary(byConstraint),
      memoryId: makeSummary(byMemoryId),
    },
    minimumSampleSize: MIN_RECURRENCE_SAMPLE_SIZE,
  };
}

function finalOutcomes(events) {
  const outcomes = new Map();
  const duplicateEpisodeIds = new Set();
  const unattributedOutcomes = [];

  events.forEach(event => {
    if (event.event_type !== EVENT_TYPES.TASK_OUTCOME) return;
    if (!event.episode_id) {
      unattributedOutcomes.push(event);
      return;
    }
    if (outcomes.has(event.episode_id)) duplicateEpisodeIds.add(event.episode_id);
    const current = outcomes.get(event.episode_id);
    if (!current || compareTimestamps(event.ts, current.ts) >= 0) outcomes.set(event.episode_id, event);
  });

  return { outcomes, duplicateEpisodeIds, unattributedOutcomes };
}

function explicitRecallUsed(outcome) {
  if (typeof outcome?.payload?.recall_used === 'boolean') return outcome.payload.recall_used;
  return null;
}

/**
 * Classify final episode outcomes without claiming causal impact. A linked
 * success/failure is a usefulness proxy when no explicit recall_used flag is
 * present; unknown outcomes and explicit false evidence remain unused.
 */
function aggregateInjectionOutcomes(events) {
  const injectionEpisodes = new Set(
    events
      .filter(event => event.event_type === EVENT_TYPES.CONTEXT_INJECTION && event.episode_id)
      .map(event => event.episode_id)
  );
  const { outcomes, duplicateEpisodeIds, unattributedOutcomes } = finalOutcomes(events);
  const episodes = new Set([...injectionEpisodes, ...outcomes.keys()]);
  const categories = {
    noInjection: 0,
    injectedButUnused: 0,
    injectedAndSuccessful: 0,
    injectedAndFailed: 0,
  };
  let unattributedInjections = 0;

  for (const event of events) {
    if (event.event_type === EVENT_TYPES.CONTEXT_INJECTION && !event.episode_id) unattributedInjections += 1;
  }

  for (const episodeId of episodes) {
    const outcome = outcomes.get(episodeId);
    const injected = injectionEpisodes.has(episodeId);
    if (!injected) {
      categories.noInjection += 1;
      continue;
    }
    const used = explicitRecallUsed(outcome);
    if (!outcome || used === false || outcome.payload?.outcome === 'unknown') {
      categories.injectedButUnused += 1;
    } else if (outcome.payload?.outcome === 'success') {
      categories.injectedAndSuccessful += 1;
    } else if (outcome.payload?.outcome === 'failure') {
      categories.injectedAndFailed += 1;
    } else {
      categories.injectedButUnused += 1;
    }
  }

  const totalEpisodes = Object.values(categories).reduce((sum, count) => sum + count, 0);
  const rates = Object.fromEntries(Object.entries(categories).map(([key, count]) => [
    key,
    totalEpisodes >= MIN_USEFULNESS_SAMPLE_SIZE ? percent(count, totalEpisodes) : null,
  ]));
  return {
    totalEpisodes,
    episodesWithInjection: [...injectionEpisodes].filter(id => outcomes.has(id)).length,
    categories,
    rates,
    insufficientSample: totalEpisodes < MIN_USEFULNESS_SAMPLE_SIZE,
    sampleSize: totalEpisodes,
    minimumSampleSize: MIN_USEFULNESS_SAMPLE_SIZE,
    duplicateOutcomeEpisodes: duplicateEpisodeIds.size,
    unattributedInjections,
    unattributedOutcomes: unattributedOutcomes.length,
  };
}

function aggregateOutcomes(events) {
  const { outcomes: final, duplicateEpisodeIds, unattributedOutcomes } = finalOutcomes(events);
  const rawOutcomes = events.filter(event => event.event_type === EVENT_TYPES.TASK_OUTCOME);
  const rawTotal = rawOutcomes.length;
  const result = {
    // Keep the original contract: total is the number of recorded outcome events.
    // finalTotal exposes the deduplicated episode count used by the rates below.
    total: rawTotal,
    rawTotal,
    finalTotal: final.size + unattributedOutcomes.length,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    duplicateOutcomeEpisodes: duplicateEpisodeIds.size,
  };

  for (const event of [...final.values(), ...unattributedOutcomes]) {
    const outcome = event.payload?.outcome;
    if (outcome === 'success') result.successCount += 1;
    else if (outcome === 'failure') result.failureCount += 1;
    else result.unknownCount += 1;
  }

  // Token/tool counts describe provider consumption, so retries remain part of
  // the cost totals even when outcome rates use the final episode view.
  for (const event of rawOutcomes) {
    result.inputTokens += Number(event.payload?.input_tokens) || 0;
    result.outputTokens += Number(event.payload?.output_tokens) || 0;
    result.toolCalls += Number(event.payload?.tool_calls) || 0;
  }

  const known = result.successCount + result.failureCount;
  result.successRate = known > 0 ? Number(((result.successCount / known) * 100).toFixed(1)) : null;
  return result;
}

function aggregateLinkedInjections(events) {
  const injections = events.filter(event => event.event_type === EVENT_TYPES.CONTEXT_INJECTION);
  const { outcomes: outcomesByEpisode, duplicateEpisodeIds } = finalOutcomes(events);

  const result = {
    total: injections.length,
    withOutcome: 0,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    duplicateOutcomeEpisodes: duplicateEpisodeIds.size,
  };

  for (const injection of injections) {
    const outcome = injection.episode_id ? outcomesByEpisode.get(injection.episode_id) : null;
    if (!outcome) continue;
    result.withOutcome += 1;
    if (outcome.payload.outcome === 'success') result.successCount += 1;
    else if (outcome.payload.outcome === 'failure') result.failureCount += 1;
    else result.unknownCount += 1;
  }

  const known = result.successCount + result.failureCount;
  result.successRate = known > 0 ? Number(((result.successCount / known) * 100).toFixed(1)) : null;
  return result;
}

/**
 * Build a full recall-hit report: read, filter by window, aggregate by domain.
 * @param {object} [options]
 * @param {string} [options.logPath]
 * @param {string} [options.since] - e.g. "24h", "7d"
 * @param {number} [options.now] - override current time (tests)
 * @returns {object}
 */
function buildReport({ logPath, since, now } = {}) {
  const { events, skipped } = readHarnessEvents(logPath || getDefaultRecallLogPath());
  const filteredEvents = filterSince(events, parseSince(since), now);
  const records = toLegacyRecallRecords(events);
  const filtered = toLegacyRecallRecords(filteredEvents);
  const byDomain = aggregateByDomain(filtered);

  const totals = byDomain.reduce((acc, domain) => ({
    hits: acc.hits + domain.hits,
    constraints: acc.constraints + domain.constraints,
    decisions: acc.decisions + domain.decisions,
    instincts: acc.instincts + domain.instincts,
    chars: acc.chars + domain.chars,
  }), { hits: 0, constraints: 0, decisions: 0, instincts: 0, chars: 0 });

  return {
    generatedAt: new Date(now || Date.now()).toISOString(),
    logPath: logPath || getDefaultRecallLogPath(),
    since: since || null,
    totalRecords: records.length,
    matchedRecords: filtered.length,
    totalEvents: events.length,
    matchedEvents: filteredEvents.length,
    skippedLines: skipped,
    totals,
    byDomain,
    outcomes: aggregateOutcomes(filteredEvents),
    linkedInjections: aggregateLinkedInjections(filteredEvents),
    recurrence: aggregateRecurrence(filteredEvents),
    recallUsefulness: aggregateInjectionOutcomes(filteredEvents),
  };
}

/**
 * Render a report as an aligned plain-text table.
 * @param {object} report - result of buildReport()
 * @returns {string}
 */
function formatTable(report) {
  const lines = [];
  lines.push(`Recall Hit Report — ${report.generatedAt}`);
  lines.push(`Log: ${report.logPath}`);
  if (report.since) lines.push(`Since: ${report.since}`);
  lines.push(
    `Total records: ${report.totalRecords}  Matched: ${report.matchedRecords}  Skipped (malformed): ${report.skippedLines}`
  );
  lines.push(
    `Events: ${report.totalEvents}  Outcomes: ${report.outcomes.total}  `
      + `Outcome success rate: ${report.outcomes.successRate === null ? 'n/a' : `${report.outcomes.successRate}%`}`
  );
  const recurrenceRate = report.recurrence.summary.domain.recurrenceRate;
  lines.push(
    `Recurrence (domain): ${recurrenceRate === null ? 'n/a (insufficient sample)' : `${recurrenceRate}%`}  `
      + `constraints=${report.recurrence.summary.constraint.recurrenceRate === null ? 'n/a' : `${report.recurrence.summary.constraint.recurrenceRate}%`}  `
      + `memory IDs=${report.recurrence.summary.memoryId.recurrenceRate === null ? 'n/a' : `${report.recurrence.summary.memoryId.recurrenceRate}%`}`
  );
  const categories = report.recallUsefulness.categories;
  lines.push(
    `Recall usefulness (episodes=${report.recallUsefulness.totalEpisodes}): `
      + `no-injection=${categories.noInjection} `
      + `injected-but-unused=${categories.injectedButUnused} `
      + `injected-and-successful=${categories.injectedAndSuccessful} `
      + `injected-and-failed=${categories.injectedAndFailed}`
      + (report.recallUsefulness.insufficientSample ? ' (insufficient sample)' : '')
  );
  lines.push('');

  if (report.byDomain.length === 0) {
    lines.push(report.outcomes.total > 0 ? '(no matching recall hits; outcome events found)' : '(no matching recall hits)');
    return lines.join('\n');
  }

  const header = ['Domain', 'Hits', 'Constraints', 'Decisions', 'Instincts', 'Chars'];
  const rows = report.byDomain.map((d) => [d.domain, d.hits, d.constraints, d.decisions, d.instincts, d.chars]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const formatRow = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');

  lines.push(formatRow(header));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) lines.push(formatRow(row));

  lines.push('');
  lines.push(
    `TOTAL  hits=${report.totals.hits} constraints=${report.totals.constraints} ` +
    `decisions=${report.totals.decisions} instincts=${report.totals.instincts} chars=${report.totals.chars}`
  );

  return lines.join('\n');
}

module.exports = {
  getDefaultRecallLogPath,
  readHarnessEvents,
  readRecallHits,
  parseSince,
  filterSince,
  aggregateByDomain,
  aggregateRecurrence,
  aggregateInjectionOutcomes,
  finalOutcomes,
  aggregateOutcomes,
  aggregateLinkedInjections,
  buildReport,
  formatTable,
};
