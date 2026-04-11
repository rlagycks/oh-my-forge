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

// --- Ontology index loading ---

/**
 * Load a single domain JSON file (split format).
 */
function loadDomainFile(domainFilePath) {
  try {
    return JSON.parse(fs.readFileSync(domainFilePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Derive a path slug from a domain key for convention-based matching.
 * "domain_ar" → "ar", "domain_inventory" → "inventory"
 */
function domainSlug(domainKey) {
  return domainKey.replace(/^domain_/, '');
}

/**
 * Load index.json and return both:
 * - fileMap: filePath → domain entry (for fast lookup by file)
 * - domainMap: domainKey → entry (for dependsOn traversal)
 *
 * Supports two formats:
 *   Flat:  { "domain_X": { files: [...], ... } }
 *   Split: { "version": "1.0", "domains": { "domain_X": "./path/to/domain_x.json" } }
 */
function loadIndex(pluginRoot) {
  const indexPath = path.join(pluginRoot, '.claude', 'ontology', 'index.json');
  if (!fs.existsSync(indexPath)) return { fileMap: {}, domainMap: {} };

  try {
    const content = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const fileMap = {};
    const domainMap = {};

    // Detect split format
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

      // Flat format: explicit files[]
      if (Array.isArray(entry.files)) {
        for (const file of entry.files) {
          fileMap[file] = { domainKey, ...entry };
        }
      }

      // Split format: source[] (spec docs)
      if (Array.isArray(entry.source)) {
        for (const file of entry.source) {
          fileMap[file] = { domainKey, ...entry };
        }
      }

      // Convention-based: any path segment matching the domain slug
      // e.g. domain_ar → fileMap key "__slug__ar" for runtime path matching
      const slug = domainSlug(domainKey);
      if (slug) {
        fileMap[`__slug__${slug}`] = { domainKey, ...entry };
      }
    }

    return { fileMap, domainMap };
  } catch {
    return { fileMap: {}, domainMap: {} };
  }
}

/**
 * Resolve the plugin root by walking up from the file path first,
 * then falling back to CLAUDE_PLUGIN_ROOT and cwd.
 *
 * File-path walk comes first so that when editing files in the source
 * directory (e.g. oh-my-forge dev repo), the local ontology is used
 * rather than the cached plugin copy pointed to by CLAUDE_PLUGIN_ROOT.
 */
function resolvePluginRoot(filePath) {
  const fsRoot = path.parse(path.resolve(filePath)).root;

  // 1. Walk up from the edited file — finds the ontology closest to the file
  let dir = path.resolve(path.dirname(filePath));
  let depth = 0;
  while (dir !== fsRoot && depth < 10) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
    dir = path.dirname(dir);
    depth++;
  }

  // 2. Fall back to CLAUDE_PLUGIN_ROOT (e.g. cached plugin install)
  const envRoot = (process.env.CLAUDE_PLUGIN_ROOT || '').trim();
  if (envRoot) {
    const marker = path.join(envRoot, '.claude', 'ontology', 'index.json');
    if (fs.existsSync(marker)) return envRoot;
  }

  // 3. Walk up from cwd
  dir = process.cwd();
  depth = 0;
  while (dir !== fsRoot && depth < 10) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
    dir = path.dirname(dir);
    depth++;
  }

  return null;
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

  const { fileMap, domainMap } = loadIndex(pluginRoot);
  if (Object.keys(fileMap).length === 0) return rawInput;

  const resolvedFile = path.resolve(filePath);
  const relativeToPlugin = path.relative(pluginRoot, resolvedFile);

  // Slug-based convention match: check if any path segment matches a domain slug
  const slugMatch = Object.entries(fileMap)
    .find(([key]) => {
      if (!key.startsWith('__slug__')) return false;
      const slug = key.slice('__slug__'.length);
      // Match path segments: /ar/, /ar\ (Windows), or ends with /ar
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
  const issuesPath = path.join(pluginRoot, 'docs', 'domain-issues', `${entry.domainKey}.md`);
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
