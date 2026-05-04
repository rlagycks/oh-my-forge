#!/usr/bin/env node
/**
 * Prevent relative script invocations in markdown docs that should use plugin root resolvers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const TARGET_DIRS = ['commands', 'agents', 'skills'];
const EXECUTABLE_RELATIVE_PATTERN = /\b(?:node|bash|sh|python3?)\s+["']?(?:\.\/)?(scripts|hooks)\//i;
const ROOT_DOT_FALLBACK_PATTERN = /CLAUDE_PLUGIN_ROOT:-\$\{CODEX_PLUGIN_ROOT:-\.\}/;
const CLAUDE_ONLY_SCRIPT_PATTERN = /CLAUDE_PLUGIN_ROOT[^$\n]*(?:\/scripts\/|\/skills\/)/;
const CODEX_PLUGIN_ROOT_PATTERN = /CODEX_PLUGIN_ROOT/;
const GLOBAL_SKILL_EXEC_PATTERN = /(?:^|\s)(?:node|bash|sh|python3?)\s+["']?~\/\.claude\/skills\/.+\/(?:scripts|hooks|commands)\//i;

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
    .filter(({ line }) => (
      (EXECUTABLE_RELATIVE_PATTERN.test(line) && !line.includes('$'))
      || ROOT_DOT_FALLBACK_PATTERN.test(line)
      || (CLAUDE_ONLY_SCRIPT_PATTERN.test(line) && !CODEX_PLUGIN_ROOT_PATTERN.test(line))
      || GLOBAL_SKILL_EXEC_PATTERN.test(line)
    ))
    .map(({ line, lineNumber }) => `FAIL: ${relativePath}:${lineNumber}: ${line}`);
});

if (failures.length > 0) {
  failures.forEach(msg => console.error(msg));
  process.exit(1);
}

console.log('Validated: no relative script invocations in commands/, agents/, or skills/ docs');
