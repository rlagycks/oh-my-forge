'use strict';

/**
 * Shell-command tokenizer and shell-write detection, extracted from
 * scripts/hooks/pre-bash-codex-guard.js (F3 follow-up from PR #50) to bring
 * the hook back under the repo's ~200-line hook guidance.
 *
 * This is a pure extraction — no behavior change. It provides:
 *   - a minimal argv tokeniser (quote/redirection/continuation aware)
 *   - shell-write detection helpers (redirection, tee, cp/mv/install,
 *     in-place editors, inline interpreter writes)
 *   - findTrackedShellMutation(): the ontology-aware entry point used by
 *     pre-bash-codex-guard.js's Guard 1 (tracked-file shell writes).
 *
 * Note: scripts/lib/shell-split.js also parses shell command text, but it
 * solves a different problem (splitting a full command line into segments
 * by &&/||/;/& for other hooks such as pre-bash-dev-server-block.js). The
 * tokeniser here operates within a single command/segment and additionally
 * classifies redirections, quoting, and write-target candidates — logic
 * shell-split.js does not provide. Keeping them separate avoids a
 * behavior-changing merge of two differently-scoped parsers.
 */

const fs = require('fs');
const path = require('path');
const { loadOntologyMaps, matchFileToDomain } = require('./ontology-routing');
const {
  detectPinnedImplementationEngine,
  readImplementationEngineValue,
  touchesImplementationEngine,
} = require('./implementation-engine');
const { isMetaPath, isSelfRepoRoot } = require('./codex-guard-policy');

const CONTROL_TOKENS = new Set(['|', '||', '&&', ';', '&']);
const EXPLICIT_WRITE_COMMANDS = new Set(['cp', 'mv', 'install', 'touch', 'truncate', 'rm']);

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

  // Same self-repo gate as pre-write-edit-codex-guard.js: meta paths are
  // exempt only when the ontology root is NOT the repo we are running in.
  const selfRepo = isSelfRepoRoot(comparableRoot);

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
    if (!selfRepo && isMetaPath(relPath)) continue;
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
    if (!selfRepo && isMetaPath(relPath)) continue;
    return { domainKey: match.domainKey, relPath, detector: 'inline-mutation' };
  }

  for (const [trackedKey, entry] of Object.entries(fileMap)) {
    if (trackedKey.startsWith('__slug__') || trackedKey.endsWith('/')) continue;
    const relPath = normalizePathString(trackedKey);
    if (!selfRepo && isMetaPath(relPath)) continue;

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
 * Bash-side counterpart of pre-write-edit-codex-guard.js's implementationEngine
 * flip guard (PR #50 follow-up F2). A heredoc/redirect/tee/sed/interpreter
 * shell write that targets .claude/settings.json while the command text also
 * references implementationEngine must be blocked exactly like a direct
 * Edit/Write flip is — otherwise a shell-level write bypasses the session pin.
 *
 * Deliberately narrow: only fires when BOTH (a) a write-indicating construct
 * (redirection/tee/cp/mv/install target, or an interpreter/sed in-place edit)
 * targets .claude/settings.json, AND (b) the command text mentions
 * implementationEngine. A read like `cat .claude/settings.json | grep
 * implementationEngine` has no write-indicating construct and is unaffected.
 */
function findEngineFlipShellMutation(command, ontologyRoot) {
  if (!command || !ontologyRoot) return null;
  if (!touchesImplementationEngine(command)) return null;

  const comparableRoot = resolveComparablePath(ontologyRoot);
  const settingsPath = path.join(comparableRoot, '.claude', 'settings.json');
  const settingsTarget = resolveComparablePath(settingsPath);

  const matchesSettings = candidate => {
    const resolvedTarget = path.isAbsolute(candidate)
      ? resolveComparablePath(candidate)
      : resolveComparablePath(path.resolve(process.cwd(), candidate));
    return resolvedTarget === settingsTarget;
  };

  const explicitTargets = collectExplicitMutationTargets(command);
  const targetsSettings = explicitTargets.some(matchesSettings) ||
    ((isInterpreterMutation(command) || isInPlaceEditorMutation(command)) &&
      collectQuotedPathCandidates(command).some(matchesSettings));

  if (!targetsSettings) return null;

  const currentText = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  const current = readImplementationEngineValue(currentText) || detectPinnedImplementationEngine(comparableRoot);
  const proposed = readImplementationEngineValue(command);

  return { relPath: '.claude/settings.json', current, proposed };
}

module.exports = {
  CONTROL_TOKENS,
  EXPLICIT_WRITE_COMMANDS,
  tokenise,
  isShellRedirection,
  redirectionNeedsTarget,
  containsShellVariable,
  normalizePathString,
  resolveComparablePath,
  stripInlineComments,
  extractRedirectionTarget,
  collectExplicitMutationTargets,
  escapeRegex,
  commandMentionsPath,
  collectQuotedPathCandidates,
  isInterpreterMutation,
  isInPlaceEditorMutation,
  findTrackedShellMutation,
  findEngineFlipShellMutation,
};
