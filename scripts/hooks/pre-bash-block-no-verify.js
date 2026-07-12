#!/usr/bin/env node
'use strict';

/**
 * PreToolUse Hook: Block git hook-bypass flags
 *
 * Replaces the `npx block-no-verify@1.1.2` network dependency. Inspects a
 * Bash tool_input.command and blocks any git invocation (commit, push,
 * merge, rebase, etc.) that carries a `--no-verify` flag, or a `-n` flag on
 * `git commit`/`git merge` (where `-n` is shorthand for `--no-verify`).
 * `-n` on other git subcommands (e.g. `git push -n` == --dry-run) is left
 * alone.
 *
 * Command strings are split into shell segments (&&, ||, ;, &) via
 * scripts/lib/shell-split.js, then each segment is tokenized with quote
 * awareness so that flags mentioned inside a quoted string (e.g. a commit
 * message, or `echo "--no-verify"`) are never mistaken for a real flag
 * token — quoted whitespace never splits a token.
 *
 * Trigger: PreToolUse on Bash
 * Profile: strict
 */

const { splitShellSegments } = require('../lib/shell-split');

const NO_VERIFY_SUBCOMMANDS_FOR_DASH_N = new Set(['commit', 'merge']);
const WRAPPER_TOKENS = new Set(['sudo', 'command', 'exec', 'time', 'nice', 'nohup']);

/**
 * Tokenize a shell segment into words, respecting single/double quotes and
 * backslash escapes. Quoted whitespace never splits a token, so a flag that
 * appears inside a quoted phrase (e.g. a commit message) is merged into one
 * larger token and can never exactly equal a bare flag like "--no-verify".
 */
function tokenize(segment) {
  const tokens = [];
  let current = '';
  let inToken = false;
  let quoteChar = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];

    if (quoteChar) {
      if (ch === '\\' && quoteChar === '"' && i + 1 < segment.length) {
        current += segment[i + 1];
        i++;
        continue;
      }
      if (ch === quoteChar) {
        quoteChar = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '\\' && i + 1 < segment.length) {
      current += segment[i + 1];
      i++;
      inToken = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      inToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }

    current += ch;
    inToken = true;
  }

  if (inToken) tokens.push(current);
  return tokens;
}

function findGitIndex(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPER_TOKENS.has(t)) {
      i++;
      continue;
    }
    break;
  }
  if (i >= tokens.length) return -1;
  const base = tokens[i].split('/').pop();
  return base === 'git' ? i : -1;
}

function findSubcommand(tokens, gitIdx) {
  for (let j = gitIdx + 1; j < tokens.length; j++) {
    if (!tokens[j].startsWith('-')) return tokens[j];
  }
  return null;
}

function segmentHasBypass(segment) {
  const tokens = tokenize(segment);
  const gitIdx = findGitIndex(tokens);
  if (gitIdx === -1) return null;

  const subcommand = findSubcommand(tokens, gitIdx);

  for (let j = gitIdx + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t === '--no-verify') return { flag: '--no-verify', subcommand };
    if (t === '-n' && NO_VERIFY_SUBCOMMANDS_FOR_DASH_N.has(subcommand)) {
      return { flag: '-n', subcommand };
    }
  }
  return null;
}

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  const command = input.tool_input?.command;
  if (!command || typeof command !== 'string') return rawInput;

  let segments;
  try {
    segments = splitShellSegments(command);
  } catch {
    return rawInput;
  }

  for (const segment of segments) {
    let match;
    try {
      match = segmentHasBypass(segment);
    } catch {
      continue;
    }
    if (match) {
      return {
        exitCode: 2,
        stderr: `[BlockNoVerify] Blocked: "git ${match.subcommand || ''} ${match.flag}" bypasses git hooks (pre-commit, commit-msg, pre-push). Remove ${match.flag} and let hooks run.`,
      };
    }
  }

  return rawInput;
}

module.exports = { run };

// Allow direct execution for testing / Codex hook runner
if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const result = run(raw);
    if (typeof result === 'string') {
      process.stdout.write(result);
      process.exit(0);
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exit(Number.isInteger(result.exitCode) ? result.exitCode : 0);
    }
  });
}
