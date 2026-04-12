#!/usr/bin/env node
/**
 * PreToolUse Hook: Constraint Guard
 *
 * Structural error prevention: when an agent edits a file in a tracked domain,
 * this hook checks the proposed content against the domain's constraints[].
 *
 * Unlike domain-context-inject.js (which injects general context), this hook
 * actively inspects the proposed change and warns when it contains patterns
 * that violate known constraints.
 *
 * Constraint format in index.json:
 *   "constraints[]" items may include a machine-checkable pattern suffix:
 *   "description of constraint|pattern:keyword1|pattern:keyword2"
 *   The text before the first "|pattern:" is the human-readable constraint.
 *   Each "|pattern:X" adds X as a violation keyword to check in proposed content.
 *
 * Behavior:
 *   - riskLevel: "high" domain → strong warning on any pattern match
 *   - other domains → warning only when pattern matches
 *   - Always exits 0 (never blocks tool execution)
 *   - Session-scoped: each constraint warned at most once per session
 *
 * Trigger: PreToolUse on Write|Edit|MultiEdit
 * Profile: standard,strict
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
} = require('../lib/ontology-routing');

// --- Session-scoped deduplication (same pattern as domain-context-inject) ---

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getGuardStatePath() {
  return path.join(os.tmpdir(), `ecc-cguard-${getSessionKey()}.json`);
}

function loadWarned() {
  try {
    const data = JSON.parse(fs.readFileSync(getGuardStatePath(), 'utf8'));
    return Array.isArray(data) ? new Set(data) : new Set();
  } catch {
    return new Set();
  }
}

function saveWarned(set) {
  try {
    fs.writeFileSync(getGuardStatePath(), JSON.stringify([...set]), 'utf8');
  } catch { /* ignore — never block */ }
}

// --- Constraint pattern parsing ---

/**
 * Parse a constraint string into human text and violation patterns.
 *
 * Format: "constraint text|pattern:kw1|pattern:kw2"
 * Returns: { text: string, patterns: string[] }
 */
function parseConstraint(constraintStr) {
  const parts = constraintStr.split('|pattern:');
  return {
    text: parts[0].trim(),
    patterns: parts.slice(1).map(p => p.trim()).filter(Boolean),
  };
}

// --- Extract proposed content from tool input ---

/**
 * Get the text that will be written/inserted by the current tool call.
 * Write → tool_input.content
 * Edit  → tool_input.new_string
 * MultiEdit → concatenate all new_string values
 */
function extractProposedContent(input) {
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};

  if (toolName === 'Write') return ti.content || '';
  if (toolName === 'Edit') return ti.new_string || '';
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(ti.edits) ? ti.edits : [];
    return edits.map(e => e.new_string || '').join('\n');
  }
  return '';
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

  const { fileMap } = loadOntologyMaps(ontologyRoot);
  if (Object.keys(fileMap).length === 0) return rawInput;

  const entry = matchFileToDomain({ filePath, ontologyRoot, fileMap });
  if (!entry) return rawInput;
  if (!Array.isArray(entry.constraints) || entry.constraints.length === 0) return rawInput;

  const proposedContent = extractProposedContent(input);
  // If no content to inspect, skip
  if (!proposedContent) return rawInput;

  const warned = loadWarned();
  const violations = [];

  for (const constraintStr of entry.constraints) {
    const { text, patterns } = parseConstraint(constraintStr);
    if (patterns.length === 0) continue; // no machine-checkable pattern

    const constraintKey = `${entry.domainKey}::${text.slice(0, 40)}`;
    if (warned.has(constraintKey)) continue; // already warned this session

    const matched = patterns.find(p =>
      proposedContent.toLowerCase().includes(p.toLowerCase())
    );

    if (matched) {
      violations.push({ text, pattern: matched, constraintKey });
    }
  }

  if (violations.length === 0) return rawInput;

  // Output warnings to stderr
  const isHighRisk = entry.riskLevel === 'high';
  const header = isHighRisk
    ? `[CONSTRAINT GUARD] WARNING: HIGH RISK — ${entry.domainKey}`
    : `[CONSTRAINT GUARD] ${entry.domainKey}`;

  const lines = ['', header, ''];
  for (const v of violations) {
    lines.push(`  CONSTRAINT VIOLATED: ${v.text}`);
    lines.push(`  Matched pattern: "${v.pattern}"`);
    lines.push('');
  }

  if (isHighRisk) {
    lines.push('  Review constraints in .claude/ontology/index.json before proceeding.');
    lines.push('  If this is a genuine mistake, run /error-capture to prevent recurrence.');
  } else {
    lines.push('  If this was intentional, proceed. Otherwise consider /error-capture.');
  }
  lines.push('');

  process.stderr.write(lines.join('\n'));

  // Mark constraints as warned for this session
  for (const v of violations) warned.add(v.constraintKey);
  saveWarned(warned);

  return rawInput; // always exit 0
}

module.exports = { run };

// Allow direct execution for testing
if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    run(raw);
    process.exit(0);
  });
}
