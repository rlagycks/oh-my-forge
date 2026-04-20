#!/usr/bin/env node
/**
 * CI guard: ensure ESLint passes (no warnings/errors).
 *
 * This is intentionally separate from `npm run lint` so CI can run ESLint
 * deterministically without markdownlint noise, and so `npm test` can include
 * an eslint gate to prevent regressions.
 */

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '../..');

async function run() {
  let ESLint;
  try {
    ({ ESLint } = require('eslint'));
  } catch (error) {
    process.stderr.write(`ERROR: Failed to load eslint. Did you run npm install?\n${error.message}\n`);
    process.exit(1);
  }

  const eslint = new ESLint({
    cwd: ROOT,
    errorOnUnmatchedPattern: false,
  });

  const results = await eslint.lintFiles(['.']);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) process.stdout.write(`${output}\n`);

  const totals = results.reduce(
    (acc, result) => ({
      errorCount: acc.errorCount + (result.errorCount || 0),
      warningCount: acc.warningCount + (result.warningCount || 0),
    }),
    { errorCount: 0, warningCount: 0 }
  );

  if (totals.errorCount > 0 || totals.warningCount > 0) {
    process.stderr.write(
      `ERROR: ESLint failed (errors: ${totals.errorCount}, warnings: ${totals.warningCount})\n`
    );
    process.exit(1);
  }
}

run().catch((error) => {
  process.stderr.write(`ERROR: ESLint execution failed: ${error.message}\n`);
  process.exit(1);
});
