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
  const envRoot = options.envRoot !== undefined
    ? options.envRoot
    : (process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || '');

  if (envRoot && envRoot.trim()) {
    return envRoot.trim();
  }

  const homeDir = options.homeDir || os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const codexDir = path.join(homeDir, '.codex');
  const probe = options.probe || path.join('scripts', 'lib', 'utils.js');

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
 * Compact inline version for embedding in command .md code blocks.
 *
 * This is the minified form of resolveEccRoot() suitable for use in
 * node -e "..." scripts where require() is not available before the
 * root is known.
 *
 * Usage in commands:
 *   const _r = <paste INLINE_RESOLVE>;
 *   const sm = require(_r + '/scripts/lib/session-manager');
 */
const INLINE_RESOLVE = `(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),a=[p.join(h,'.claude'),p.join(h,'.codex')],q=p.join('scripts','lib','utils.js');for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],'plugins','oh-my-forge'),p.join(a[j],'plugins','oh-my-forge@rlagycks'),p.join(a[j],'plugins','marketplace','oh-my-forge'),p.join(a[j],'plugins','everything-claude-code'),p.join(a[j],'plugins','everything-claude-code@everything-claude-code'),p.join(a[j],'plugins','marketplace','everything-claude-code'))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ['oh-my-forge','everything-claude-code']){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],'plugins','cache',n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()`;

module.exports = {
  resolveEccRoot,
  INLINE_RESOLVE,
};
