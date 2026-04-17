/**
 * Decision record library — append-only log of design decisions, bug root causes,
 * tool patterns, and change reasons across ontology domains.
 *
 * Storage: .claude/ontology/domain_*.json  → decisions[] array (per-domain)
 *          ~/.claude/decisions/index.jsonl  → global append-only log (cross-session)
 *
 * CLI usage:
 *   node scripts/lib/decisions.js add --domain domain_commands --type bug-fix \
 *     --summary "..." --why "..." --files "commands/plan.md" --ref "PR #6" \
 *     --evidence "test output|manual repro" \
 *     --false-normal-signals "green tests without changed-path evidence" \
 *     --verify-with "node tests/lib/example.test.js" \
 *     --next-suspicion "first place to inspect if this recurs"
 *
 *   node scripts/lib/decisions.js query --domain domain_commands
 *   node scripts/lib/decisions.js query --type bug-fix
 *   node scripts/lib/decisions.js query --file commands/plan.md
 *   node scripts/lib/decisions.js query --since 2026-04-01
 *   node scripts/lib/decisions.js list-domains
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// In plugin installs the CWD is the host project, which has no .claude/ontology/.
// Fall back to the plugin root's ontology when the local one is absent.
function resolveOntologyDir() {
  const local = path.join(process.cwd(), '.claude', 'ontology');
  if (fs.existsSync(local)) return local;
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const pluginLocal = path.join(process.env.CLAUDE_PLUGIN_ROOT, '.claude', 'ontology');
    if (fs.existsSync(pluginLocal)) return pluginLocal;
  }
  return local; // return local even if missing — errors reported at use-site
}

const ONTOLOGY_DIR = resolveOntologyDir();
const GLOBAL_LOG_DIR = path.join(os.homedir(), '.claude', 'decisions');
const GLOBAL_LOG_FILE = path.join(GLOBAL_LOG_DIR, 'index.jsonl');

// ─── helpers ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

function makeId() {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `dec-${date}-${rand}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function domainFilePath(domain) {
  return path.join(ONTOLOGY_DIR, `${domain}.json`);
}

function loadDomain(domain) {
  const file = domainFilePath(domain);
  if (!fs.existsSync(file)) throw new Error(`Domain file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveDomain(domain, data) {
  const file = domainFilePath(domain);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendGlobalLog(entry) {
  fs.mkdirSync(GLOBAL_LOG_DIR, { recursive: true });
  fs.appendFileSync(GLOBAL_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function readGlobalLog() {
  if (!fs.existsSync(GLOBAL_LOG_FILE)) return [];
  return fs.readFileSync(GLOBAL_LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function listDomainFiles() {
  if (!fs.existsSync(ONTOLOGY_DIR)) return [];
  return fs.readdirSync(ONTOLOGY_DIR)
    .filter(f => f.startsWith('domain_') && f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Add a decision record to the specified domain and global log.
 * @param {object} opts
 * @param {string} opts.domain - domain key, e.g. "domain_commands"
 * @param {'design'|'bug-fix'|'refactor'|'tool-pattern'|'constraint'} opts.type
 * @param {string} opts.summary - one-line description
 * @param {string} opts.why - root cause / motivation
 * @param {string[]} [opts.files] - affected file paths
 * @param {string} [opts.ref] - PR/commit/issue reference
 * @param {string} [opts.prevention] - keyword/pattern to auto-inject into domain constraints[]
 * @param {string[]} [opts.evidence] - concrete proof captured while resolving the issue
 * @param {string[]} [opts.falseNormalSignals] - signals that looked healthy but were misleading
 * @param {string[]} [opts.verifyWith] - explicit follow-up checks for re-validation
 * @param {string} [opts.nextSuspicion] - what to suspect first if the issue recurs
 *   When provided for bug-fix or constraint types, appends a constraint entry:
 *   "[prevention] <summary>|pattern:<prevention>" — picked up by constraint-guard.js
 * @returns {object} the created decision entry
 */
