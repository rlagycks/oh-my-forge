#!/usr/bin/env node
/**
 * PreToolUse Hook: Domain Context Injection
 *
 * When an agent edits a file tracked in .claude/ontology/index.json,
 * this hook injects the relevant domain context (domain name, spec path,
 * owner, key symbols, constraints) so the agent knows which domain the
 * file belongs to without having to read the full index.
 *
 * Deduplication: each domain is injected at most once per session.
 * Session key: CLAUDE_SESSION_ID env var, or SHA1 of cwd.
 * State file: /tmp/ecc-injected-<sessionKey>.json
 *
 * Also traverses dependsOn to surface dependent domain constraints (multi-hop).
 *
 * Also surfaces the domain's most recent decisions[] (design/bug-fix/etc.
 * records written by scripts/lib/decisions.js) as short one-liners, so the
 * agent gets the "why" behind existing constraints without loading the full
 * decision log.
 *
 * Trigger: PreToolUse on Read|Write|Edit|MultiEdit
 * Profile: standard,strict
 * Token cost: ~0 when no match or already injected, ~150-250 on first hit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
  normalizeSourceDocs,
} = require('../lib/ontology-routing');
const { buildDomainPacket } = require('../lib/ontology-packet');

// --- Session-scoped deduplication ---

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getStatePath() {
  return path.join(os.tmpdir(), `ecc-injected-${getSessionKey()}.json`);
}

function loadInjected() {
  try {
    const data = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    return Array.isArray(data) ? new Set(data) : new Set();
  } catch {
    return new Set();
  }
}

function saveInjected(set) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify([...set]), 'utf8');
  } catch { /* ignore write errors — never block */ }
}

function sourceDocEntries(sourceDocs = {}) {
  return Object.entries(normalizeSourceDocs(sourceDocs));
}

/**
 * Truncate a decision's `why` field to a max length for compact injection.
 * @param {unknown} why
 * @param {number} maxLen
 * @returns {string}
 */
function truncateWhy(why, maxLen = 100) {
  const text = String(why || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}...`;
}

/**
 * Select the most recent decisions[] entries for a domain entry, most
 * recent first. Decisions are append-only (scripts/lib/decisions.js always
 * pushes new entries onto the end of the array), so the most recent ones
 * are simply the tail of the array — no date parsing required.
 *
 * @param {object} entry - Domain entry as returned by matchFileToDomain (already
 *   merged with its detail file, so entry.decisions reflects domain_<name>.json's
 *   decisions[] with no extra file I/O needed).
 * @param {number} max
 * @returns {Array<object>}
 */
function selectRecentDecisions(entry, max = 3) {
  if (!entry || !Array.isArray(entry.decisions) || entry.decisions.length === 0) return [];
  return entry.decisions.slice(-max).reverse();
}

// --- Main ---

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';
  if (!filePath) return rawInput;

  const ontologyRoot = resolveProjectOntologyRoot({ filePath });
  if (!ontologyRoot) return rawInput;

  const { fileMap, domainMap } = loadOntologyMaps(ontologyRoot);
  if (Object.keys(fileMap).length === 0) return rawInput;

  const entry = matchFileToDomain({ filePath, ontologyRoot, fileMap });
  if (!entry) return rawInput;

  const packet = buildDomainPacket(entry, 'context');

  // Dedup check — skip entirely if primary domain already injected this session
  const injected = loadInjected();
  if (injected.has(entry.domainKey)) return rawInput;

  const lines = [];

  if (packet.riskLevel === 'high') {
    lines.push(`[HIGH RISK DOMAIN — review constraints before editing]`);
  }

  lines.push(`[DOMAIN] ${entry.domainKey} (owner: ${packet.owner || 'unknown'})`);

  if (packet.summary) lines.push(`Summary: ${packet.summary}`);
  if (packet.basePath) lines.push(`Base path: ${packet.basePath}`);

  if (packet.spec) lines.push(`Spec: ${packet.spec} — load for full context`);

  const sourceDocs = sourceDocEntries(packet.sourceDocs);
  if (sourceDocs.length > 0) {
    lines.push('Source Docs (load only if needed):');
    for (const [kind, docs] of sourceDocs) {
      lines.push(`  - ${kind}: ${docs.join(', ')}`);
    }
  }

  if (Array.isArray(packet.endpoints) && packet.endpoints.length > 0) {
    lines.push(`Endpoints (${packet.endpoints.length}):`);
    for (const ep of packet.endpoints) {
      lines.push(`  ${ep.method} ${ep.path}${ep.summary ? ' — ' + ep.summary : ''}`);
    }
  }

  if (packet.symbols && packet.symbols.length > 0) {
    lines.push(`Key symbols: ${packet.symbols.join(', ')}`);
  }

  if (packet.constraints && packet.constraints.length > 0) {
    lines.push('Constraints:');
    for (const c of packet.constraints) {
      lines.push(`  - ${c}`);
    }
  }

  // Recent decisions (Change 3) — most recent 3, one-liners with truncated "why"
  const recentDecisions = selectRecentDecisions(entry, 3);
  if (recentDecisions.length > 0) {
    lines.push('Recent Decisions:');
    for (const decision of recentDecisions) {
      lines.push(`  - [${decision.type}] ${decision.summary} (why: ${truncateWhy(decision.why)})`);
    }
  }

  const falseNormalChecks = packet.completionContract?.falseNormalChecks || [];
  if (falseNormalChecks.length > 0) {
    lines.push('False-Normal Checks:');
    for (const check of falseNormalChecks) {
      lines.push(`  - ${check}`);
    }
  }

  if (Array.isArray(packet.failurePatterns) && packet.failurePatterns.length > 0) {
    lines.push('Watch For:');
    for (const pattern of packet.failurePatterns) {
      lines.push(`  - ${pattern.symptom} -> suspect ${pattern.nextSuspicion}`);
    }
  }

  if (packet.dependsOn && packet.dependsOn.length > 0) {
    const newDeps = packet.dependsOn.filter(dep => !injected.has(dep));
    if (newDeps.length > 0) {
      lines.push(`Depends on: ${packet.dependsOn.join(', ')}`);
      for (const dep of newDeps) {
        const depEntry = domainMap[dep];
        const depPacket = depEntry ? buildDomainPacket(depEntry, 'context') : null;
        if (depPacket?.constraints?.length > 0) {
          lines.push(`  [${dep}] key constraints:`);
          for (const c of depPacket.constraints) {
            lines.push(`    - ${c}`);
          }
        }
      }
    } else {
      lines.push(`Depends on: ${packet.dependsOn.join(', ')} (already in context)`);
    }
  }

  // Correct: alert if per-domain known-issues file exists
  const issuesPath = path.join(ontologyRoot, 'docs', 'domain-issues', `${entry.domainKey}.md`);
  if (fs.existsSync(issuesPath)) {
    lines.push(`WARNING: Known issues tracked: docs/domain-issues/${entry.domainKey}.md`);
  }

  lines.push('');
  process.stderr.write(lines.join('\n'));

  // Mark primary domain (and shown dep domains) as injected
  injected.add(entry.domainKey);
  if (packet.dependsOn) {
    for (const dep of packet.dependsOn) injected.add(dep);
  }
  saveInjected(injected);

  return rawInput;
}

module.exports = { run };

// Direct execution fallback (for testing or Codex hook runner)
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    const result = run(data);
    process.stdout.write(result);
    process.exit(0);
  });
}
