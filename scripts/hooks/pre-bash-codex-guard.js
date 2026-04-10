#!/usr/bin/env node
/**
 * PreToolUse Hook: Codex Bash Guard
 *
 * Intercepts `codex-companion.mjs task` Bash calls made by the codex-rescue
 * agent and applies three fixes that prevent the known 5-layer failure chain:
 *
 *   Fix 2 — Strip invalid flags (e.g. --approval-mode workspace-write).
 *            codex-companion.mjs validates flags strictly; unknown flags cause
 *            immediate crash before any task is attempted.
 *
 *   Fix 3 — Rewrite inline positional prompt to --prompt-file.
 *            Long/multiline/Korean prompts break POSIX shell argument parsing
 *            when passed inline. This hook writes the BRIEF to a temp file and
 *            substitutes --prompt-file <path>, making Fix 1 (plan-file creation
 *            in codex-delegate.md) redundant — the hook writes it correctly.
 *
 *   Fix 4 — Block a second codex-companion invocation within the same session.
 *            codex-rescue enters a retry loop when the first call fails; the
 *            hook detects session-scoped state and exits with code 2 to block
 *            the duplicate call and surface a clear error message.
 *
 * Trigger: PreToolUse on Bash
 * Profile: standard,strict
 * Exit 0  → pass-through (modified or unmodified)
 * Exit 2  → block tool execution (duplicate codex call in session)
 *
 * Known-valid flags (from codex-companion.mjs source):
 *   boolean : json, write, resume-last, resume, fresh, background
 *   value   : model, effort, cwd, prompt-file, output-format
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---- Session state helpers (same pattern as constraint-guard.js) ----

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getStatePath() {
  return path.join(os.tmpdir(), `ecc-codex-guard-${getSessionKey()}.json`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return { invocations: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf8');
  } catch { /* never block on state save failure */ }
}

// ---- Command parsing ----

/**
 * Known valid flags for codex-companion.mjs.
 * Source: booleanOptions + valueOptions in codex-companion.mjs.
 */
const BOOLEAN_FLAGS = new Set([
  'json', 'write', 'resume-last', 'resume', 'fresh', 'background',
]);
const VALUE_FLAGS = new Set([
  'model', 'effort', 'cwd', 'prompt-file', 'output-format',
]);

/**
 * Minimal argv tokeniser — handles quoted strings and --flag=value forms.
 * Returns array of tokens preserving quotes stripped.
 */
function tokenise(cmd) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current.length) tokens.push(current);
  return tokens;
}

/**
 * Detect whether the command is a codex-companion.mjs task invocation.
 * Matches: node "…/codex-companion.mjs" task …
 *          node '…/codex-companion.mjs' task …
 */
function isCodexCompanionTaskCall(command) {
  return /codex-companion\.mjs/.test(command) &&
    /\btask\b/.test(command);
}

/**
 * Parse a codex-companion.mjs task invocation into:
 *   { prefix, flags, inlinePrompt }
 *
 * prefix       — everything up to and including "task"
 * flags        — array of { key, value, raw } for flags after "task"
 * inlinePrompt — the positional argument (if any) that is not a flag
 *
 * Returns null if parsing fails.
 */
function parseCompanionCall(command) {
  const tokens = tokenise(command);

  // Find the index of "task" (the subcommand)
  const taskIdx = tokens.findIndex(t => t === 'task');
  if (taskIdx === -1) return null;

  const prefix = tokens.slice(0, taskIdx + 1).join(' ');
  const rest = tokens.slice(taskIdx + 1);

  const flags = [];
  let inlinePrompt = null;
  let i = 0;

  while (i < rest.length) {
    const tok = rest[i];

    if (tok.startsWith('--')) {
      // --key=value or --key value or --boolean-flag
      const eqIdx = tok.indexOf('=');
      if (eqIdx !== -1) {
        const key = tok.slice(2, eqIdx);
        const value = tok.slice(eqIdx + 1);
        flags.push({ key, value, raw: tok });
        i++;
      } else {
        const key = tok.slice(2);
        if (VALUE_FLAGS.has(key) && i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
          flags.push({ key, value: rest[i + 1], raw: `${tok} ${rest[i + 1]}` });
          i += 2;
        } else {
          flags.push({ key, value: null, raw: tok });
          i++;
        }
      }
    } else {
      // Positional argument — the task prompt
      if (inlinePrompt === null) {
        inlinePrompt = tok;
      }
      i++;
    }
  }

  return { prefix, flags, inlinePrompt };
}

