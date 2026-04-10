#!/usr/bin/env node
/**
 * PostToolUse Hook: Bug Fix Enforcer
 *
 * After any file edit, checks if the edited file relates to a recent Bash error
 * (tracked by error-tracker.js). If a match is found and no decision has been
 * recorded today for that file, outputs hookSpecificOutput forcing /decide.
 *
 * This enforces the pattern: error → edit → must record root cause
 *
 * hookSpecificOutput is injected back into Claude's context as a message
 * that Claude must respond to before proceeding.
 *
 * Storage read: ~/.claude/tmp/session-errors-<sessionId>.json
 * Storage read: ~/.claude/decisions/index.jsonl
 *
 * Trigger: PostToolUse on Edit|Write|MultiEdit
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
  return path.join(os.homedir(), '.claude', 'tmp', `session-errors-${getSessionKey()}.json`);
}

function getEnforcerStatePath() {
  return path.join(os.homedir(), '.claude', 'tmp', `session-enforcer-${getSessionKey()}.json`);
}

function loadErrors() {
  try {
    const data = fs.readFileSync(getErrorStatePath(), 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Load set of (file, date) pairs already enforced this session.
 * Prevents repeated prompts for the same file.
 */
function loadEnforced() {
  try {
    const data = JSON.parse(fs.readFileSync(getEnforcerStatePath(), 'utf8'));
    return Array.isArray(data) ? new Set(data) : new Set();
  } catch {
    return new Set();
  }
}

function saveEnforced(set) {
  try {
    const tmpDir = path.join(os.homedir(), '.claude', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(getEnforcerStatePath(), JSON.stringify([...set]), 'utf8');
  } catch { /* never block */ }
}

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Check if a decision was already recorded today for this file.
 */
function hasDecisionForFileToday(filePath) {
  const globalLogFile = path.join(os.homedir(), '.claude', 'decisions', 'index.jsonl');
  if (!fs.existsSync(globalLogFile)) return false;

  try {
    const todayStr = today();
    const lines = fs.readFileSync(globalLogFile, 'utf8').split('\n').filter(Boolean);
    const filename = path.basename(filePath);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.date !== todayStr) continue;
        if (!Array.isArray(entry.files)) continue;
        if (entry.files.some(f => f.includes(filename) || filePath.includes(f))) {
          return true;
        }
      } catch { /* skip malformed lines */ }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if the edited file matches any recent error's related files.
 * Returns the matching error entry, or null.
 */
function findMatchingError(filePath, errors) {
  if (!errors.length) return null;

  const filename = path.basename(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Only look at errors from this session (within last 30 minutes)
  const cutoff = Date.now() - 30 * 60 * 1000;

  for (const err of errors) {
    const errTime = new Date(err.timestamp).getTime();
    if (errTime < cutoff) continue;

    // Check if any related file matches
    for (const relFile of (err.relatedFiles || [])) {
      const relFilename = path.basename(relFile);
      if (
        relFilename === filename ||
        normalizedPath.includes(relFile.replace(/\\/g, '/')) ||
        relFile.includes(filename)
      ) {
        return err;
      }
    }

    // Also check if the command directly references the file
    const cmd = err.command || '';
    if (cmd.includes(filename) || cmd.includes(normalizedPath)) {
      return err;
    }
  }

  return null;
}

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    process.stdout.write(rawInput);
    return;
  }

  const toolName = input.tool_name || '';
  if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
    process.stdout.write(rawInput);
    return;
  }

  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';
  if (!filePath) {
    process.stdout.write(rawInput);
    return;
  }

  const errors = loadErrors();
  if (errors.length === 0) {
    process.stdout.write(rawInput);
    return;
  }

  const matchingError = findMatchingError(filePath, errors);
  if (!matchingError) {
    process.stdout.write(rawInput);
    return;
  }

  // Check if already enforced for this file today
  const enforced = loadEnforced();
  const enforcerKey = `${path.basename(filePath)}::${today()}`;
  if (enforced.has(enforcerKey)) {
    process.stdout.write(rawInput);
    return;
  }

  // Check if a decision was already recorded for this file today
  if (hasDecisionForFileToday(filePath)) {
    process.stdout.write(rawInput);
    return;
  }

  // Mark as enforced so we don't repeat
  enforced.add(enforcerKey);
  saveEnforced(enforced);

  // Output hookSpecificOutput to force /decide and /error-capture
  const filename = path.basename(filePath);
  const shortCommand = matchingError.command.slice(0, 120).replace(/\n/g, ' ');
  const exitCode = matchingError.exitCode;

  // Use CLAUDE_PLUGIN_ROOT for plugin installs; fall back to local path for dev
  const decisionsScript = process.env.CLAUDE_PLUGIN_ROOT
    ? `node "${process.env.CLAUDE_PLUGIN_ROOT}/scripts/lib/decisions.js"`
    : 'node scripts/lib/decisions.js';

  const message = [
    `REQUIRED ACTION: You just edited \`${filename}\` after a command failure (exit code ${exitCode}).`,
    ``,
    `Failed command: \`${shortCommand}${matchingError.command.length > 120 ? '...' : ''}\``,
    ``,
    `Before continuing, complete BOTH steps:`,
    ``,
    `**Step 1 — Record the decision with /decide:**`,
    `\`\`\`bash`,
    `${decisionsScript} add \\`,
    `  --domain <domain> \\`,
    `  --type bug-fix \\`,
    `  --summary "<what was wrong>" \\`,
    `  --why "<root cause — WHY did this fail>" \\`,
    `  --files "${filePath}" \\`,
    `  --prevention "<pattern that would have caught this>"`,
    `\`\`\``,
    ``,
    `**Step 2 — Capture as ontology constraint with /error-capture:**`,
    `Run \`/error-capture\` to classify whether this failure represents an ontology gap`,
    `(missing \`constraints[]\` entry) or a harness gap (needs a new enforcement hook/instinct).`,
    `This ensures constraint-guard.js or a future hook will STRUCTURALLY PREVENT the same`,
    `failure from recurring — not just document it.`,
    ``,
    `If this edit is unrelated to the error, you may skip by recording the decision with type=design.`,
  ].join('\n');

  const hookOutput = JSON.stringify({ hookSpecificOutput: { additionalContext: message } });
  process.stdout.write(hookOutput);
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
