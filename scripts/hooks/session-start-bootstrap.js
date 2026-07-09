#!/usr/bin/env node
'use strict';

/**
 * session-start-bootstrap.js
 *
 * Bootstrap loader for the OMF SessionStart hook.
 *
 * Problem this solves: the previous approach embedded this logic as an inline
 * `node -e "..."` string inside hooks.json. Characters like `!` (used in
 * `!org.isDirectory()`) can trigger bash history expansion or other shell
 * interpretation issues depending on the environment, causing
 * "SessionStart:startup hook error" to appear in the Claude Code CLI header.
 *
 * By extracting to a standalone file, the shell never sees the JavaScript
 * source and the `!` characters are safe. Behaviour is otherwise identical.
 *
 * How it works:
 *   1. Reads the raw JSON event from stdin (passed by Claude Code).
 *   2. Resolves the OMF plugin root directory (via CLAUDE_PLUGIN_ROOT env var
 *      or a set of well-known fallback paths).
 *   2b. Writes the resolved root to ~/.claude/.omf-root (a plain-text pointer
 *       file) so markdown command/skill snippets can resolve the plugin root
 *       with a cheap `cat` instead of embedding the full probing logic as an
 *       inline `node -p` one-liner. Never fails the hook if this write fails.
 *   3. Delegates to `scripts/hooks/run-with-flags.js` with the `session:start`
 *      event, which applies hook-profile gating and then runs session-start.js.
 *   4. Passes stdout/stderr through and forwards the child exit code.
 *   5. If the plugin root cannot be found, emits a warning and passes stdin
 *      through unchanged so Claude Code can continue normally.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveEccRoot } = require('../lib/resolve-ecc-root');

// Path (relative to plugin root) to the hook runner
const rel = path.join('scripts', 'hooks', 'run-with-flags.js');

// Name of the pointer file written under ~/.claude/ so markdown snippets can
// resolve the plugin root without embedding the full inline resolver.
const ROOT_POINTER_FILENAME = '.omf-root';

/**
 * Returns true when `candidate` looks like a valid OMF plugin root, i.e. the
 * run-with-flags.js runner exists inside it.
 *
 * @param {unknown} candidate
 * @returns {boolean}
 */
function hasRunnerRoot(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  return value.length > 0 && fs.existsSync(path.join(path.resolve(value), rel));
}

/**
 * Resolves the OMF plugin root using the shared resolver so Claude/Codex/plugin
 * cache installs all behave the same way.
 *
 * @param {object} [options]
 * @param {string} [options.homeDir]
 * @returns {string}
 */
function resolvePluginRoot(options = {}) {
  const root = resolveEccRoot({
    homeDir: options.homeDir,
    probe: rel,
  });
  return path.resolve(root);
}

/**
 * Atomically writes the resolved plugin root to ~/.claude/.omf-root so
 * markdown command/skill snippets can resolve it via a plain `cat` instead of
 * re-embedding the full probing logic inline. Only writes when `root`
 * actually looks like a valid OMF plugin root (contains run-with-flags.js).
 *
 * Never throws — failures are logged to stderr and swallowed so this can
 * never block the SessionStart hook.
 *
 * @param {string} root Resolved plugin root directory
 * @param {object} [options]
 * @param {string} [options.homeDir] Override home directory (for testing)
 * @returns {boolean} true when the pointer file was written
 */
function writeRootPointer(root, options = {}) {
  try {
    if (!hasRunnerRoot(root)) {
      return false;
    }

    const homeDir = options.homeDir || os.homedir();
    const targetDir = path.join(homeDir, '.claude');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const target = path.join(targetDir, ROOT_POINTER_FILENAME);
    const tmpTarget = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmpTarget, `${path.resolve(root)}\n`, 'utf8');
    fs.renameSync(tmpTarget, target);
    return true;
  } catch (error) {
    process.stderr.write(
      `[SessionStart] WARNING: failed to write plugin root pointer file: ${error.message}\n`
    );
    return false;
  }
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  const root = resolvePluginRoot();
  writeRootPointer(root);
  const script = path.join(root, rel);

  if (fs.existsSync(script)) {
    const result = spawnSync(
      process.execPath,
      [script, 'session:start', 'scripts/hooks/session-start.js', 'minimal,standard,strict'],
      {
        input: raw,
        encoding: 'utf8',
        env: process.env,
        cwd: process.cwd(),
        timeout: 30000,
      }
    );

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    if (stdout) {
      process.stdout.write(stdout);
    } else {
      process.stdout.write(raw);
    }

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.error || result.status === null || result.signal) {
      const reason = result.error
        ? result.error.message
        : result.signal
          ? 'signal ' + result.signal
          : 'missing exit status';
      process.stderr.write('[SessionStart] ERROR: session-start hook failed: ' + reason + '\n');
      process.exit(1);
    }

    process.exit(Number.isInteger(result.status) ? result.status : 0);
  }

  process.stderr.write(
    '[SessionStart] WARNING: could not resolve OMF plugin root; skipping session-start hook\n'
  );
  process.stdout.write(raw);
}

module.exports = {
  hasRunnerRoot,
  resolvePluginRoot,
  writeRootPointer,
  ROOT_POINTER_FILENAME,
  main,
};

if (require.main === module) {
  main();
}
