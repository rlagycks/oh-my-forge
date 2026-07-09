#!/usr/bin/env node
/**
 * PostToolUseFailure Hook: Error Tracker
 *
 * Tracks Bash tool failures (non-zero exit codes) to a session-scoped temp file.
 * This data is consumed by bug-fix-enforcer.js to detect when a file edit
 * follows an error — triggering forced /decide recording.
 *
 * Ground truth (Claude Code hooks reference, "PostToolUse"/"PostToolUseFailure"):
 *   - PostToolUse fires only when a tool call SUCCEEDS. For Bash, its
 *     tool_response shape is `{ stdout, stderr, interrupted, isImage }` —
 *     there is no `exitCode` field there.
 *   - A Bash command that exits non-zero fires PostToolUseFailure instead,
 *     with the failure surfaced as a TOP-LEVEL `error` string field (plus
 *     an optional `is_interrupt` boolean) — not nested under tool_response.
 * See https://code.claude.com/docs/en/hooks for the full schemas.
 *
 * Storage: ~/.claude/tmp/session-errors-<sessionId>.json
 * Format:  Array of { timestamp, exitCode, command, relatedFiles, errorMessage }
 *
 * Trigger: PostToolUseFailure on Bash
 * Profile: standard,strict
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getErrorStatePath() {
  const tmpDir = path.join(os.homedir(), '.claude', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  return path.join(tmpDir, `session-errors-${getSessionKey()}.json`);
}

function loadErrors() {
  const statePath = getErrorStatePath();
  try {
    const data = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveErrors(errors) {
  try {
    fs.writeFileSync(getErrorStatePath(), JSON.stringify(errors, null, 2), 'utf8');
  } catch { /* never block */ }
}

/**
 * Extract file paths mentioned in a bash command.
 * Looks for: path-like tokens containing / or . with common extensions,
 * and explicit file arguments.
 */
function extractRelatedFiles(command) {
  if (!command) return [];
  const files = new Set();

  // Match file path patterns: relative/absolute paths with extensions
  const pathRegex = /(?:^|\s|"|')([./~]?[\w.-]+(?:\/[\w.-]+)+(?:\.\w+)?)/g;
  let match;
  while ((match = pathRegex.exec(command)) !== null) {
    const candidate = match[1];
    // Filter out flags and common non-file patterns
    if (!candidate.startsWith('-') && candidate.length > 3) {
      files.add(candidate);
    }
  }

  // Also match bare filenames with extensions (e.g., "plan.md", "utils.js")
  const fileRegex = /\b([\w-]+\.(js|ts|md|json|sh|py|go|rs|toml|yaml|yml))\b/g;
  while ((match = fileRegex.exec(command)) !== null) {
    files.add(match[1]);
  }

  return [...files].slice(0, 10); // cap at 10 files
}

/**
 * A real Bash failure arrives via the PostToolUseFailure event, with the
 * error surfaced as a top-level `error` string (see module header). Some
 * hook harness variants may omit `hook_event_name`; in that case fall back
 * to detecting the presence of a top-level `error` string, but never treat
 * an explicit PostToolUse (success) event as a failure.
 */
function isBashFailureEvent(input) {
  if (input.hook_event_name === 'PostToolUseFailure') return true;
  if (input.hook_event_name === 'PostToolUse') return false;
  return typeof input.error === 'string' && input.error.trim().length > 0;
}

/**
 * Best-effort exit code extraction from a PostToolUseFailure `error` message,
 * e.g. "Command exited with non-zero status code 1" -> 1. The exact code is
 * cosmetic (only used for the enforcer's display message); when it can't be
 * parsed, default to 1 since PostToolUseFailure already guarantees a failure.
 */
function parseExitCodeFromErrorMessage(errorMessage) {
  if (typeof errorMessage !== 'string') return null;
  const match = errorMessage.match(/\bcode[:\s]+(-?\d+)\b/i);
  if (!match) return null;
  const code = parseInt(match[1], 10);
  return Number.isNaN(code) ? null : code;
}

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    process.stdout.write(rawInput);
    return;
  }

  // Only process Bash tool failures
  const toolName = input.tool_name || '';
  if (toolName !== 'Bash') {
    process.stdout.write(rawInput);
    return;
  }

  // A user-initiated interruption (Ctrl-C) is not a bug — don't force a
  // root-cause /decide recording for it.
  if (input.is_interrupt === true) {
    process.stdout.write(rawInput);
    return;
  }

  let exitCode = null;
  let errorMessage = null;

  if (isBashFailureEvent(input)) {
    errorMessage = typeof input.error === 'string' ? input.error : null;
    exitCode = parseExitCodeFromErrorMessage(errorMessage);
    if (exitCode === null) exitCode = 1;
  } else {
    // Defensive fallback for older/non-standard payload shapes that surface
    // exit info under tool_response instead of the documented top-level
    // PostToolUseFailure fields. Real Bash success responses (PostToolUse)
    // never carry an exitCode, so this is expected to be a no-op there.
    const toolResponse = input.tool_response || {};
    const output = toolResponse.output || toolResponse.content || toolResponse.stdout || toolResponse.stderr || '';
    exitCode = toolResponse.exitCode !== undefined
      ? toolResponse.exitCode
      : extractExitCode(output);
  }

  if (exitCode === 0 || exitCode === null || exitCode === undefined) {
    process.stdout.write(rawInput);
    return;
  }

  // Record the error
  const command = (input.tool_input && input.tool_input.command) || '';
  const relatedFiles = extractRelatedFiles(command);

  const errorEntry = {
    timestamp: new Date().toISOString(),
    exitCode,
    command: command.slice(0, 500), // cap length
    relatedFiles,
    cwd: process.cwd(),
    errorMessage: errorMessage ? errorMessage.slice(0, 500) : null
  };

  const errors = loadErrors();
  errors.push(errorEntry);
  saveErrors(errors);

  process.stderr.write(`[error-tracker] Logged failure (exit ${exitCode}). Related files: [${relatedFiles.join(', ') || 'none'}]\n`);

  process.stdout.write(rawInput);
}

/**
 * Try to extract exit code from bash output string.
 * Claude Code often appends "(exit code: N)" or similar.
 */
function extractExitCode(output) {
  if (typeof output !== 'string') return null;
  const match = output.match(/exit(?:\s+code)?[:\s]+(\d+)/i);
  if (match) {
    const code = parseInt(match[1], 10);
    return code === 0 ? null : code;
  }
  // If output indicates error (non-empty stderr-like content), treat as failure
  return null;
}

module.exports = { run };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    run(raw);
    process.exit(0);
  });
}
