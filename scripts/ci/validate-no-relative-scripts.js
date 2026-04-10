#!/usr/bin/env node
/**
 * Prevent relative script invocations in markdown docs that should use plugin root resolvers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const TARGET_DIRS = ['commands', 'agents'];
const RELATIVE_PATTERN = /\bnode\s+["']?(?:\.\/)?(scripts|hooks)\//i;
const VARIABLE_PREFIX_PATTERN = /\bnode\s+["']?\$/;

function collectMarkdownFiles(targetPath) {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return targetPath.toLowerCase().endsWith('.md') ? [targetPath] : [];
  }

  return fs.readdirSync(targetPath)
    .filter(entry => entry !== 'node_modules' && entry !== '.git')
    .flatMap(entry => collectMarkdownFiles(path.join(targetPath, entry)));
}

const files = TARGET_DIRS
  .map(dir => path.join(ROOT, dir))
  .flatMap(collectMarkdownFiles);

const failures = files.flatMap(file => {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const relativePath = path.relative(ROOT, file);

  return lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => RELATIVE_PATTERN.test(line) && !line.includes('CLAUDE_PLUGIN_ROOT') && !VARIABLE_PREFIX_PATTERN.test(line))
    .map(({ line, lineNumber }) => `FAIL: ${relativePath}:${lineNumber}: ${line}`);
});

if (failures.length > 0) {
  failures.forEach(msg => console.error(msg));
  process.exit(1);
}

console.log('Validated: no relative script invocations in commands/ or agents/ docs');
