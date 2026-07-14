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

const fs = require('fs');
const path = require('path');
const os = require('os');

const SINCE_UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
const SINCE_PATTERN = /^(\d+)([smhd])$/;

function getDefaultRecallLogPath() {
  return path.join(os.homedir(), '.claude', 'logs', 'recall-hits.jsonl');
}

/**
 * Read and parse a recall-hits.jsonl file, tolerating malformed lines.
 * @param {string} [logPath] - defaults to getDefaultRecallLogPath()
 * @returns {{records: object[], skipped: number}}
 */
function readRecallHits(logPath) {
  const resolvedPath = logPath || getDefaultRecallLogPath();
  if (!fs.existsSync(resolvedPath)) {
    return { records: [], skipped: 0 };
  }

  const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const records = [];
  let skipped = 0;

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    if (parsed && typeof parsed.domain === 'string' && typeof parsed.ts === 'string') {
      records.push(parsed);
    } else {
      skipped += 1;
    }
  }

  return { records, skipped };
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

/**
 * Build a full recall-hit report: read, filter by window, aggregate by domain.
 * @param {object} [options]
 * @param {string} [options.logPath]
 * @param {string} [options.since] - e.g. "24h", "7d"
 * @param {number} [options.now] - override current time (tests)
 * @returns {object}
 */
function buildReport({ logPath, since, now } = {}) {
  const { records, skipped } = readRecallHits(logPath);
  const filtered = filterSince(records, parseSince(since), now);
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
    skippedLines: skipped,
    totals,
    byDomain,
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
  lines.push('');

  if (report.byDomain.length === 0) {
    lines.push('(no matching recall hits)');
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
  readRecallHits,
  parseSince,
  filterSince,
  aggregateByDomain,
  buildReport,
  formatTable,
};
