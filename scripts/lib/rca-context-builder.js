#!/usr/bin/env node
/**
 * RCA Context Builder
 *
 * Gathers the context bundle needed for root-cause analysis after a fix commit:
 *   - git diff of the commit
 *   - short git log
 *   - list of changed files mapped to ontology domains
 *   - recent entries from ~/.claude/decisions/index.jsonl
 *   - contents of affected domain JSON files
 *
 * Usage (library):
 *   const { buildRcaBundle } = require('./rca-context-builder');
 *   const bundle = buildRcaBundle({ commitRef: 'HEAD', projectRoot: '/path' });
 *
 * Usage (CLI):
 *   node scripts/lib/rca-context-builder.js [commitRef]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
  return (result.stdout || '').trim();
}

function getGitDiff(commitRef, cwd) {
  return git(['diff', `${commitRef}~1`, commitRef, '--unified=3'], cwd);
}

function getGitLog(cwd) {
  return git(['log', '--oneline', '-8'], cwd);
}

function getChangedFiles(commitRef, cwd) {
  const out = git(['diff', `${commitRef}~1`, commitRef, '--name-only'], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

function getCommitMessage(commitRef, cwd) {
  return git(['log', '-1', '--pretty=%s', commitRef], cwd);
}

// ---------------------------------------------------------------------------
// Ontology helpers
// ---------------------------------------------------------------------------

function resolveOntologyDir(projectRoot) {
  const local = path.join(projectRoot, '.claude', 'ontology');
  if (fs.existsSync(local)) return local;
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const p = path.join(process.env.CLAUDE_PLUGIN_ROOT, '.claude', 'ontology');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadIndex(ontologyDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ontologyDir, 'index.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Map changed file paths to the ontology domains that own them.
 * Returns an array of { domainKey, domainData } for each matched domain.
 */
function getAffectedDomains(changedFiles, projectRoot) {
  const ontologyDir = resolveOntologyDir(projectRoot);
  if (!ontologyDir) return [];

  const index = loadIndex(ontologyDir);
  const matched = new Map(); // domainKey → domainData

  for (const [domainKey, entry] of Object.entries(index)) {
    if (domainKey.startsWith('$') || typeof entry !== 'object') continue;

    const tracked = [
      ...(Array.isArray(entry.files) ? entry.files : []),
      ...(Array.isArray(entry.source) ? entry.source : []),
    ];

    const isMatch = changedFiles.some(changed =>
      tracked.some(t => {
        if (t.endsWith('/')) return changed.startsWith(t);
        return changed === t || changed.startsWith(t + '/');
      })
    );

    if (isMatch && !matched.has(domainKey)) {
      let domainDetail = entry;
      if (entry.detail) {
        const detailPath = path.isAbsolute(entry.detail)
          ? entry.detail
          : path.join(projectRoot, entry.detail);
        try {
          domainDetail = { ...entry, ...JSON.parse(fs.readFileSync(detailPath, 'utf8')) };
        } catch { /* use index entry */ }
      }
      matched.set(domainKey, domainDetail);
    }
  }

  return [...matched.entries()].map(([domainKey, domainData]) => ({ domainKey, domainData }));
}

// ---------------------------------------------------------------------------
// Decisions log
// ---------------------------------------------------------------------------

function getRecentDecisions(limit = 20) {
  const logFile = path.join(os.homedir(), '.claude', 'decisions', 'index.jsonl');
  if (!fs.existsSync(logFile)) return [];
  try {
    const lines = fs.readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main bundle builder
// ---------------------------------------------------------------------------

function buildRcaBundle({ commitRef = 'HEAD', projectRoot = process.cwd() } = {}) {
  const changedFiles = getChangedFiles(commitRef, projectRoot);

  return {
    generatedAt: new Date().toISOString(),
    commitRef,
    commitMessage: getCommitMessage(commitRef, projectRoot),
    gitLog: getGitLog(projectRoot),
    gitDiff: getGitDiff(commitRef, projectRoot),
    changedFiles,
    recentDecisions: getRecentDecisions(20),
    affectedDomains: getAffectedDomains(changedFiles, projectRoot),
  };
}

module.exports = { buildRcaBundle };

// CLI usage
if (require.main === module) {
  const commitRef = process.argv[2] || 'HEAD';
  const bundle = buildRcaBundle({ commitRef, projectRoot: process.cwd() });
  // Print compact summary (not full diff) to stdout for inspection
  const summary = {
    generatedAt: bundle.generatedAt,
    commitRef: bundle.commitRef,
    commitMessage: bundle.commitMessage,
    changedFiles: bundle.changedFiles,
    affectedDomains: bundle.affectedDomains.map(d => d.domainKey),
    recentDecisionsCount: bundle.recentDecisions.length,
    diffLines: bundle.gitDiff.split('\n').length,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
