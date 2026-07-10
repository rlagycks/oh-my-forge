'use strict';

/**
 * Shared policy predicates for the two Codex guards:
 *
 *   scripts/hooks/pre-write-edit-codex-guard.js  (Write/Edit/MultiEdit side)
 *   scripts/hooks/pre-bash-codex-guard.js        (Bash shell-write side)
 *
 * Both hooks MUST derive their tracked-file verdicts from these predicates so
 * the same file gets the same verdict regardless of which tool performs the
 * write. Policy (tool-agnostic):
 *
 *   - ECC_BYPASS_CODEX_GUARD=1 releases the tracked-file write policy on
 *     both tool paths (explicit operator override).
 *   - Meta paths (hooks, skills, docs, tests, ...) are exempt ONLY when the
 *     ontology root is not the current working repo (self-repo). Inside the
 *     self-repo, meta files that are ontology-tracked stay guarded —
 *     otherwise the guard is ineffective on the plugin's own source.
 */

const fs = require('fs');
const path = require('path');

const META_PATH_PREFIXES = [
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

/**
 * True when the operator explicitly disabled the tracked-file write policy.
 */
function isCodexGuardBypassed(env = process.env) {
  return env.ECC_BYPASS_CODEX_GUARD === '1';
}

/**
 * True for repo-meta paths (relative to the ontology root): plugin
 * infrastructure rather than product source. Root-level .md/.json files
 * also count as meta.
 */
function isMetaPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  for (const prefix of META_PATH_PREFIXES) {
    if (norm.startsWith(prefix) || norm === prefix.replace(/\/$/, '')) return true;
  }
  if (!norm.includes('/') && (norm.endsWith('.md') || norm.endsWith('.json'))) return true;
  return false;
}

function toComparablePath(candidate) {
  const absolute = path.resolve(String(candidate || ''));
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/**
 * True when the ontology root IS the repo the session is running in, OR the
 * cwd is a subdirectory of it (symlink-safe comparison, e.g. /tmp vs
 * /private/tmp on macOS). Running a guard from a subdirectory of the
 * self-repo must not re-enable the meta-path exemption — otherwise `cd
 * scripts && <bash-write>` or an Edit/Write issued while cwd is nested
 * inside the plugin repo would slip past the guard.
 *
 * The subdirectory check is a path-prefix match anchored on a trailing
 * separator so sibling directories that merely share a name prefix (e.g.
 * /repo-foo vs /repo) are never mistaken for a nested cwd.
 * In the self-repo, meta paths are NOT exempt from the codex guard.
 */
function isSelfRepoRoot(ontologyRoot, cwd = process.cwd()) {
  if (!ontologyRoot) return false;
  const comparableRoot = toComparablePath(ontologyRoot);
  const comparableCwd = toComparablePath(cwd);
  if (comparableCwd === comparableRoot) return true;

  const rootWithSep = comparableRoot.endsWith(path.sep) ? comparableRoot : comparableRoot + path.sep;
  return comparableCwd.startsWith(rootWithSep);
}

module.exports = {
  META_PATH_PREFIXES,
  isCodexGuardBypassed,
  isMetaPath,
  isSelfRepoRoot,
  toComparablePath,
};