function addDecision({
  domain,
  type,
  summary,
  why,
  files = [],
  ref = '',
  prevention = '',
  evidence = [],
  falseNormalSignals = [],
  verifyWith = [],
  nextSuspicion = '',
}) {
  const VALID_TYPES = ['design', 'bug-fix', 'refactor', 'tool-pattern', 'constraint'];
  if (!domain) throw new Error('--domain is required');
  if (!VALID_TYPES.includes(type)) throw new Error(`--type must be one of: ${VALID_TYPES.join(', ')}`);
  if (!summary) throw new Error('--summary is required');
  if (!why) throw new Error('--why is required');

  const entry = {
    id: makeId(),
    date: today(),
    type,
    domain,
    summary,
    why,
    ...(files.length ? { files } : {}),
    ...(ref ? { ref } : {}),
    ...(prevention ? { prevention } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(falseNormalSignals.length ? { falseNormalSignals } : {}),
    ...(verifyWith.length ? { verifyWith } : {}),
    ...(nextSuspicion ? { nextSuspicion } : {})
  };

  // Write into domain_*.json decisions array (best-effort; falls back to global log only)
  const domainFile = domainFilePath(domain);
  if (fs.existsSync(domainFile)) {
    const domainData = loadDomain(domain);
    if (!Array.isArray(domainData.decisions)) domainData.decisions = [];
    domainData.decisions.push(entry);

    // Auto-inject prevention pattern into domain constraints[] for constraint-guard.js
    if (prevention && (type === 'bug-fix' || type === 'constraint')) {
      if (!Array.isArray(domainData.constraints)) domainData.constraints = [];
      const constraintEntry = `[prevention] ${summary}|pattern:${prevention}`;
      // Only add if not already present (avoid duplicates on re-run)
      if (!domainData.constraints.includes(constraintEntry)) {
        domainData.constraints.push(constraintEntry);
      }
    }

    saveDomain(domain, domainData);
  }

  // Append to global log
  appendGlobalLog(entry);

  return entry;
}

/**
 * Query decision records.
 * @param {object} filters
 * @param {string} [filters.domain]
 * @param {string} [filters.type]
 * @param {string} [filters.file] - match against decisions.files[]
 * @param {string} [filters.since] - ISO date, filter entries on or after
 * @param {string} [filters.q] - free-text search in summary + why
 * @returns {object[]}
 */
function queryDecisions({ domain, type, file, since, q } = {}) {
  // Collect from global log (contains all domains)
  let entries = readGlobalLog();

  // If no global log yet, fall back to scanning domain files
  if (entries.length === 0) {
    for (const d of listDomainFiles()) {
      try {
        const data = loadDomain(d);
        if (Array.isArray(data.decisions)) {
          entries.push(...data.decisions.map(e => ({ ...e, domain: e.domain || d })));
        }
      } catch { /* skip unreadable */ }
    }
  }

  if (domain) entries = entries.filter(e => e.domain === domain);
  if (type) entries = entries.filter(e => e.type === type);
  if (file) entries = entries.filter(e => Array.isArray(e.files) && e.files.some(f => f.includes(file)));
  if (since) entries = entries.filter(e => e.date >= since);
  if (q) {
    const lq = q.toLowerCase();
    entries = entries.filter(e =>
      e.summary.toLowerCase().includes(lq) ||
      e.why.toLowerCase().includes(lq) ||
      (e.nextSuspicion || '').toLowerCase().includes(lq) ||
      (Array.isArray(e.evidence) ? e.evidence.join(' ').toLowerCase().includes(lq) : false) ||
      (Array.isArray(e.falseNormalSignals) ? e.falseNormalSignals.join(' ').toLowerCase().includes(lq) : false) ||
      (Array.isArray(e.verifyWith) ? e.verifyWith.join(' ').toLowerCase().includes(lq) : false)
    );
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * List all domain keys that have at least one decision.
 */
function listDomains() {
  const fromLog = [...new Set(readGlobalLog().map(e => e.domain))];
  if (fromLog.length) return fromLog;
  return listDomainFiles().filter(d => {
    try {
      const data = loadDomain(d);
      return Array.isArray(data.decisions) && data.decisions.length > 0;
    } catch { return false; }
  });
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function cli(argv) {
  const [cmd, ...rest] = argv;

  if (cmd === 'add') {
    const opts = parseFlags(rest);
    const entry = addDecision({
      domain: opts.domain,
      type: opts.type,
      summary: opts.summary,
      why: opts.why,
      files: splitListFlag(opts.files, ','),
      ref: opts.ref || '',
      prevention: opts.prevention || '',
      evidence: splitListFlag(opts.evidence),
      falseNormalSignals: splitListFlag(opts['false-normal-signals'] || opts.falseNormalSignals),
      verifyWith: splitListFlag(opts['verify-with'] || opts.verifyWith),
      nextSuspicion: opts['next-suspicion'] || opts.nextSuspicion || ''
    });
    console.log('Decision recorded:', JSON.stringify(entry, null, 2));
    return;
  }

  if (cmd === 'query') {
    const opts = parseFlags(rest);
    const results = queryDecisions(opts);
    if (results.length === 0) {
      console.log('No decisions found.');
      return;
    }
    for (const e of results) {
      console.log(`\n[${e.id}] ${e.date} · ${e.type} · ${e.domain}`);
      console.log(`  WHAT: ${e.summary}`);
      console.log(`  WHY:  ${e.why}`);
      if (e.files && e.files.length) console.log(`  FILES: ${e.files.join(', ')}`);
      if (e.ref) console.log(`  REF:  ${e.ref}`);
      if (e.evidence && e.evidence.length) console.log(`  EVIDENCE: ${e.evidence.join(' | ')}`);
      if (e.falseNormalSignals && e.falseNormalSignals.length) console.log(`  FALSE NORMAL: ${e.falseNormalSignals.join(' | ')}`);
      if (e.verifyWith && e.verifyWith.length) console.log(`  VERIFY WITH: ${e.verifyWith.join(' | ')}`);
      if (e.nextSuspicion) console.log(`  NEXT SUSPICION: ${e.nextSuspicion}`);
    }
    console.log(`\n${results.length} decision(s) found.`);
    return;
  }

  if (cmd === 'list-domains') {
    const domains = listDomains();
    if (domains.length === 0) { console.log('No decisions recorded yet.'); return; }
    domains.forEach(d => console.log(d));
    return;
  }

  console.error('Usage: decisions.js <add|query|list-domains> [--flag value ...]');
  process.exit(1);
}

function parseFlags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return result;
}

function splitListFlag(value, preferredSeparator = '|') {
  if (!value || typeof value !== 'string') return [];
  const separator = value.includes(preferredSeparator) ? preferredSeparator : ',';
  return value
    .split(separator)
    .map(item => item.trim())
    .filter(Boolean);
}

module.exports = { addDecision, queryDecisions, listDomains };

if (require.main === module) {
  cli(process.argv.slice(2));
}
