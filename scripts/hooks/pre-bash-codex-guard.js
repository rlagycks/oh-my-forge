#!/usr/bin/env node
/**
 * PreToolUse Hook: Codex Bash Guard
 *
 * Enforces the codex handoff admission path and blocks shell-level writes
 * to ontology-tracked files before execution.
 *
 *   Guard 1 — Block shell-level writes (heredoc/redirection, tee, cp/mv,
 *             inline interpreter writes, in-place edits) to ontology-tracked
 *             files when the pinned engine is Codex.
 *
 *   Guard 2 — Accept only `codex-handoff.js dispatch --request-file ...`
 *             as the automatic Codex handoff entrypoint.
 *
 *   Guard 3 — Load the request artifact and validate it against the shared
 *             codex handoff schema before dispatch.
 *
 *   Guard 4 — Block duplicate `plan-auto` dispatches for the same domain within
 *             the same session to surface retry loops explicitly.
 *
 *   Guard 5 — Block raw `codex-companion.mjs task ...` calls so prompt-side
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
const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
} = require('../lib/ontology-routing');
const { detectPinnedImplementationEngine } = require('../lib/implementation-engine');

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
const CONTROL_TOKENS = new Set(['|', '||', '&&', ';', '&']);
const EXPLICIT_WRITE_COMMANDS = new Set(['cp', 'mv', 'install', 'touch', 'truncate', 'rm']);

function isMetaPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  const metaPrefixes = [
    '.claude/',
    'scripts/hooks/',
    'scripts/lib/',
    'agents/',
    'skills/',
    'commands/',
    'hooks/',
    'tests/',
    'docs/',
    'node_modules/',
  ];
  for (const prefix of metaPrefixes) {
    if (norm.startsWith(prefix) || norm === prefix.replace(/\/$/, '')) return true;
  }
  if (!norm.includes('/') && (norm.endsWith('.md') || norm.endsWith('.json'))) return true;
  return false;
}

/**
 * Minimal argv tokeniser — handles quoted strings and --flag=value forms.
 * Also handles \\<newline> continuations and treats bare newlines as whitespace.
 * Returns array of tokens with quotes stripped.
 */
function tokenise(cmd) {
  const tokens = [];
  const singleQuotedIndices = new Set();
  let current = '';
  let inSingle = false;
  let inDouble = false;
  // True while the current token has been built exclusively from single-quoted
  // characters (no unquoted chars, no double-quoted chars seen yet).
  let currentEntirelySingleQuoted = true;
  let currentHasContent = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    // Backslash-newline continuation: collapse to nothing (join lines)
    if (ch === '\\' && !inSingle && !inDouble && cmd[i + 1] === '\n') {
      i++; // skip the newline
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      currentHasContent = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      currentEntirelySingleQuoted = false; // double-quoted context
      currentHasContent = true;
      continue;
    }
    if ((ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') && !inSingle && !inDouble) {
      if (current.length) {
        if (currentEntirelySingleQuoted && currentHasContent) {
          singleQuotedIndices.add(tokens.length);
        }
        tokens.push(current);
        current = '';
        currentEntirelySingleQuoted = true;
        currentHasContent = false;
      } else if (currentHasContent) {
        // Empty quoted string (e.g. '') — reset without pushing a token
        currentEntirelySingleQuoted = true;
        currentHasContent = false;
      }
    } else {
      if (!inSingle) currentEntirelySingleQuoted = false; // unquoted char
      current += ch;
      currentHasContent = true;
    }
  }
  if (current.length) {
    if (currentEntirelySingleQuoted && currentHasContent) {
      singleQuotedIndices.add(tokens.length);
    }
    tokens.push(current);
  }
  return { tokens, singleQuotedIndices };
}

/**
 * Returns true if a token looks like a shell redirection operator or target.
 * Examples: `>`, `>>`, `<`, `<<`, `2>&1`, `1>/dev/null`, `2>>file`, `&>file`
 */
