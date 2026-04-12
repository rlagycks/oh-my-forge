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
} = require('../lib/ontology-routing');

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

  // Dedup check — skip entirely if primary domain already injected this session
  const injected = loadInjected();
  if (injected.has(entry.domainKey)) return rawInput;

  const lines = [];

  if (entry.riskLevel === 'high') {
    lines.push(`[HIGH RISK DOMAIN — review constraints before editing]`);
  }

  lines.push(`[DOMAIN] ${entry.domainKey} (owner: ${entry.owner || 'unknown'})`);

  // Split format: summary + basePath
  if (entry.summary) lines.push(`Summary: ${entry.summary}`);
  if (entry.basePath) lines.push(`Base path: ${entry.basePath}`);

  // Flat format: spec file
  if (entry.spec) lines.push(`Spec: ${entry.spec} — load for full context`);

  // Split format: endpoint summary (method + path only, keep it brief)
  if (Array.isArray(entry.endpoints) && entry.endpoints.length > 0) {
    lines.push(`Endpoints (${entry.endpoints.length}):`);
    for (const ep of entry.endpoints) {
      lines.push(`  ${ep.method} ${ep.path}${ep.summary ? ' — ' + ep.summary : ''}`);
    }
  }

  if (entry.symbols && entry.symbols.length > 0) {
    lines.push(`Key symbols: ${entry.symbols.join(', ')}`);
  }

  if (entry.constraints && entry.constraints.length > 0) {
    lines.push('Constraints:');
    for (const c of entry.constraints) {
      lines.push(`  - ${c}`);
    }
  }

  // Multi-hop: surface constraints from dependsOn domains (skip already injected)
  if (entry.dependsOn && entry.dependsOn.length > 0) {
    const newDeps = entry.dependsOn.filter(dep => !injected.has(dep));
    if (newDeps.length > 0) {
      lines.push(`Depends on: ${entry.dependsOn.join(', ')}`);
      for (const dep of newDeps) {
        const depEntry = domainMap[dep];
        if (depEntry?.constraints?.length > 0) {
          lines.push(`  [${dep}] key constraints:`);
          for (const c of depEntry.constraints) {
            lines.push(`    - ${c}`);
          }
        }
      }
    } else {
      lines.push(`Depends on: ${entry.dependsOn.join(', ')} (already in context)`);
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
  if (entry.dependsOn) {
    for (const dep of entry.dependsOn) injected.add(dep);
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
