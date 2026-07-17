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
 * Traverses dependsOn (one hop, forward direction — "what this domain relies
 * on") via scripts/lib/ontology-blast-radius.js's traverseDependsOn(), to
 * surface dependent domain constraints. That lib also exposes a 'reverse'
 * direction (classic blast-radius / impact analysis) for future callers —
 * see its header comment for the distinction.
 *
 * Also surfaces the domain's most recent decisions[] (design/bug-fix/etc.
 * records written by scripts/lib/decisions.js) as short one-liners, so the
 * agent gets the "why" behind existing constraints without loading the full
 * decision log.
 *
 * Also surfaces up to 2 domain-linked instincts (learned lessons written by
 * /error-capture with a matching `linked_domain` frontmatter field), via
 * scripts/lib/instinct-loader.js's loadInstinctsForDomain().
 *
 * Every injection (when the lines block is non-empty) is appended as one
 * JSONL line to ~/.claude/logs/recall-hits.jsonl for hit-rate measurement.
 * Logging is fire-and-forget and must never add latency or block the hook.
 *
 * Trigger: PreToolUse on Read|Write|Edit|MultiEdit
 * Profile: standard,strict
 * Token cost: ~0 when no match or already injected, ~150-250 on first hit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
  normalizeSourceDocs,
} = require('../lib/ontology-routing');
const { buildDomainPacket } = require('../lib/ontology-packet');
const { traverseDependsOn } = require('../lib/ontology-blast-radius');
const { loadInstinctsForDomain, selectTopInstincts } = require('../lib/instinct-loader');
const { loadInjected, saveInjected } = require('../lib/inject-dedup');
const {
  EVENT_TYPES,
  appendEventAsync,
  createEvent,
  getDefaultEventLogPath,
} = require('../lib/harness-events');

const RECALL_LOG_PATH = getDefaultEventLogPath();
const DOMAIN_INSTINCT_CAP = 2;

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

/**
 * Fire-and-forget: append one JSONL line describing this injection to
 * ~/.claude/logs/recall-hits.jsonl, for offline recall hit-rate measurement.
 * Never throws, never awaited, never grows the hook's latency budget — all
 * failures (missing dir, permissions, etc.) are silently swallowed.
 *
 * @param {object} hit
 * @param {string} hit.domain
 * @param {number} hit.constraints
 * @param {number} hit.decisions
 * @param {number} hit.instincts
 * @param {number} hit.chars
 */
function logRecallHit(hit, input, latencyMs) {
  try {
    const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null;
    const event = createEvent({
      eventType: EVENT_TYPES.CONTEXT_INJECTION,
      source: 'domain-context-inject',
      episodeId: process.env.OMF_EPISODE_ID || sessionId,
      sessionId,
      payload: {
        domain: hit.domain,
        itemCounts: {
          constraints: hit.constraints,
          decisions: hit.decisions,
          instincts: hit.instincts,
        },
        chars: hit.chars,
        tokenEstimate: Math.ceil(hit.chars / 4),
        latencyMs,
      },
    });

    // Keep the legacy top-level fields for existing consumers and older
    // installations while the event payload becomes the canonical shape.
    const legacyCompatibleEvent = {
      ...event,
      domain: hit.domain,
      kinds: {
        constraints: hit.constraints,
        decisions: hit.decisions,
        instincts: hit.instincts,
      },
      chars: hit.chars,
    };
    appendEventAsync(legacyCompatibleEvent, RECALL_LOG_PATH);
  } catch {
    /* never let recall instrumentation block or crash the hook */
  }
}

// --- Main ---

function run(rawInput) {
  const startedAt = Date.now();
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

  // Domain-linked instincts — at most 2, failure-outcome first (Change B1).
  const domainInstincts = selectTopInstincts(
    loadInstinctsForDomain(entry.domainKey, process.cwd()),
    { cap: DOMAIN_INSTINCT_CAP }
  );
  if (domainInstincts.length > 0) {
    lines.push('Instincts:');
    for (const instinct of domainInstincts) {
      const label = instinct.outcome || 'general';
      const name = instinct.title || instinct.id;
      lines.push(`  - [${label}] ${instinct.trigger}: ${name}`);
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

  // Dependent-domain constraints — single traversal implementation via
  // ontology-blast-radius's traverseDependsOn() (Change B2). depth: 1,
  // direction: 'forward' reproduces the prior inline `packet.dependsOn`
  // walk exactly (same values, same order — see that entry's own
  // dependsOn array), just routed through the shared traversal helper.
  const directDeps = traverseDependsOn(entry.domainKey, domainMap, { depth: 1, direction: 'forward' });
  if (directDeps.length > 0) {
    const newDeps = directDeps.filter(dep => !injected.has(dep));
    if (newDeps.length > 0) {
      lines.push(`Depends on: ${directDeps.join(', ')}`);
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
      lines.push(`Depends on: ${directDeps.join(', ')} (already in context)`);
    }
  }

  // Correct: alert if per-domain known-issues file exists
  const issuesPath = path.join(ontologyRoot, 'docs', 'domain-issues', `${entry.domainKey}.md`);
  if (fs.existsSync(issuesPath)) {
    lines.push(`WARNING: Known issues tracked: docs/domain-issues/${entry.domainKey}.md`);
  }

  lines.push('');
  const injectedText = lines.join('\n');
  process.stderr.write(injectedText);

  logRecallHit({
    domain: entry.domainKey,
    constraints: Array.isArray(packet.constraints) ? packet.constraints.length : 0,
    decisions: recentDecisions.length,
    instincts: domainInstincts.length,
    chars: injectedText.length,
  }, input, Date.now() - startedAt);

  // Mark primary domain (and shown dep domains) as injected
  injected.add(entry.domainKey);
  for (const dep of directDeps) injected.add(dep);
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