function isShellRedirection(tok) {
  // Pure operators: >, >>, <, <<, &>, &>>
  if (/^(?:>{1,2}|<{1,2}|&>{1,2})$/.test(tok)) return true;
  // fd-qualified: 2>&1, 1>/dev/null, 2>>/tmp/log, 0</dev/null
  if (/^\d+>{1,2}(&\d*)?/.test(tok)) return true;
  if (/^\d+<{1,2}/.test(tok)) return true;
  return false;
}

/**
 * Returns true if this redirection token still needs a separate target token.
 * Pure operators like `>`, `>>`, `<`, `<<`, `&>`, `2>`, `0<` are followed by
 * the target as the next token.  Self-contained forms like `2>&1` or
 * `1>/dev/null` already embed the target, so no extra skip is needed.
 */
function redirectionNeedsTarget(tok) {
  // Pure operators: >, >>, <, <<, &>, &>>
  if (/^(?:>{1,2}|<{1,2}|&>{1,2})$/.test(tok)) return true;
  // fd-prefixed operator without embedded target: "2>" or "0<" alone
  if (/^\d+>{1,2}$/.test(tok)) return true;
  if (/^\d+<{1,2}$/.test(tok)) return true;
  return false;
}

/**
 * Returns true if a string contains an unquoted shell variable reference.
 * Catches $VAR, ${VAR}, ${VAR:-default}, $(cmd), etc.
 */
function containsShellVariable(str, singleQuoted = false) {
  if (singleQuoted) return false;
  return /\$/.test(str);
}

function normalizePathString(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveComparablePath(filePath) {
  const absolutePath = path.resolve(String(filePath || ''));
  try {
    return fs.realpathSync.native(absolutePath);
  } catch {
    return absolutePath;
  }
}

function stripInlineComments(command) {
  const value = String(command || '');
  let result = '';
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < value.length; index++) {
    const ch = value[index];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      result += ch;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      while (index < value.length && value[index] !== '\n') index++;
      if (index < value.length) result += '\n';
      continue;
    }

    result += ch;
  }

  return result;
}

function extractRedirectionTarget(tok) {
  const fdTargetMatch = tok.match(/^\d*>{1,2}(.+)$/);
  if (fdTargetMatch && fdTargetMatch[1] && !fdTargetMatch[1].startsWith('&')) {
    return fdTargetMatch[1];
  }
  const mergedTargetMatch = tok.match(/^&>{1,2}(.+)$/);
  if (mergedTargetMatch && mergedTargetMatch[1]) {
    return mergedTargetMatch[1];
  }
  return null;
}

function collectExplicitMutationTargets(command) {
  const { tokens } = tokenise(stripInlineComments(command));
  const candidates = [];

  const pushTarget = value => {
    if (!value || CONTROL_TOKENS.has(value) || value.startsWith('--')) return;
    candidates.push(value);
  };

  for (let index = 0; index < tokens.length; index++) {
    let token = tokens[index];
    if (token === 'sudo') {
      while (index + 1 < tokens.length && tokens[index + 1].startsWith('-')) {
        index++;
      }
      if (index + 1 >= tokens.length) continue;
      index++;
      token = tokens[index];
    }
    if (CONTROL_TOKENS.has(token)) continue;

    if (isShellRedirection(token)) {
      const inlineTarget = extractRedirectionTarget(token);
      if (inlineTarget) pushTarget(inlineTarget);
      if (redirectionNeedsTarget(token) && index + 1 < tokens.length) {
        pushTarget(tokens[index + 1]);
      }
      continue;
    }

    if (token === 'tee') {
      for (let cursor = index + 1; cursor < tokens.length; cursor++) {
        const candidate = tokens[cursor];
        if (CONTROL_TOKENS.has(candidate)) break;
        if (!candidate.startsWith('-') && !isShellRedirection(candidate)) {
          pushTarget(candidate);
        }
      }
      continue;
    }

    if (!EXPLICIT_WRITE_COMMANDS.has(token)) continue;

    const commandTargets = [];
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const candidate = tokens[cursor];
      if (CONTROL_TOKENS.has(candidate)) break;
      if (candidate.startsWith('-') || isShellRedirection(candidate)) continue;
      commandTargets.push(candidate);
    }

    if (token === 'cp' || token === 'install') {
      const target = commandTargets[commandTargets.length - 1];
      if (target) pushTarget(target);
      continue;
    }

    for (const target of commandTargets) pushTarget(target);
  }

  return Array.from(new Set(candidates.map(normalizePathString)));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandMentionsPath(command, candidatePath) {
  const normalizedCommand = normalizePathString(command);
  const normalizedCandidate = normalizePathString(candidatePath);
  if (!normalizedCommand.includes(normalizedCandidate)) return false;

  const escaped = escapeRegex(normalizedCandidate);
  const boundary = '(^|[^A-Za-z0-9_./-])';
  const tail = '($|[^A-Za-z0-9_./-])';
  return new RegExp(`${boundary}${escaped}${tail}`).test(normalizedCommand);
}

