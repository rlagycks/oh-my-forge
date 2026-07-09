'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolve the OMF source root directory.
 *
 * Tries, in order:
 *   1. CLAUDE_PLUGIN_ROOT env var (set by Claude Code for hooks, or by user)
 *   2. Standard install location (~/.claude/) — when scripts exist there
 *   3. Exact legacy plugin roots under ~/.claude/plugins/
 *   4. Plugin cache auto-detection — scans ~/.claude/plugins/cache/everything-claude-code/
 *   5. Fallback to ~/.claude/ (original behaviour)
 *
 * @param {object} [options]
 * @param {string} [options.homeDir]  Override home directory (for testing)
 * @param {string} [options.envRoot]  Override CLAUDE_PLUGIN_ROOT (for testing)
 * @param {string} [options.probe]    Relative path used to verify a candidate root
 *                                    contains OMF scripts. Default: 'scripts/lib/utils.js'
 * @returns {string} Resolved OMF root path
 */
function resolveEccRoot(options = {}) {
  const probe = options.probe || path.join('scripts', 'lib', 'utils.js');
  const envRoot = options.envRoot !== undefined
    ? options.envRoot
    : (process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || '');

  if (envRoot && envRoot.trim()) {
    const candidate = envRoot.trim();
    if (fs.existsSync(path.join(candidate, probe))) {
      return candidate;
    }
  }

  const homeDir = options.homeDir || os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const codexDir = path.join(homeDir, '.codex');

  // Standard install — files are copied directly into ~/.claude/
  if (fs.existsSync(path.join(claudeDir, probe))) {
    return claudeDir;
  }

  // Standard install — files are copied directly into ~/.codex/
  if (fs.existsSync(path.join(codexDir, probe))) {
    return codexDir;
  }

  // Exact plugin install locations — oh-my-forge first, then legacy ECC paths
  // for backwards compatibility.
  const legacyPluginRoots = [];
  for (const baseDir of [claudeDir, codexDir]) {
    legacyPluginRoots.push(
      path.join(baseDir, 'plugins', 'oh-my-forge'),
      path.join(baseDir, 'plugins', 'oh-my-forge@rlagycks'),
      path.join(baseDir, 'plugins', 'marketplace', 'oh-my-forge'),
      path.join(baseDir, 'plugins', 'everything-claude-code'),
      path.join(baseDir, 'plugins', 'everything-claude-code@everything-claude-code'),
      path.join(baseDir, 'plugins', 'marketplace', 'everything-claude-code'),
    );
  }

  for (const candidate of legacyPluginRoots) {
    if (fs.existsSync(path.join(candidate, probe))) {
      return candidate;
    }
  }

  // Plugin cache — Claude Code stores marketplace plugins under
  // ~/.claude/plugins/cache/<plugin-name>/<org>/<version>/
  // Scan oh-my-forge cache first, then fall back to everything-claude-code.
  for (const cachePluginName of ['oh-my-forge', 'everything-claude-code']) {
    for (const baseDir of [claudeDir, codexDir]) {
      try {
        const cacheBase = path.join(baseDir, 'plugins', 'cache', cachePluginName);
        const orgDirs = fs.readdirSync(cacheBase, { withFileTypes: true });

        for (const orgEntry of orgDirs) {
          if (!orgEntry.isDirectory()) continue;
          const orgPath = path.join(cacheBase, orgEntry.name);

          let versionDirs;
          try {
            versionDirs = fs.readdirSync(orgPath, { withFileTypes: true });
          } catch {
            continue;
          }

          for (const verEntry of versionDirs) {
            if (!verEntry.isDirectory()) continue;
            const candidate = path.join(orgPath, verEntry.name);
            if (fs.existsSync(path.join(candidate, probe))) {
              return candidate;
            }
          }
        }
      } catch {
        // Plugin cache doesn't exist or isn't readable — continue.
      }
    }
  } // end for cachePluginName

  return claudeDir;
}

/**
 * Canonical one-liners for embedding in command/skill .md snippets.
 *
 * Earlier revisions embedded the full minified resolveEccRoot() probing
 * logic (~1,200 chars of JS) inline in every markdown snippet that needed
 * the plugin root — repeated ~90 times across commands/, skills/, agents/,
 * rules/, and docs/. Every skill load paid the token cost of re-parsing that
 * boilerplate.
 *
 * Now scripts/hooks/session-start-bootstrap.js writes the resolved root to
 * a plain-text pointer file (~/.claude/.omf-root) once per session. Markdown
 * snippets read that pointer file instead of re-deriving the root, while
 * still preferring the CLAUDE_PLUGIN_ROOT / CODEX_PLUGIN_ROOT env vars when
 * set (e.g. when invoked directly as a plugin, before any pointer file
 * exists).
 *
 * Markdown bootstrap snippets under agents/, commands/, docs/, and skills/
 * are validated against these exact strings by
 * scripts/ci/validate-inline-resolver-snippets.js so there is a single
 * source of truth for the inline resolver.
 *
 * Usage in shell snippets:
 *   PLUGIN_ROOT="<paste INLINE_RESOLVE_SHELL>"
 *   node "$PLUGIN_ROOT/scripts/lib/utils.js"
 *
 * Usage in raw JS snippets (e.g. commands/sessions.md):
 *   const root = <paste INLINE_RESOLVE_JS>;
 *   const sm = require(root + '/scripts/lib/session-manager');
 */
const INLINE_RESOLVE_SHELL = '${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-$(cat "$HOME/.claude/.omf-root" 2>/dev/null || echo "$HOME/.claude")}}';

const INLINE_RESOLVE_JS = "(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT||(()=>{try{return require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude','.omf-root'),'utf8').trim()}catch(e){return require('path').join(require('os').homedir(),'.claude')}})())";

module.exports = {
  resolveEccRoot,
  INLINE_RESOLVE_SHELL,
  INLINE_RESOLVE_JS,
};
