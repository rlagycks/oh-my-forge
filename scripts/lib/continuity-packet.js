/**
 * Continuity packet builder — assembles a compact digest of recent decision
 * records (the WHY behind recent changes) for the current project, so hooks
 * can re-inject work rationale after context compaction or /clear.
 *
 * Reads from the same global decisions log as scripts/lib/decisions.js:
 *   ~/.claude/decisions/index.jsonl  (append-only JSONL, one entry per line)
 *
 * Entry schema written by decisions.js#addDecision:
 *   { id, date, type, domain, summary, why, files?, ref?, prevention?,
 *     evidence?, falseNormalSignals?, verifyWith?, nextSuspicion? }
 *
 * decisions.js does not currently stamp a project/cwd/repo field, but this
 * module honors one if present (future-proofing for multi-project logs) and
 * otherwise falls back to matching the entry's `domain` against the current
 * project's ontology index (.claude/ontology/index.json).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const RECENT_LOG_SCAN_BYTES = 64 * 1024;
const RECENT_LOG_SCAN_LINES = 200;
const DEFAULT_MAX_DECISIONS = 5;
const DEFAULT_MAX_CHARS = 1500;
const LINE_MAX_CHARS = 160;

const HEADER = '## Recent decisions (why)';
const HINT = 'These explain the reasoning behind recent changes — restored after compaction or /clear.';

function emptyResult() {
  return { text: null, decisionCount: 0 };
}

// Mirrors decisions.js#resolveOntologyDir but takes an explicit cwd so it
// stays testable without mutating process.cwd().
function resolveOntologyDir(cwd) {
  const local = path.join(cwd, '.claude', 'ontology');
  if (fs.existsSync(local)) return local;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT;
  if (pluginRoot) {
    const pluginLocal = path.join(pluginRoot, '.claude', 'ontology');
    if (fs.existsSync(pluginLocal)) return pluginLocal;
  }
  return local;
}

function loadOntologyDomains(ontologyDir) {
  try {
    const indexPath = path.join(ontologyDir, 'index.json');
    if (!fs.existsSync(indexPath)) return null;
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return new Set(Object.keys(data).filter(key => key.startsWith('domain_')));
  } catch {
    return null;
  }
}

// Reads only the tail of the log (like decisions.js#readRecentGlobalLogEntries)
// so this stays cheap even against a large cross-session log.
function readRecentEntries(logPath) {
  if (!fs.existsSync(logPath)) return [];

  const stat = fs.statSync(logPath);
  const length = Math.min(stat.size, RECENT_LOG_SCAN_BYTES);
  const start = stat.size - length;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(logPath, 'r');

  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  const text = buffer.toString('utf8');
  const lines = text
    .split('\n')
    .filter(Boolean)
    .slice(start === 0 ? 0 : 1) // drop a possibly-truncated leading line
    .slice(-RECENT_LOG_SCAN_LINES);

  return lines
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function isRelevantEntry(entry, cwdBase, ontologyDomains) {
  if (!entry || typeof entry !== 'object') return false;

  const projectField = entry.project || entry.cwd || entry.repo;
  if (projectField) return path.basename(String(projectField)) === cwdBase;

  if (!ontologyDomains) return false;
  return typeof entry.domain === 'string' && ontologyDomains.has(entry.domain);
}

function renderLine(entry) {
  const type = entry.type || 'note';
  const summary = entry.summary || '';
  const why = entry.why || '';
  const ref = entry.ref ? ` (${entry.ref})` : '';
  const line = `- [${type}] ${summary} — ${why}${ref}`;
  return line.length > LINE_MAX_CHARS ? `${line.slice(0, LINE_MAX_CHARS - 3)}...` : line;
}

function buildText(lines) {
  return [HEADER, HINT, ...lines].join('\n');
}

/**
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {number} [options.maxDecisions]
 * @param {number} [options.maxChars]
 * @param {string} [options.globalLogPath] - injectable for tests
 * @param {string} [options.ontologyDir] - injectable for tests
 * @returns {{ text: string|null, decisionCount: number }}
 */
function buildContinuityPacket(options = {}) {
  try {
    const {
      cwd = process.cwd(),
      maxDecisions = DEFAULT_MAX_DECISIONS,
      maxChars = DEFAULT_MAX_CHARS,
      globalLogPath,
      ontologyDir,
    } = options;

    const logPath = globalLogPath || path.join(os.homedir(), '.claude', 'decisions', 'index.jsonl');
    if (!fs.existsSync(logPath)) return emptyResult();

    const entries = readRecentEntries(logPath);
    if (entries.length === 0) return emptyResult();

    const resolvedOntologyDir = ontologyDir || resolveOntologyDir(cwd);
    const ontologyDomains = loadOntologyDomains(resolvedOntologyDir);

    const cwdBase = path.basename(cwd);
    const relevant = entries.filter(entry => isRelevantEntry(entry, cwdBase, ontologyDomains));
    if (relevant.length === 0) return emptyResult();

    // Log is append-order (oldest -> newest); reverse for newest-first display.
    const newestFirst = relevant.slice().reverse().slice(0, maxDecisions);
    let selected = newestFirst.map(renderLine);
    let text = buildText(selected);

    // Hard-cap total size, dropping the oldest (last) lines first to fit.
    while (selected.length > 0 && text.length > maxChars) {
      selected = selected.slice(0, -1);
      text = buildText(selected);
    }

    if (selected.length === 0) return emptyResult();
    return { text, decisionCount: selected.length };
  } catch {
    return emptyResult();
  }
}

module.exports = { buildContinuityPacket };
