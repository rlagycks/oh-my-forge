#!/usr/bin/env node
/**
 * PostToolUse Hook: Codex Diff Inject
 *
 * After a Codex execution completes, this hook:
 *   1. Captures `git diff HEAD~1` (the changes Codex just made)
 *   2. Writes a session flag: codex_ran = true
 *   3. Returns hookSpecificOutput instructing Claude to review the diff
 *      and run /code-review before finishing the task.
 *
 * Codex execution detection: command must contain one of:
 *   - "codex exec"
 *   - "codex-companion.mjs task"
 *   - "orchestrate-codex-worker.sh"
 *
 * Trigger: PostToolUse on Bash
 * Profile: standard,strict
 * Always exits 0 (never blocks).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---- Session state helpers ----

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getStatePath() {
  return path.join(os.tmpdir(), `ecc-codex-diff-${getSessionKey()}.json`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return { codexRan: false };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf8');
  } catch { /* never block on state failures */ }
}

// ---- Codex execution detection ----

const CODEX_PATTERNS = [
  'codex exec',
  'codex-companion.mjs task',
  'orchestrate-codex-worker.sh',
];

function isCodexExecution(command) {
  if (!command || typeof command !== 'string') return false;
  const lower = command.toLowerCase();
  return CODEX_PATTERNS.some(p => lower.includes(p));
}

// ---- Git diff ----

function getGitDiff() {
  const cwd = process.cwd();

  // Try HEAD~1..HEAD first (last commit = Codex commit)
  const r1 = spawnSync('git', ['diff', 'HEAD~1', 'HEAD', '--stat'], {
    cwd, encoding: 'utf8', timeout: 10000,
  });
  if (!r1.error && r1.status === 0 && r1.stdout.trim()) {
    const r1full = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], {
      cwd, encoding: 'utf8', timeout: 15000,
    });
    return { source: 'HEAD~1..HEAD', stat: r1.stdout.trim(), diff: (r1full.stdout || '').slice(0, 8000) };
  }

  // Fall back to staged + unstaged changes
  const r2 = spawnSync('git', ['diff', 'HEAD', '--stat'], {
    cwd, encoding: 'utf8', timeout: 10000,
  });
  if (!r2.error && r2.status === 0 && r2.stdout.trim()) {
    const r2full = spawnSync('git', ['diff', 'HEAD'], {
      cwd, encoding: 'utf8', timeout: 15000,
    });
    return { source: 'HEAD (unstaged)', stat: r2.stdout.trim(), diff: (r2full.stdout || '').slice(0, 8000) };
  }

  return null;
}

// ---- Main ----

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  const command = input.tool_input?.command || '';
  if (!isCodexExecution(command)) return rawInput;

  // Mark that Codex ran this session
  const state = loadState();
  state.codexRan = true;
  saveState(state);

  // Get diff
  const diffResult = getGitDiff();

  let diffSection;
  if (!diffResult) {
    diffSection = '(no git diff available — Codex may not have committed changes yet)';
  } else if (!diffResult.stat) {
    diffSection = '(git diff is empty — no changes detected)';
  } else {
    diffSection = [
      `Source: ${diffResult.source}`,
      '',
      '--- stat ---',
      diffResult.stat,
      '',
      '--- diff (first 8 KB) ---',
      diffResult.diff || '(diff output empty)',
    ].join('\n');
  }

  const hookOutput = [
    '[CODEX DIFF REVIEW]',
    'Codex just completed. You MUST review the diff below before finishing.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    diffSection,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    'Required actions:',
    '  1. Review the diff above for correctness, security, and style.',
    '  2. Run /code-review for a thorough automated review.',
    '  3. If issues found: delegate fixes back via /codex-delegate.',
    '  4. If clean: summarize the review findings to the user.',
    '',
    'Do NOT end the session before completing the review.',
  ].join('\n');

  process.stdout.write(JSON.stringify({ hookSpecificOutput: hookOutput }));
  return null; // we already wrote to stdout
}

module.exports = { run };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const result = run(raw);
    if (result !== null) process.stdout.write(result);
    process.exit(0);
  });
}
