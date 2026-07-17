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

function aggregateOutcomes(events) {
  const outcomes = events.filter(event => event.event_type === EVENT_TYPES.TASK_OUTCOME);
  const result = {
    total: outcomes.length,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
  };

  for (const event of outcomes) {
    const outcome = event.payload?.outcome;
    if (outcome === 'success') result.successCount += 1;
    else if (outcome === 'failure') result.failureCount += 1;
    else result.unknownCount += 1;
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
  const outcomesByEpisode = new Map();
  const duplicateOutcomeEpisodes = new Set();
  for (const event of events) {
    if (event.event_type === EVENT_TYPES.TASK_OUTCOME && event.episode_id) {
      if (outcomesByEpisode.has(event.episode_id)) duplicateOutcomeEpisodes.add(event.episode_id);
      const current = outcomesByEpisode.get(event.episode_id);
      if (!current || Date.parse(event.ts) >= Date.parse(current.ts)) {
        outcomesByEpisode.set(event.episode_id, event);
      }
    }
  }

  const result = {
    total: injections.length,
    withOutcome: 0,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    duplicateOutcomeEpisodes: duplicateOutcomeEpisodes.size,
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
  aggregateOutcomes,
  aggregateLinkedInjections,
  buildReport,
  formatTable,
};
