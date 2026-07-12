#!/usr/bin/env node

/**
 * Stop Hook: Check for console.log statements in modified files
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after each response and checks if any modified JavaScript/TypeScript
 * files contain console.log statements. Provides warnings to help developers
 * remember to remove debug statements before committing.
 *
 * Exclusions: test files, config files, and scripts/ directory (where
 * console.log is often intentional).
 */

const fs = require('fs');
const { isGitRepo, getGitModifiedFiles, readFile, log } = require('../lib/utils');

// Files where console.log is expected and should not trigger warnings
const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
  /__mocks__\//,
];

const MAX_STDIN = 1024 * 1024; // 1MB limit

/**
 * Synchronous, in-process implementation used by run-with-flags.js.
 * Mirrors the standalone stdin-driven logic below but never touches
 * process.stdin/process.exit and always returns instead of writing directly.
 *
 * NOTE: this hook doesn't actually read the JSON body — it inspects the
 * current git working tree — so `rawInput` is accepted for contract
 * compatibility but unused. Always pass-through (never blocks).
 */
function run(_rawInput) {
  try {
    if (!isGitRepo()) {
      return { exitCode: 0 };
    }

    const files = getGitModifiedFiles(['\\.tsx?$', '\\.jsx?$'])
      .filter(f => fs.existsSync(f))
      .filter(f => !EXCLUDED_PATTERNS.some(pattern => pattern.test(f)));

    let hasConsole = false;
    const stderrLines = [];

    for (const file of files) {
      const content = readFile(file);
      if (content && content.includes('console.log')) {
        stderrLines.push(`[Hook] WARNING: console.log found in ${file}`);
        hasConsole = true;
      }
    }

    if (hasConsole) {
      stderrLines.push('[Hook] Remove console.log statements before committing');
    }

    return stderrLines.length > 0
      ? { exitCode: 0, stderr: stderrLines.join('\n') }
      : { exitCode: 0 };
  } catch (err) {
    return { exitCode: 0, stderr: `[Hook] check-console-log error: ${err.message}` };
  }
}

module.exports = { run };

// Allow direct execution for testing / legacy spawn path
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    try {
      if (!isGitRepo()) {
        process.stdout.write(data);
        process.exit(0);
      }

      const files = getGitModifiedFiles(['\\.tsx?$', '\\.jsx?$'])
        .filter(f => fs.existsSync(f))
        .filter(f => !EXCLUDED_PATTERNS.some(pattern => pattern.test(f)));

      let hasConsole = false;

      for (const file of files) {
        const content = readFile(file);
        if (content && content.includes('console.log')) {
          log(`[Hook] WARNING: console.log found in ${file}`);
          hasConsole = true;
        }
      }

      if (hasConsole) {
        log('[Hook] Remove console.log statements before committing');
      }
    } catch (err) {
      log(`[Hook] check-console-log error: ${err.message}`);
    }

    // Always output the original data
    process.stdout.write(data);
    process.exit(0);
  });
}
