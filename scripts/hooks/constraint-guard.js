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

// --- Ontology loading (mirrors domain-context-inject.js) ---

function domainSlug(domainKey) {
  return domainKey.replace(/^domain_/, '');
}

function loadDomainFile(domainFilePath) {
  try {
    return JSON.parse(fs.readFileSync(domainFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadIndex(pluginRoot) {
  const indexPath = path.join(pluginRoot, '.claude', 'ontology', 'index.json');
  if (!fs.existsSync(indexPath)) return { fileMap: {}, domainMap: {} };

  try {
    const content = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const fileMap = {};
    const domainMap = {};

    const isSplit = content.domains && typeof content.domains === 'object';
    const entries = isSplit
      ? Object.entries(content.domains).map(([domainKey, refPath]) => {
          const absPath = path.isAbsolute(refPath)
            ? refPath
            : path.join(pluginRoot, refPath);
          const domainData = loadDomainFile(absPath) || {};
          return [domainKey, domainData];
        })
      : Object.entries(content).filter(([k]) => !k.startsWith('$'));

    for (const [domainKey, entry] of entries) {
      if (!entry || typeof entry !== 'object') continue;
      domainMap[domainKey] = { domainKey, ...entry };

      if (Array.isArray(entry.files)) {
        for (const file of entry.files) {
          fileMap[file] = { domainKey, ...entry };
        }
      }
      if (Array.isArray(entry.source)) {
        for (const file of entry.source) {
          fileMap[file] = { domainKey, ...entry };
        }
      }

      const slug = domainSlug(domainKey);
      if (slug) fileMap[`__slug__${slug}`] = { domainKey, ...entry };
    }

    return { fileMap, domainMap };
  } catch {
    return { fileMap: {}, domainMap: {} };
  }
}

function resolvePluginRoot(filePath) {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT || '';
  if (envRoot) {
    const marker = path.join(envRoot, '.claude', 'ontology', 'index.json');
    if (fs.existsSync(marker)) return envRoot;
  }

  const fsRoot = path.parse(path.resolve(filePath)).root;

  let dir = path.resolve(path.dirname(filePath));
  let depth = 0;
  while (dir !== fsRoot && depth < 10) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
    dir = path.dirname(dir);
    depth++;
  }

  dir = process.cwd();
  depth = 0;
  while (dir !== fsRoot && depth < 10) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
    dir = path.dirname(dir);
    depth++;
  }

  return null;
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

  const pluginRoot = resolvePluginRoot(filePath);
  if (!pluginRoot) return rawInput;

  const { fileMap } = loadIndex(pluginRoot);
  if (Object.keys(fileMap).length === 0) return rawInput;

  const resolvedFile = path.resolve(filePath);
  const relativeToPlugin = path.relative(pluginRoot, resolvedFile);

  const slugMatch = Object.entries(fileMap)
    .find(([key]) => {
      if (!key.startsWith('__slug__')) return false;
      const slug = key.slice('__slug__'.length);
      const norm = relativeToPlugin.replace(/\\/g, '/');
      return norm.split('/').includes(slug);
    })?.[1] || null;

  const entry =
    fileMap[relativeToPlugin] ||
    fileMap[filePath] ||
    Object.entries(fileMap).find(([key]) =>
      key.endsWith('/') && relativeToPlugin.startsWith(key)
    )?.[1] ||
    slugMatch ||
    null;

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
