'use strict';

const path = require('path');

// These files are the minimum executable contract for an installed package.
// Keep this list narrow and explicit: every entry must appear in `npm pack`.
const REQUIRED_PACKAGE_ARTIFACT_PATHS = Object.freeze([
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.claude/ontology/index.json',
  '.claude/ontology/domain_install.json',
  'hooks/hooks.json',
  'manifests/install-components.json',
  'manifests/install-modules.json',
  'manifests/install-profiles.json',
  'scripts/ecc.js',
  'scripts/install-apply.js',
  'scripts/install-plan.js',
  'scripts/lib/install-executor.js',
  'scripts/lib/ontology-maintainer.js',
]);

function normalizePackagePath(entry) {
  if (typeof entry !== 'string' || entry.trim().length === 0) {
    return null;
  }

  const normalized = entry.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || normalized.split('/').includes('..')
    || path.posix.isAbsolute(normalized)
  ) {
    return null;
  }

  return normalized;
}

function findMissingDeclaredPackagePaths(declaredPaths, sourcePaths) {
  const knownPaths = new Set(
    [...(sourcePaths || [])]
      .map(normalizePackagePath)
      .filter(Boolean)
  );

  return (declaredPaths || [])
    .map(normalizePackagePath)
    .filter(Boolean)
    .filter(relativePath => !knownPaths.has(relativePath))
    .map(relativePath => `${relativePath} is listed in package.json files but does not exist`);
}

function findMissingRequiredArtifactPaths(artifactPaths) {
  const packaged = artifactPaths instanceof Set ? artifactPaths : new Set(artifactPaths || []);
  return REQUIRED_PACKAGE_ARTIFACT_PATHS.filter(relativePath => !packaged.has(relativePath));
}

function findUntrackedAgentArtifactPaths(artifactPaths, trackedPaths) {
  const packaged = artifactPaths instanceof Set ? artifactPaths : new Set(artifactPaths || []);
  const tracked = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths || []);

  return [...packaged]
    .filter(relativePath => relativePath.startsWith('.agents/'))
    .filter(relativePath => !tracked.has(relativePath))
    .sort();
}

module.exports = {
  REQUIRED_PACKAGE_ARTIFACT_PATHS,
  normalizePackagePath,
  findMissingDeclaredPackagePaths,
  findMissingRequiredArtifactPaths,
  findUntrackedAgentArtifactPaths,
};
