#!/usr/bin/env node
/**
 * PreToolUse Hook: Codex Bash Guard
 *
 * Enforces the codex handoff admission path before execution.
 *
 *   Guard 1 — Accept only `codex-handoff.js dispatch --request-file ...`
 *             as the automatic Codex handoff entrypoint.
 *
 *   Guard 2 — Load the request artifact and validate it against the shared
 *             codex handoff schema before dispatch.
 *
 *   Guard 3 — Block duplicate `plan-auto` dispatches for the same domain within
 *             the same session to surface retry loops explicitly.
 *
 *   Guard 4 — Block raw `codex-companion.mjs task ...` calls so prompt-side
 *             command assembly cannot bypass runtime validation.
 *
 * Trigger: PreToolUse on Bash
 * Profile: standard,strict
 * Exit 0  → pass-through
 * Exit 2  → block tool execution
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { validateHandoff } = require('../lib/codex-handoff');

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
    return { domains: {} };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf8');
  } catch { /* never block on state save failure */ }
}

// ---- Command parsing ----

const DISPATCH_VALUE_FLAGS = new Set([
  'request-file',
  'companion-path',
  'fresh',
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

function isCodexDispatchCall(command) {
  return /codex-handoff\.js/.test(command) &&
    /\bdispatch\b/.test(command);
}

/**
 * Parse a subcommand invocation into:
 *   { prefix, flags, inlinePrompt }
 *
 * prefix       — everything up to and including "task"
 * flags        — array of { key, value, raw } for flags after "task"
 * inlinePrompt — the positional argument (if any) that is not a flag
 *
 * Returns null if parsing fails.
 */
function parseCall(command, subcommand, valueFlags = new Set()) {
  const tokens = tokenise(command);

  const subcommandIdx = tokens.findIndex(t => t === subcommand);
  if (subcommandIdx === -1) return null;

  const prefix = tokens.slice(0, subcommandIdx + 1).join(' ');
  const rest = tokens.slice(subcommandIdx + 1);

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
        if (valueFlags.has(key) && i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
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
 * Returns the first matching flag object, if present.
 */
function getFlag(flags, key) {
  return flags.find(flag => flag.key === key) || null;
}

function readRequestFile(requestFile) {
  try {
    return JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  } catch (error) {
    return { error: `Failed to read request file: ${error.message}` };
  }
}

function block(messageLines) {
  process.stderr.write(`\n[CodexGuard] BLOCKED: ${messageLines.join('\n')}\n\n`);
  return { exitCode: 2 };
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

  if (isCodexDispatchCall(command)) {
    const parsed = parseCall(command, 'dispatch', DISPATCH_VALUE_FLAGS);
    if (!parsed) return rawInput;

    const invalidFlags = parsed.flags
      .filter(flag => !DISPATCH_VALUE_FLAGS.has(flag.key))
      .map(flag => `--${flag.key}`);
    if (invalidFlags.length > 0) {
      return block([
        `Unknown codex-handoff dispatch flags: ${invalidFlags.join(', ')}`,
        'Dispatch admission only accepts explicit request artifacts and companion configuration.',
      ]);
    }

    if (parsed.inlinePrompt && parsed.inlinePrompt.trim().length > 0) {
      return block([
        'Inline positional arguments are not allowed for codex handoff dispatch.',
        'Pass a schema-validated request via --request-file <path>.',
      ]);
    }

    const requestFileFlag = getFlag(parsed.flags, 'request-file');
    if (!requestFileFlag || !requestFileFlag.value) {
      return block([
        'Missing required --request-file <path>.',
        'Codex handoff dispatch must receive a schema-validated request artifact.',
      ]);
    }

    const payload = readRequestFile(requestFileFlag.value);
    if (payload.error) {
      return block([payload.error]);
    }

    const validation = validateHandoff(payload);
    if (!validation.valid) {
      return block([
        `Invalid codex handoff request: ${validation.error}`,
        'Fix the request artifact before dispatching Codex.',
      ]);
    }

    if (payload.source === 'plan-auto') {
      const domainKey = payload.kind === 'domain' ? payload.domainId : '_default';
      const state = loadState();
      if ((state.domains[domainKey] || 0) >= 1) {
        return block([
          `Codex dispatch for domain "${domainKey}" already invoked this session.`,
          'A second automatic dispatch indicates the first failed or retried unexpectedly.',
          'Fix the request or result handling before retrying.',
        ]);
      }

      state.domains = state.domains || {};
      state.domains[domainKey] = (state.domains[domainKey] || 0) + 1;
      saveState(state);
    }

    return rawInput;
  }

  if (!isCodexCompanionTaskCall(command)) return rawInput;

  if (parseCall(command, 'task', new Set([
    'model', 'effort', 'cwd', 'prompt-file', 'output-format', 'domain-id',
  ]))) {
    return block([
      'Raw codex-companion.mjs task calls are not allowed.',
      'Dispatch Codex through scripts/lib/codex-handoff.js dispatch --request-file <path>.',
    ]);
  }

  return rawInput;
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
