#!/usr/bin/env node
/**
 * PreToolUse Hook: Write/Edit Codex Guard
 *
 * Enforces the Codex-first implementation policy:
 * when Claude is about to directly edit an ontology-tracked source file
 * and Codex is the configured implementation engine, this hook hard-blocks
 * the tool call (exit 2) and redirects to /codex-delegate.
 *
 * Policy:
 *   - File in ontology fileMap + ENGINE = codex → BLOCK (exit 2)
 *   - File not in ontology → pass-through (exit 0)
 *   - ENGINE = claude (Codex unavailable) → pass-through
 *   - ECC_BYPASS_CODEX_GUARD=1 → pass-through (escape hatch)
 *   - Meta paths (.claude/, scripts/, agents/, commands/, skills/, hooks/) → pass-through
 *     EXCEPTION: when pluginRoot === cwd (editing oh-my-forge itself), meta-path bypass
 *     is disabled so the guard remains effective for the plugin's own ontology-tracked files.
 *
 * Trigger: PreToolUse on Write|Edit|MultiEdit
 * Profile: standard,strict
 * Exit 0  → allow tool call
 * Exit 2  → block tool call with redirect message
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ---- Meta path exclusions ----

/**
 * Returns true for paths that are part of the plugin's own meta layer —
 * agent definitions, skill docs, hook scripts, command docs, config, etc.
 * These are never blocked because they are maintained by Claude directly.
 */
function isMetaPath(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const META_PREFIXES = [
    '.claude/',
    'scripts/hooks/',
    'scripts/lib/',
    'agents/',
    'skills/',
    'commands/',
    'hooks/',
    'tests/',
    'docs/',
    'node_modules/',
  ];
  for (const prefix of META_PREFIXES) {
    if (norm.startsWith(prefix) || norm === prefix.replace(/\/$/, '')) return true;
  }
  // Markdown and JSON files at the repo root are also meta
  if (!norm.includes('/') && (norm.endsWith('.md') || norm.endsWith('.json'))) return true;
  return false;
}

// ---- Engine detection (mirrors plan.md Step 2) ----

function detectEngine(pluginRoot) {
  const env = process.env.CLAUDE_IMPL_ENGINE;
  if (env === 'claude') return 'claude';
  if (env === 'codex') return 'codex';

  const settingsCandidates = [
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(pluginRoot || '', '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];

  for (const f of settingsCandidates) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s.implementationEngine === 'claude') return 'claude';
      if (s.implementationEngine === 'codex') return 'codex';
    } catch { /* skip */ }
  }

  try {
    execFileSync('which', ['codex'], { stdio: 'ignore' });
    return 'codex';
  } catch {
    return 'claude';
  }
}

// ---- Ontology loading (mirrors constraint-guard.js) ----

function loadDomainFile(domainFilePath) {
  try {
    return JSON.parse(fs.readFileSync(domainFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadIndex(pluginRoot) {
  const indexPath = path.join(pluginRoot, '.claude', 'ontology', 'index.json');
  if (!fs.existsSync(indexPath)) return {};

  try {
    const content = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const fileMap = {};

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
      for (const fileList of [entry.files, entry.source]) {
        if (Array.isArray(fileList)) {
          for (const file of fileList) {
            fileMap[file] = domainKey;
          }
        }
      }
    }

    return fileMap;
  } catch {
    return {};
  }
}

function resolvePluginRoot(filePath) {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT || '';
  if (envRoot) {
    const marker = path.join(envRoot, '.claude', 'ontology', 'index.json');
    if (fs.existsSync(marker)) return envRoot;
  }

  const fsRoot = path.parse(path.resolve(filePath)).root;

  for (let dir = path.resolve(path.dirname(filePath)), depth = 0;
       dir !== fsRoot && depth < 10;
       dir = path.dirname(dir), depth++) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
  }

  for (let dir = process.cwd(), depth = 0;
       dir !== fsRoot && depth < 10;
       dir = path.dirname(dir), depth++) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
  }

  return null;
}

// ---- Main ----

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  // Escape hatch
  if (process.env.ECC_BYPASS_CODEX_GUARD === '1') return rawInput;

  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';
  if (!filePath) return rawInput;

  const pluginRoot = resolvePluginRoot(filePath);
  if (!pluginRoot) return rawInput;

  const resolvedFile = path.resolve(filePath);
  const relPath = path.relative(pluginRoot, resolvedFile);

  // Skip meta paths — UNLESS we are editing the plugin repo itself (pluginRoot === cwd).
  // When editing oh-my-forge directly, every file is a "meta path" which would make
  // the guard completely ineffective. In self-repo mode, meta-path bypass is disabled
  // so ontology-tracked files remain protected.
  const isSelfRepo = path.resolve(pluginRoot) === path.resolve(process.cwd());
  if (!isSelfRepo && isMetaPath(relPath)) return rawInput;

  // Check ontology
  const fileMap = loadIndex(pluginRoot);
  const domainKey = fileMap[relPath] || fileMap[filePath] ||
    Object.keys(fileMap).find(k => k.endsWith('/') && relPath.replace(/\\/g, '/').startsWith(k)) || null;

  if (!domainKey) return rawInput; // not tracked → no restriction

  // Detect engine
  const engine = detectEngine(pluginRoot);
  if (engine !== 'codex') return rawInput;

  // BLOCK: redirect to /codex-delegate
  const msg = [
    '',
    '[CODEX GUARD] Direct edit blocked — Codex-first policy active',
    '',
    `  File    : ${relPath}`,
    `  Domain  : ${domainKey}`,
    '',
    '  Implementation tasks for ontology-tracked source files must go through Codex.',
    '  Use /codex-delegate to delegate this change, or set ECC_BYPASS_CODEX_GUARD=1',
    '  if you need to make a meta-level edit (hooks, skills, docs).',
    '',
    '  Quick delegation:',
    `    /codex-delegate ${domainKey}`,
    '',
  ].join('\n');

  process.stderr.write(msg);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `[CODEX GUARD] File "${relPath}" is tracked by ${domainKey}. Use /codex-delegate instead.`,
  }));
  process.exit(2);
}

module.exports = { run };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    run(raw);
    process.exit(0);
  });
}
