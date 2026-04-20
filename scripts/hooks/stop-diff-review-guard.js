#!/usr/bin/env node
/**
 * Stop Hook: Diff Review Guard
 *
 * Before the session ends, checks if Codex ran during this session AND
 * there are uncommitted changes (meaning the diff was never reviewed + committed).
 *
 * If both conditions are true → exit 2, forcing Claude to continue and
 * complete the review before ending the session.
 *
 * Conditions for blocking:
 *   - Session flag "codexRan" is true  (set by post-bash-codex-diff-inject.js)
 *   - `git status --porcelain` returns non-empty output (unreviewed changes)
 *
 * Conditions for passing through:
 *   - Codex did not run this session
 *   - Codex ran but all changes were committed/reviewed (clean working tree)
 *   - ECC_BYPASS_CODEX_GUARD=1
 *   - git is not available
 *
 * Trigger: Stop
 * Profile: standard,strict
 * Exit 0 → allow session end
 * Exit 2 → block session end (forces Claude to continue + review)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---- Session state (same key as post-bash-codex-diff-inject.js) ----

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

// ---- Git status check ----

function hasUncommittedChanges() {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.error || r.status !== 0) return false; // git not available or error → don't block
  return (r.stdout || '').trim().length > 0;
}

// ---- Main ----

function run(rawInput) {
  try {
    JSON.parse(rawInput);
  } catch {
    process.stdout.write(rawInput || '{}');
    process.exit(0);
  }

  // Escape hatch
  if (process.env.ECC_BYPASS_CODEX_GUARD === '1') {
    process.stdout.write(rawInput);
    process.exit(0);
  }

  const state = loadState();
  if (!state.codexRan) {
    process.stdout.write(rawInput);
    process.exit(0);
  }

  if (!hasUncommittedChanges()) {
    // All clean — review was completed and committed
    process.stdout.write(rawInput);
    process.exit(0);
  }

  // Codex ran + uncommitted changes → force review
  const msg = [
    '',
    '[DIFF REVIEW GUARD] Session blocked — Codex changes not yet reviewed',
    '',
    '  Codex ran during this session but the working tree has uncommitted changes.',
    '  Review the diff before ending the session:',
    '',
    '    1. Run: git diff HEAD   (or git diff HEAD~1 HEAD if Codex committed)',
    '    2. Run: /code-review',
    '    3. Address any issues found, then commit.',
    '',
    '  To bypass this check (e.g. intentional WIP): ECC_BYPASS_CODEX_GUARD=1',
    '',
  ].join('\n');

  process.stderr.write(msg);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[DIFF REVIEW GUARD] Codex ran but diff not reviewed. Run /code-review first.',
  }));
  process.exit(2);
}

// ---- Entry point ----

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8');
  run(raw);
});

module.exports = { run };
