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
  'scripts/omf.js',
  'scripts/install-apply.js',
  'scripts/install-plan.js',
  'scripts/lib/install-executor.js',
  'scripts/lib/ontology-maintainer.js',
  'scripts/lib/ontology-maintainer-process.js',
  'scripts/lib/ontology-maintainer-providers/claude-code.js',
  'scripts/lib/ontology-maintainer-providers/codex-cli.js',
  'scripts/lib/ontology-maintainer-providers/index.js',
  'scripts/lib/ontology-maintainer-runtime.js',
  'scripts/ontology-maintain.js',
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

function isGlobPattern(relativePath) {
  return /[*?[]/.test(relativePath);
}

function matchesPackageGlob(relativePath, pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else if (character === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close !== -1) {
        expression += pattern.slice(index, close + 1);
        index = close;
      } else {
        expression += '\\[';
      }
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`).test(relativePath);
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
    .filter(relativePath => !isGlobPattern(relativePath))
    .filter(relativePath => !knownPaths.has(relativePath))
    .map(relativePath => `${relativePath} is listed in package.json files but does not exist`);
}

function findMissingDeclaredArtifactPaths(declaredPaths, artifactPaths) {
  const packaged = artifactPaths instanceof Set ? artifactPaths : new Set(artifactPaths || []);

  return (declaredPaths || [])
    .map(normalizePackagePath)
    .filter(Boolean)
    .filter((relativePath) => {
      if (isGlobPattern(relativePath)) {
        return ![...packaged].some(path => matchesPackageGlob(path, relativePath));
      }
      return ![...packaged].some(path => path === relativePath || path.startsWith(`${relativePath}/`));
    })
    .map(relativePath => `${relativePath} is listed in package.json files but does not contribute a path to npm pack`);
}

function findMissingRequiredArtifactPaths(artifactPaths) {
  const packaged = artifactPaths instanceof Set ? artifactPaths : new Set(artifactPaths || []);
  return REQUIRED_PACKAGE_ARTIFACT_PATHS.filter(relativePath => !packaged.has(relativePath));
}

function findUntrackedArtifactPaths(artifactPaths, trackedPaths) {
  const packaged = artifactPaths instanceof Set ? artifactPaths : new Set(artifactPaths || []);
  const tracked = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths || []);

  return [...packaged]
    .filter(relativePath => !tracked.has(relativePath))
    .sort();
}

module.exports = {
  REQUIRED_PACKAGE_ARTIFACT_PATHS,
  normalizePackagePath,
  isGlobPattern,
  matchesPackageGlob,
  findMissingDeclaredPackagePaths,
  findMissingDeclaredArtifactPaths,
  findMissingRequiredArtifactPaths,
  findUntrackedArtifactPaths,
};
