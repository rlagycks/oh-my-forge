#!/usr/bin/env node
/**
 * Backward-compatible doc warning hook entrypoint.
 * Kept for consumers that still reference pre-write-doc-warn.js directly.
 */

'use strict';

const { run } = require('./doc-file-warning.js');

module.exports = { run };

// Allow direct execution for testing
if (require.main === module) {
  const path = require('path');
  const MAX_STDIN = 1024 * 1024;
  let data = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += c.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    const result = run(data);

    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    }

    process.stdout.write(data);
    process.exit(result.exitCode || 0);
  });
}
