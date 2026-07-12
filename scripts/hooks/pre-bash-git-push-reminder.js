#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024;

function run(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    const cmd = String(input.tool_input?.command || '');
    if (/\bgit\s+push\b/.test(cmd)) {
      return {
        stderr: '[Hook] Review changes before push...\n[Hook] Continuing with push (remove this hook to add interactive review)'
      };
    }
  } catch {
    // ignore parse errors and pass through
  }

  return { exitCode: 0 };
}

module.exports = { run };

// Allow direct execution for testing
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    const result = run(raw);

    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    }

    process.stdout.write(raw);
    process.exit(result.exitCode || 0);
  });
}
