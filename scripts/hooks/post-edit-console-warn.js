#!/usr/bin/env node
/**
 * PostToolUse Hook: Warn about console.log statements after edits
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after Edit tool use. If the edited JS/TS file contains console.log
 * statements, warns with line numbers to help remove debug statements
 * before committing.
 */

const { readFile } = require('../lib/utils');

const MAX_STDIN = 1024 * 1024; // 1MB limit

/**
 * Synchronous, in-process implementation used by run-with-flags.js.
 */
function run(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    const filePath = input.tool_input?.file_path;

    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      const content = readFile(filePath);
      if (!content) return { exitCode: 0 };

      const lines = content.split('\n');
      const matches = [];

      lines.forEach((line, idx) => {
        if (/console\.log/.test(line)) {
          matches.push((idx + 1) + ': ' + line.trim());
        }
      });

      if (matches.length > 0) {
        const stderrLines = ['[Hook] WARNING: console.log found in ' + filePath];
        matches.slice(0, 5).forEach(m => stderrLines.push(m));
        stderrLines.push('[Hook] Remove console.log before committing');
        return { exitCode: 0, stderr: stderrLines.join('\n') };
      }
    }
  } catch {
    // Invalid input — pass through
  }

  return { exitCode: 0 };
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
      const input = JSON.parse(data);
      const filePath = input.tool_input?.file_path;

      if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
        const content = readFile(filePath);
        if (!content) { process.stdout.write(data); process.exit(0); }
        const lines = content.split('\n');
        const matches = [];

        lines.forEach((line, idx) => {
          if (/console\.log/.test(line)) {
            matches.push((idx + 1) + ': ' + line.trim());
          }
        });

        if (matches.length > 0) {
          console.error('[Hook] WARNING: console.log found in ' + filePath);
          matches.slice(0, 5).forEach(m => console.error(m));
          console.error('[Hook] Remove console.log before committing');
        }
      }
    } catch {
      // Invalid input — pass through
    }

    process.stdout.write(data);
    process.exit(0);
  });
}
