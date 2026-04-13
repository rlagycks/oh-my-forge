'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveEccRoot } = require('./resolve-ecc-root');

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'string') return '';
  return path.resolve(candidate);
}

function collectAutoCandidates(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const eccRoot = options.eccRoot || resolveEccRoot({
    homeDir,
    envRoot: options.envRoot,
  });

  const candidates = [
    path.join(eccRoot, 'scripts', 'codex-companion.mjs'),
    path.join(eccRoot, 'scripts', 'codex', 'codex-companion.mjs'),
    path.join(claudeDir, 'plugins', 'codex-plugin-cc', 'scripts', 'codex-companion.mjs'),
    path.join(claudeDir, 'plugins', 'codex-plugin-cc@codex-plugin-cc', 'scripts', 'codex-companion.mjs'),
    path.join(claudeDir, 'plugins', 'marketplace', 'codex-plugin-cc', 'scripts', 'codex-companion.mjs'),
    path.join(claudeDir, 'plugins', 'marketplace', 'codex-plugin-cc@codex-plugin-cc', 'scripts', 'codex-companion.mjs'),
  ];

  const cacheBase = path.join(claudeDir, 'plugins', 'cache', 'codex-plugin-cc');
  try {
    const orgEntries = fs.readdirSync(cacheBase, { withFileTypes: true });
    for (const orgEntry of orgEntries) {
      if (!orgEntry.isDirectory()) continue;
      const orgPath = path.join(cacheBase, orgEntry.name);
      let versionEntries = [];
      try {
        versionEntries = fs.readdirSync(orgPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const versionEntry of versionEntries) {
        if (!versionEntry.isDirectory()) continue;
        candidates.push(path.join(orgPath, versionEntry.name, 'scripts', 'codex-companion.mjs'));
      }
    }
  } catch {
    // optional cache location
  }

  return unique(candidates.map(normalizeCandidate));
}

function resolveCodexCompanionPath(options = {}) {
  const attemptedPaths = [];

  const explicitPath = normalizeCandidate(options.explicitPath);
  if (explicitPath) {
    attemptedPaths.push(explicitPath);
    if (fs.existsSync(explicitPath)) {
      return { path: explicitPath, source: 'flag', attemptedPaths };
    }
  }

  const envPath = normalizeCandidate(options.envPath);
  if (envPath) {
    attemptedPaths.push(envPath);
    if (fs.existsSync(envPath)) {
      return { path: envPath, source: 'env', attemptedPaths };
    }
  }

  const autoCandidates = collectAutoCandidates(options);
  for (const candidate of autoCandidates) {
    attemptedPaths.push(candidate);
    if (fs.existsSync(candidate)) {
      return { path: candidate, source: 'auto', attemptedPaths };
    }
  }

  const message = [
    'Unable to resolve Codex companion path.',
    'Checked, in order: explicit flag, CODEX_COMPANION_PATH, and known auto-discovery locations.',
    attemptedPaths.length > 0 ? `Attempted: ${attemptedPaths.join(', ')}` : 'Attempted: (no candidate paths available)',
  ].join(' ');
  const error = new Error(message);
  error.attemptedPaths = attemptedPaths;
  throw error;
}

module.exports = {
  collectAutoCandidates,
  resolveCodexCompanionPath,
};
