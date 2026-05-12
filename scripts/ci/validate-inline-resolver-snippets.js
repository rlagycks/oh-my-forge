#!/usr/bin/env node
/**
 * Keep markdown bootstrap resolver snippets aligned with resolve-ecc-root.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { INLINE_RESOLVE } = require('../lib/resolve-ecc-root');

const ROOT = path.join(__dirname, '../..');
const TARGET_DIRS = ['agents', 'commands', 'docs', 'skills'];
const RESOLVER_SENTINEL = 'process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT';
const NODE_P_SINGLE_QUOTE_PATTERN = /node -p '([^'\n]+)'/;
const INLINE_ASSIGNMENT_PATTERN = /\b(?:const|let|var)\s+\w+\s*=\s*(\(\(\)=>\{.*\}\)\(\));?/;
const REQUIRE_PATH_JOIN_PATTERN = /require\((\(\(\)=>\{.*\}\)\(\))\s*\+\s*['"`]\/scripts\//;
const BACKTICK_LITERAL_PATTERN = /`([^`$\\]*)`/g;
const NORMALIZED_INLINE_RESOLVE = normalizeResolverSnippet(INLINE_RESOLVE);

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

function normalizeResolverSnippet(snippet) {
  return snippet
    .trim()
    .replace(BACKTICK_LITERAL_PATTERN, (_, value) => `'${value.replace(/'/g, "\\'")}'`)
    .replace(/\s+/g, '');
}

function extractResolverSnippet(line) {
  const nodePMatch = line.match(NODE_P_SINGLE_QUOTE_PATTERN);
  if (nodePMatch) {
    return nodePMatch[1];
  }

  const assignmentMatch = line.match(INLINE_ASSIGNMENT_PATTERN);
  if (assignmentMatch) {
    return assignmentMatch[1];
  }

  const requireMatch = line.match(REQUIRE_PATH_JOIN_PATTERN);
  if (requireMatch) {
    return requireMatch[1];
  }

  return null;
}

function validateInlineResolverSnippets(options = {}) {
  const repoRoot = options.repoRoot || ROOT;
  const files = TARGET_DIRS
    .map(dir => path.join(repoRoot, dir))
    .flatMap(collectMarkdownFiles);
  const failures = [];
  let checked = 0;

  for (const file of files) {
    const relativePath = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.includes(RESOLVER_SENTINEL)) {
        continue;
      }

      const snippet = extractResolverSnippet(line);
      if (!snippet) {
        failures.push(`FAIL: ${relativePath}:${index + 1}: expected inline resolver snippet`);
        continue;
      }

      checked++;
      if (normalizeResolverSnippet(snippet) !== NORMALIZED_INLINE_RESOLVE) {
        failures.push(`FAIL: ${relativePath}:${index + 1}: inline resolver drifted from scripts/lib/resolve-ecc-root.js INLINE_RESOLVE`);
      }
    }
  }

  return {
    checked,
    failures,
  };
}

function main() {
  const report = validateInlineResolverSnippets();
  if (report.failures.length > 0) {
    report.failures.forEach(message => console.error(message));
    process.exit(1);
  }

  console.log(`Validated inline resolver snippets (${report.checked} occurrence(s))`);
}

module.exports = {
  validateInlineResolverSnippets,
};

if (require.main === module) {
  main();
}
