/**
 * Detect duplicate hook registrations between the oh-my-forge plugin's own
 * hooks/hooks.json and a user's manually-authored ~/.claude/settings.json.
 *
 * Field-observed symptom: users who installed the plugin AND have a manual
 * hook entry left over in ~/.claude/settings.json (often predating plugin
 * support, or copy-pasted from an older setup guide) get every hook event
 * fired twice per turn -- most visibly, SessionStart context gets injected
 * twice. This module is diagnostic-only: it never mutates anything, it just
 * reports the overlap so `doctor.js` can warn about it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Wrapper/runner scripts are expected to appear in both the plugin's
// hooks.json and a hand-authored settings.json (every hook entry references
// one of these); flagging them would just be noise. Only the *target* hook
// script names (session-start-bootstrap.js, pre-compact.js, etc.) are
// meaningful signals of an actual duplicate registration.
const RUNNER_SCRIPT_NAMES = new Set([
  'hook.js',
  'run-with-flags.js',
  'run-with-flags-shell.sh',
]);

const JS_FILENAME_PATTERN = /([A-Za-z0-9][A-Za-z0-9_.-]*\.js)/g;

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Extract distinct, non-runner `.js` script basenames referenced anywhere
 * in a raw JSON/text blob (hooks.json or settings.json). Regex-based on
 * purpose: user settings.json hook commands take several different shapes
 * (direct CLAUDE_PLUGIN_ROOT paths, `node ~/.claude/scripts/hook.js <name>`
 * wrappers, inline spawnSync argument lists), so matching literal script
 * filenames is more robust than trying to parse every command variant.
 */
function extractHookScriptNames(rawText) {
  const names = new Set();
  if (!rawText) return names;

  const pattern = new RegExp(JS_FILENAME_PATTERN.source, 'g');
  let match;
  while ((match = pattern.exec(rawText)) !== null) {
    const name = match[1];
    if (!RUNNER_SCRIPT_NAMES.has(name)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Best-effort check for whether the oh-my-forge plugin is installed for
 * this user, mirroring the two install layouts seen in the field:
 * cache-managed installs (~/.claude/plugins/cache/oh-my-forge) and direct
 * marketplace installs (~/.claude/plugins/oh-my-forge*).
 */
function isPluginInstalled(homeDir) {
  if (!homeDir) return false;
  const pluginsDir = path.join(homeDir, '.claude', 'plugins');

  if (fs.existsSync(path.join(pluginsDir, 'cache', 'oh-my-forge'))) {
    return true;
  }

  try {
    return fs.readdirSync(pluginsDir).some(entry => entry.startsWith('oh-my-forge'));
  } catch {
    return false;
  }
}

/**
 * Compare the hook scripts the plugin registers (hooks/hooks.json) against
 * the hook scripts referenced directly in the user's ~/.claude/settings.json.
 *
 * @param {object} options
 * @param {string} options.repoRoot - Path to the oh-my-forge repo checkout.
 * @param {string} options.homeDir - User home directory.
 * @returns {{ duplicateScripts: string[] } | null} `null` when the check
 *   does not apply (plugin not installed, or either file is missing/unreadable).
 */
function findDuplicateHookRegistrations(options = {}) {
  const { repoRoot, homeDir } = options;
  if (!repoRoot || !homeDir) return null;
  if (!isPluginInstalled(homeDir)) return null;

  const pluginHooksRaw = readTextFile(path.join(repoRoot, 'hooks', 'hooks.json'));
  const userSettingsRaw = readTextFile(path.join(homeDir, '.claude', 'settings.json'));
  if (!pluginHooksRaw || !userSettingsRaw) return null;

  const pluginScripts = extractHookScriptNames(pluginHooksRaw);
  const userScripts = extractHookScriptNames(userSettingsRaw);

  const duplicateScripts = Array.from(pluginScripts)
    .filter(name => userScripts.has(name))
    .sort();

  return { duplicateScripts };
}

module.exports = {
  findDuplicateHookRegistrations,
  isPluginInstalled,
  extractHookScriptNames,
};
