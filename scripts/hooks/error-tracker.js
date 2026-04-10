#!/usr/bin/env node
/**
 * PostToolUse Hook: Error Tracker
 *
 * Tracks Bash tool failures (non-zero exit codes) to a session-scoped temp file.
 * This data is consumed by bug-fix-enforcer.js to detect when a file edit
 * follows an error — triggering forced /decide recording.
 *
 * Storage: ~/.claude/tmp/session-errors-<sessionId>.json
 * Format:  Array of { timestamp, exitCode, command, relatedFiles }
 *
 * Trigger: PostToolUse on Bash
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

  // Check exit code from tool response
  const toolResponse = input.tool_response || {};
  const output = toolResponse.output || toolResponse.content || '';

  // Claude Code reports non-zero exit as "exit code N" in output, or via exitCode field
  const exitCode = toolResponse.exitCode !== undefined
    ? toolResponse.exitCode
    : extractExitCode(output);

  if (exitCode === 0 || exitCode === null) {
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
    cwd: process.cwd()
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