function collectQuotedPathCandidates(command) {
  const candidates = [];
  const regex = /['"]([^'"\n]+\/[^'"\n]+)['"]/g;
  let match;
  while ((match = regex.exec(String(command || ''))) !== null) {
    candidates.push(match[1]);
  }
  return Array.from(new Set(candidates.map(normalizePathString)));
}

function isInterpreterMutation(command) {
  const normalized = normalizePathString(command);
  const inlineInterpreter = /\b(?:python\d*|node|perl|ruby|php|bun)\b/.test(normalized);
  if (!inlineInterpreter) return false;

  return [
    /fs\.(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\(/,
    /\bwrite_text\s*\(/,
    /\bwrite_bytes\s*\(/,
    /\bopen\s*\([^)]*,\s*['"`][wa]/,
    /\.write\s*\(/,
    /file_put_contents\s*\(/,
  ].some(pattern => pattern.test(normalized));
}

function isInPlaceEditorMutation(command) {
  const normalized = normalizePathString(command);
  return /\bsed\b[^\n]*\s-i(?:\S*)?\b/.test(normalized) ||
    /\bperl\b[^\n]*\s-pi(?:\S*)?\b/.test(normalized);
}

function findTrackedShellMutation(command, ontologyRoot) {
  if (!command || !ontologyRoot) return null;

  const comparableRoot = resolveComparablePath(ontologyRoot);
  const { fileMap } = loadOntologyMaps(comparableRoot);
  const engine = detectPinnedImplementationEngine(comparableRoot);
  if (engine !== 'codex') return null;

  const rootVariants = Array.from(new Set([
    normalizePathString(comparableRoot),
    normalizePathString(path.resolve(ontologyRoot)),
  ]));
  const explicitTargets = collectExplicitMutationTargets(command);

  for (const candidate of explicitTargets) {
    const resolvedTarget = path.isAbsolute(candidate)
      ? resolveComparablePath(candidate)
      : resolveComparablePath(path.resolve(process.cwd(), candidate));
    const match = matchFileToDomain({ filePath: resolvedTarget, ontologyRoot: comparableRoot, fileMap });
    if (!match?.domainKey) continue;

    const relPath = normalizePathString(path.relative(comparableRoot, resolvedTarget));
    if (isMetaPath(relPath)) continue;
    return { domainKey: match.domainKey, relPath, detector: 'explicit-target' };
  }

  if (!isInterpreterMutation(command) && !isInPlaceEditorMutation(command)) {
    return null;
  }

  for (const candidate of collectQuotedPathCandidates(command)) {
    const resolvedTarget = path.isAbsolute(candidate)
      ? resolveComparablePath(candidate)
      : resolveComparablePath(path.resolve(process.cwd(), candidate));
    const match = matchFileToDomain({ filePath: resolvedTarget, ontologyRoot: comparableRoot, fileMap });
    if (!match?.domainKey) continue;

    const relPath = normalizePathString(path.relative(comparableRoot, resolvedTarget));
    if (isMetaPath(relPath)) continue;
    return { domainKey: match.domainKey, relPath, detector: 'inline-mutation' };
  }

  for (const [trackedKey, entry] of Object.entries(fileMap)) {
    if (trackedKey.startsWith('__slug__') || trackedKey.endsWith('/')) continue;
    const relPath = normalizePathString(trackedKey);
    if (isMetaPath(relPath)) continue;

    const absolutePaths = rootVariants.map(rootVariant => normalizePathString(path.join(rootVariant, trackedKey)));
    const mentioned = commandMentionsPath(command, relPath) ||
      absolutePaths.some(candidate => commandMentionsPath(command, candidate));
    if (!mentioned) {
      continue;
    }

    return { domainKey: entry.domainKey, relPath, detector: 'inline-mutation' };
  }

  return null;
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
  const { tokens, singleQuotedIndices } = tokenise(command);

  const subcommandIdx = tokens.findIndex(t => t === subcommand);
  if (subcommandIdx === -1) return null;

  const prefix = tokens.slice(0, subcommandIdx + 1).join(' ');
  const rest = tokens.slice(subcommandIdx + 1);
  // restOffset maps rest[j] back to its index in the original tokens array,
  // allowing singleQuotedIndices lookups for flag values.
  const restOffset = subcommandIdx + 1;

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
        // For --key=value the value is embedded in the same token;
        // its quoting context cannot be cheaply recovered, so be conservative.
        flags.push({ key, value, raw: tok, singleQuoted: false });
        i++;
      } else {
        const key = tok.slice(2);
        const nextTok = rest[i + 1];
        // Guard: never consume a redirection operator as a flag value
        if (valueFlags.has(key) && i + 1 < rest.length &&
            !nextTok.startsWith('--') && !isShellRedirection(nextTok)) {
          const valTokenIdx = restOffset + i + 1;
          flags.push({ key, value: nextTok, raw: `${tok} ${nextTok}`,
            singleQuoted: singleQuotedIndices.has(valTokenIdx) });
          i += 2;
        } else {
          flags.push({ key, value: null, raw: tok, singleQuoted: false });
          i++;
        }
      }
    } else if (isShellRedirection(tok)) {
      i++;
      // Pure operators (>, >>, <, <<, 2>, …) are followed by a separate target
      // token — skip it too so it is never mistaken for a positional argument.
      if (redirectionNeedsTarget(tok) && i < rest.length) {
        i++;
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

  const ontologyRoot = resolveProjectOntologyRoot({ cwd: process.cwd() });
  const trackedMutation = findTrackedShellMutation(command, ontologyRoot);
  if (trackedMutation) {
    const msg = [
      '',
      '[CODEX GUARD] Shell write blocked — tracked source file',
      '',
      `  File    : ${trackedMutation.relPath}`,
      `  Domain  : ${trackedMutation.domainKey}`,
      `  Signal  : ${trackedMutation.detector}`,
      '',
      '  Shell-level file mutation would bypass the Edit/Write guard for an ontology-tracked file.',
      '  Delegate the change via /codex-delegate, or set ECC_BYPASS_CODEX_GUARD=1',
      '  for an explicit operator override.',
      '',
      `    /codex-delegate ${trackedMutation.domainKey}`,
      '',
    ].join('\n');

    process.stderr.write(msg);
    return { exitCode: 2 };
  }

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

    // Skip file validation when the path contains unexpanded shell variables —
    // the shell will expand them at execution time; we cannot read them now.
    if (!containsShellVariable(requestFileFlag.value, requestFileFlag.singleQuoted)) {
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
