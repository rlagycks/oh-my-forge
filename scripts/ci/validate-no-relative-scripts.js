#!/usr/bin/env node
/**
 * Prevent relative script invocations in markdown docs that should use plugin root resolvers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const TARGET_DIRS = ['commands', 'agents', 'skills'];
const EXECUTABLE_INVOCATION_PATTERN = /\b(?:node|bash|sh|python3?)\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s`]+))/ig;
const RELATIVE_EXECUTABLE_PATH_PATTERN = /^(?:\.\/)?(?:scripts|hooks)\//i;
const ROOT_DOT_FALLBACK_PATTERN = /CLAUDE_PLUGIN_ROOT:-\$\{CODEX_PLUGIN_ROOT:-\.\}/;
const CLAUDE_ONLY_SCRIPT_PATTERN = /CLAUDE_PLUGIN_ROOT[^$\n]*(?:\/scripts\/|\/skills\/)/;
const CODEX_PLUGIN_ROOT_PATTERN = /CODEX_PLUGIN_ROOT/;
const GLOBAL_SKILL_EXEC_PATTERN = /^~\/\.claude\/skills\/.+\/(?:scripts|hooks|commands)\//i;
const BAD_SINGLE_QUOTED_NODE_P_ESCAPE_PATTERN = /node -p '([^'\n]*\\"[^'\n]*)+'/;

function getFenceLanguage(line, currentFenceLanguage) {
  const match = line.match(/^```([^\s`]*)/);
  if (!match) {
    return currentFenceLanguage;
  }

  return currentFenceLanguage === null ? match[1].toLowerCase() : null;
}

function isShellFence(fenceLanguage) {
  return fenceLanguage === 'bash'
    || fenceLanguage === 'sh'
    || fenceLanguage === 'shell'
    || fenceLanguage === 'zsh';
}

function extractExecutedPathTokens(line) {
  const tokens = [];
  for (const match of line.matchAll(EXECUTABLE_INVOCATION_PATTERN)) {
    tokens.push(match[1] || match[2] || match[3] || '');
  }
  return tokens;
}

function isVariableDrivenPath(token) {
  return token.startsWith('$');
}

function hasRelativeExecutablePath(line) {
  return extractExecutedPathTokens(line).some((token) => (
    RELATIVE_EXECUTABLE_PATH_PATTERN.test(token) && !isVariableDrivenPath(token)
  ));
}

function hasHardcodedGlobalSkillExecution(line) {
  return extractExecutedPathTokens(line).some(token => GLOBAL_SKILL_EXEC_PATTERN.test(token));
}

function hasBadSingleQuotedNodePEscaping(line, fenceLanguage) {
  return isShellFence(fenceLanguage) && BAD_SINGLE_QUOTED_NODE_P_ESCAPE_PATTERN.test(line);
}

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
  let fenceLanguage = null;

  return lines
    .map((line, index) => {
      fenceLanguage = getFenceLanguage(line, fenceLanguage);
      return { line, lineNumber: index + 1, fenceLanguage };
    })
    .filter(({ line, fenceLanguage: lineFenceLanguage }) => (
      hasRelativeExecutablePath(line)
      || ROOT_DOT_FALLBACK_PATTERN.test(line)
      || (CLAUDE_ONLY_SCRIPT_PATTERN.test(line) && !CODEX_PLUGIN_ROOT_PATTERN.test(line))
      || hasHardcodedGlobalSkillExecution(line)
      || hasBadSingleQuotedNodePEscaping(line, lineFenceLanguage)
    ))
    .map(({ line, lineNumber }) => `FAIL: ${relativePath}:${lineNumber}: ${line}`);
});

if (failures.length > 0) {
  failures.forEach(msg => console.error(msg));
  process.exit(1);
}

console.log('Validated: no relative script invocations in commands/, agents/, or skills/ docs');