/**
 * Rebuild the command string from parsed parts, filtering invalid flags
 * and substituting --prompt-file for an inline prompt.
 *
 * Returns { command, promptFilePath, strippedFlags }
 */
function rebuildCommand(parsed) {
  const { prefix, flags, inlinePrompt } = parsed;

  const strippedFlags = [];
  const validFlags = [];

  for (const flag of flags) {
    const isValid = BOOLEAN_FLAGS.has(flag.key) || VALUE_FLAGS.has(flag.key);
    if (isValid) {
      validFlags.push(flag);
    } else {
      strippedFlags.push(flag.key);
    }
  }

  let promptFilePath = null;

  // Check if --prompt-file already provided (valid existing flag)
  const existingPromptFile = validFlags.find(f => f.key === 'prompt-file');

  if (!existingPromptFile && inlinePrompt && inlinePrompt.length > 0) {
    // Write inline prompt to a temp file
    const hash = crypto
      .createHash('sha1')
      .update(inlinePrompt + getSessionKey())
      .digest('hex')
      .slice(0, 10);
    promptFilePath = path.join(os.tmpdir(), `codex-prompt-${hash}.txt`);
    try {
      fs.writeFileSync(promptFilePath, inlinePrompt, 'utf8');
      validFlags.push({ key: 'prompt-file', value: promptFilePath, raw: `--prompt-file ${promptFilePath}` });
    } catch (err) {
      process.stderr.write(`[CodexGuard] Failed to write prompt file: ${err.message}\n`);
      promptFilePath = null; // fall back to inline
    }
  }

  const flagParts = validFlags.map(f => {
    if (f.value === null) return `--${f.key}`;
    return `--${f.key} ${f.value}`;
  });

  const inlinePart = (!existingPromptFile && promptFilePath === null && inlinePrompt)
    ? `"${inlinePrompt.replace(/"/g, '\\"')}"` : '';

  const parts = [prefix, ...flagParts];
  if (inlinePart) parts.push(inlinePart);

  return {
    command: parts.join(' '),
    promptFilePath,
    strippedFlags,
  };
}

// ---- Main ----

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  const command = input.tool_input?.command;
  if (typeof command !== 'string') return rawInput;

  if (!isCodexCompanionTaskCall(command)) return rawInput;

  // ---- Fix 4: block duplicate invocations within the same session ----
  const state = loadState();
  if (state.invocations >= 1) {
    process.stderr.write(
      '\n[CodexGuard] BLOCKED: codex-companion.mjs task was already invoked this session.\n' +
      '  A second call indicates the first failed and codex-rescue entered a retry loop.\n' +
      '  Fix the BRIEF or prompt content before retrying.\n\n'
    );
    return { exitCode: 2 };
  }

  const parsed = parseCompanionCall(command);
  if (!parsed) return rawInput;

  const { command: newCommand, promptFilePath, strippedFlags } = rebuildCommand(parsed);
  const changed = newCommand !== command || strippedFlags.length > 0;

  if (strippedFlags.length > 0) {
    process.stderr.write(
      `[CodexGuard] Stripped invalid flags: ${strippedFlags.map(f => `--${f}`).join(', ')}\n`
    );
  }

  if (promptFilePath) {
    process.stderr.write(
      `[CodexGuard] Inline prompt rewritten to --prompt-file ${promptFilePath}\n`
    );
  }

  // Record this invocation
  state.invocations = (state.invocations || 0) + 1;
  saveState(state);

  if (!changed) return rawInput;

  const modified = JSON.parse(JSON.stringify(input));
  modified.tool_input.command = newCommand;
  return JSON.stringify(modified);
}

module.exports = { run };

// Allow direct execution for testing
if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const result = run(raw);
    if (typeof result === 'string') {
      process.stdout.write(result);
    } else if (result && typeof result === 'object') {
      if (result.exitCode === 2) {
        process.exit(2);
      }
    } else {
      process.stdout.write(raw);
    }
    process.exit(0);
  });
}
