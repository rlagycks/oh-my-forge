#!/usr/bin/env node
/**
 * Keep markdown bootstrap resolver snippets aligned with resolve-ecc-root.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { INLINE_RESOLVE_SHELL, INLINE_RESOLVE_JS } = require('../lib/resolve-ecc-root');

const ROOT = path.join(__dirname, '../..');
const TARGET_DIRS = ['agents', 'commands', 'docs', 'skills'];

// Any line containing one of these substrings is expected to carry a fully
// formed copy of INLINE_RESOLVE_SHELL or INLINE_RESOLVE_JS. This also catches
// stale copies of the old (retired) inline JS probing blob, since those
// contain the same JS sentinel but will fail the exact-match check below.
const RESOLVER_SENTINEL_JS = 'process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT';
const RESOLVER_SENTINEL_SHELL = '${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-';

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

/**
 * Snippets embedded inside JSON example strings (e.g. hook config blocks in
 * SKILL.md) escape double quotes as \" to stay valid JSON. Undo that so the
 * snippet can be compared against the canonical unescaped form.
 *
 * @param {string} line
 * @returns {string}
 */
function unescapeJsonQuotes(line) {
  return line.replace(/\\"/g, '"');
}

function lineLooksLikeResolverSnippet(line) {
  return line.includes(RESOLVER_SENTINEL_JS) || line.includes(RESOLVER_SENTINEL_SHELL);
}

function lineMatchesCanonicalSnippet(line) {
  const normalized = unescapeJsonQuotes(line);
  return normalized.includes(INLINE_RESOLVE_SHELL) || normalized.includes(INLINE_RESOLVE_JS);
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
      if (!lineLooksLikeResolverSnippet(line)) {
        continue;
      }

      checked++;
      if (!lineMatchesCanonicalSnippet(line)) {
        failures.push(`FAIL: ${relativePath}:${index + 1}: inline resolver drifted from scripts/lib/resolve-ecc-root.js INLINE_RESOLVE_SHELL/INLINE_RESOLVE_JS`);
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
