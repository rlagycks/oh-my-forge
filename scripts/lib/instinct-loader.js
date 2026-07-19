'use strict';

/**
 * Instinct loader — loads, filters, and formats learned instincts for
 * SessionStart context injection.
 *
 * Extracted from scripts/hooks/session-start.js (pure refactor, no behavior
 * change). Instincts live in ~/.claude/homunculus/instincts/personal/ (global)
 * plus optional project-scoped directories resolved via
 * ~/.claude/homunculus/projects.json. See skills/continuous-learning-v2.
 */

const path = require('path');
const fs = require('fs');

const { getClaudeDir, findFiles, readFile } = require('./utils');

// --- Learned instinct injection (Change 2) ---
const INSTINCT_CONFIDENCE_THRESHOLD = 0.7;
const INSTINCT_CAP = 5;
const INSTINCT_CONTEXT_CHAR_CAP = 600;
const INSTINCT_EXTENSIONS = ['*.yaml', '*.yml'];
const MIN_VERIFIED_EVIDENCE_COUNT = 2;

/**
 * Resolve a filesystem path to its canonical (real) form.
 *
 * Handles symlinks and, on case-insensitive filesystems (macOS, Windows),
 * normalizes casing so that path comparisons are reliable.
 * Falls back to the original path if resolution fails (e.g. path no longer exists).
 *
 * @param {string} p - The path to normalize.
 * @returns {string} The canonical path, or the original if resolution fails.
 */
function normalizePath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Parse the YAML-ish frontmatter of an instinct file plus, if present, the
 * first markdown heading in the body (used as a human-readable title).
 *
 * Deliberately not a full YAML parser (repo is dependency-light) — just
 * splits `key: value` lines between the first pair of `---` markers, and
 * unwraps simple quoted values. Matches the format documented in
 * skills/continuous-learning-v2 and produced by instinct-cli.py.
 *
 * @param {string} content
 * @returns {{ id?: string, trigger?: string, confidence?: string, outcome?: string, title?: string }|null}
 */
function parseInstinctFrontmatter(content) {
  const lines = String(content || '').split('\n');
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) {
        start = i;
        continue;
      }
      end = i;
      break;
    }
  }

  if (start === -1 || end === -1) return null;

  const frontmatter = {};
  for (const line of lines.slice(start + 1, end)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) frontmatter[key] = value;
  }

  let title = '';
  for (const line of lines.slice(end + 1)) {
    const headingMatch = line.match(/^#\s+(.+?)\s*$/);
    if (headingMatch) {
      title = headingMatch[1].trim();
      break;
    }
  }

  return { ...frontmatter, title };
}

/**
 * Load and filter instincts from a single instincts/personal directory.
 * Silently skips unreadable or malformed files — instinct injection must
 * never block session start.
 *
 * @param {string} dir
 * @returns {Array<{id: string, trigger: string, confidence: number, outcome: string, title: string, linkedDomain: string}>}
 */
function loadInstinctsFromDir(dir) {
  if (!dir) return [];

  const files = INSTINCT_EXTENSIONS.flatMap(pattern => findFiles(dir, pattern));
  const instincts = [];

  for (const file of files) {
    const content = readFile(file.path);
    if (!content) continue;

    const parsed = parseInstinctFrontmatter(content);
    if (!parsed || !parsed.id) continue;

    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) continue;

    instincts.push({
      id: parsed.id,
      trigger: parsed.trigger || '',
      confidence,
      outcome: parsed.outcome || '',
      title: parsed.title || '',
      status: parsed.status || 'legacy',
      evidenceCount: Number(parsed.evidence_count) || 0,
      evidenceIds: String(parsed.evidence_ids || '').split(',').map(value => value.trim()).filter(Boolean),
      lastValidated: parsed.last_validated || '',
      expiresAt: parsed.expires_at || '',
      // linked_domain is written by /error-capture (see skills/continuous-learning-v2)
      // and consumed here for domain-scoped recall (loadInstinctsForDomain below).
      linkedDomain: parsed.linked_domain || ''
    });
  }

  return instincts;
}

function isFutureOrUnset(value, now) {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

/**
 * A memory is safe for automatic JIT recall only when it is explicitly
 * validated with independent evidence and has not expired. Legacy instincts
 * remain available to the backward-compatible session-start path, but cannot
 * silently become domain-level working memory.
 */
function isVerifiedExperience(instinct, now = new Date()) {
  if (!instinct || instinct.status !== 'validated') return false;
  if (!Number.isSafeInteger(instinct.evidenceCount)
      || instinct.evidenceCount < MIN_VERIFIED_EVIDENCE_COUNT) return false;
  const evidenceIds = Array.isArray(instinct.evidenceIds) ? instinct.evidenceIds : [];
  if (new Set(evidenceIds).size < MIN_VERIFIED_EVIDENCE_COUNT) return false;
  if (!instinct.lastValidated || !Number.isFinite(Date.parse(instinct.lastValidated))) return false;
  return isFutureOrUnset(instinct.expiresAt, now);
}

function normalizeTerms(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [])];
}

function relevanceScore(instinct, query) {
  const queryTerms = normalizeTerms(query);
  if (queryTerms.length === 0) return 0;
  const haystack = new Set(normalizeTerms(`${instinct.trigger} ${instinct.title} ${instinct.linkedDomain}`));
  return queryTerms.reduce((score, term) => score + (haystack.has(term) ? 1 : 0), 0);
}

function renderedExperienceLength(instinct) {
  const label = instinct.outcome || 'general';
  const name = instinct.title || instinct.id;
  return `  - [${label}] ${instinct.trigger}: ${name}`.length + 1;
}

/**
 * Select a compact, task-relevant experience slice. This stays intentionally
 * lexical and dependency-free so the hook does not require network calls or a
 * model just to decide which local lessons to expose.
 */
function selectRelevantInstincts(instincts, options = {}) {
  const cap = options.cap ?? INSTINCT_CAP;
  const maxChars = options.maxChars ?? INSTINCT_CONTEXT_CHAR_CAP;
  const now = options.now ?? new Date();
  const requireVerified = options.requireVerified ?? false;
  const query = options.query || '';
  const minimumRelevance = options.minimumRelevance
    ?? (normalizeTerms(query).length > 0 ? 1 : 0);
  const candidates = instincts
    .filter(instinct => isFutureOrUnset(instinct.expiresAt, now))
    .filter(instinct => !requireVerified || isVerifiedExperience(instinct, now))
    .map(instinct => ({
      ...instinct,
      relevance: relevanceScore(instinct, query),
      renderedLength: renderedExperienceLength(instinct),
    }))
    .filter(instinct => instinct.relevance >= minimumRelevance)
    .sort((a, b) => {
      if (a.relevance !== b.relevance) return b.relevance - a.relevance;
      const aIsFailure = a.outcome === 'failure' ? 0 : 1;
      const bIsFailure = b.outcome === 'failure' ? 0 : 1;
      if (aIsFailure !== bIsFailure) return aIsFailure - bIsFailure;
      return b.confidence - a.confidence;
    });

  const selected = [];
  let usedChars = 0;
  for (const instinct of candidates) {
    if (selected.length >= cap) break;
    if (usedChars + instinct.renderedLength > maxChars) continue;
    selected.push(instinct);
    usedChars += instinct.renderedLength;
  }
  return selected;
}

/**
 * Locate the project-scoped instincts/personal directory for the current cwd,
 * by matching against ~/.claude/homunculus/projects.json `root` entries.
 *
 * This intentionally reuses the existing project registry rather than
 * reimplementing continuous-learning-v2's git-remote-based project detection
 * (CLAUDE_PROJECT_DIR / git remote / repo path). If the registry is missing,
 * unreadable, or has no matching entry, callers fall back to global-only
 * instincts — no error is raised.
 *
 * @param {string} cwd
 * @returns {string|null}
 */
function findProjectInstinctsDir(cwd) {
  const registryPath = path.join(getClaudeDir(), 'homunculus', 'projects.json');
  const raw = readFile(registryPath);
  if (!raw) return null;

  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!registry || typeof registry !== 'object') return null;

  const normalizedCwd = normalizePath(cwd);

  for (const entry of Object.values(registry)) {
    if (!entry || typeof entry.root !== 'string' || !entry.root) continue;
    const normalizedRoot = normalizePath(entry.root);
    const isMatch = normalizedCwd === normalizedRoot
      || normalizedCwd.startsWith(normalizedRoot + path.sep);
    if (isMatch && entry.id) {
      return path.join(getClaudeDir(), 'homunculus', 'projects', entry.id, 'instincts', 'personal');
    }
  }

  return null;
}

/**
 * Merge global + project instinct lists, deduping by id. Project-scoped
 * instincts take precedence over global ones on id collision, matching
 * instinct-cli.py's documented precedence.
 *
 * @param {Array} globalInstincts
 * @param {Array} projectInstincts
 * @returns {Array}
 */
function mergeInstincts(globalInstincts, projectInstincts) {
  const byId = new Map();
  for (const instinct of globalInstincts) byId.set(instinct.id, instinct);
  for (const instinct of projectInstincts) byId.set(instinct.id, instinct);
  return Array.from(byId.values());
}

/**
 * Select the top instincts to inject: confidence >= threshold, failures
 * surfaced first, capped at `cap`.
 *
 * @param {Array} instincts
 * @param {object} [options]
 * @returns {Array}
 */
function selectTopInstincts(instincts, options = {}) {
  const minConfidence = options.minConfidence ?? INSTINCT_CONFIDENCE_THRESHOLD;
  return selectRelevantInstincts(
    instincts.filter(instinct => instinct.confidence >= minConfidence),
    options
  );
}

/**
 * Render the selected instincts into the additionalContext block, respecting
 * a hard ~600 char cap on the whole block.
 *
 * @param {Array} instincts
 * @returns {string} Empty string when there is nothing to inject.
 */
function buildInstinctsContext(instincts) {
  if (!instincts || instincts.length === 0) return '';

  const header = `Learned instincts (top ${INSTINCT_CAP}, confidence ≥ ${INSTINCT_CONFIDENCE_THRESHOLD}):`;
  const lines = [header];
  let total = header.length;

  for (const instinct of instincts) {
    const label = instinct.outcome || 'general';
    const name = instinct.title || instinct.id;
    const line = `- [${label}] ${instinct.trigger}: ${name}`;
    const addedLength = line.length + 1; // + newline joiner

    if (lines.length > 1 && total + addedLength > INSTINCT_CONTEXT_CHAR_CAP) break;

    lines.push(line);
    total += addedLength;
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * Entry point for SessionStart: load global + project-scoped instincts for
 * `cwd`, merge them (project wins on id collision), select the top
 * high-confidence ones, and render the additionalContext block.
 *
 * @param {string} cwd - Current working directory (process.cwd()).
 * @returns {{ instincts: Array, context: string }} Selected instincts plus the
 *   rendered context block ('' when nothing qualifies for injection).
 */
function collectInstinctContext(cwd) {
  const globalInstinctsDir = path.join(getClaudeDir(), 'homunculus', 'instincts', 'personal');
  const projectInstinctsDir = findProjectInstinctsDir(cwd);
  const candidateInstincts = mergeInstincts(
    loadInstinctsFromDir(globalInstinctsDir),
    projectInstinctsDir ? loadInstinctsFromDir(projectInstinctsDir) : []
  );
  const instincts = selectTopInstincts(candidateInstincts);
  return { instincts, context: buildInstinctsContext(instincts) };
}

/**
 * Load instincts scoped to a single domain, for recall at file-touch time
 * (scripts/hooks/domain-context-inject.js) rather than at SessionStart.
 *
 * Reuses the same global + project directory resolution and parsing as
 * collectInstinctContext, but filters by frontmatter `linked_domain` instead
 * of selecting the global top-N. Does not apply confidence filtering or
 * capping itself — callers should run the result through selectTopInstincts()
 * (e.g. with `{ cap: 2 }`) to pick what to actually inject, keeping selection
 * logic in one place.
 *
 * @param {string} domainKey - e.g. 'domain_hooks'. Returns [] when falsy.
 * @param {string} cwd - Current working directory (process.cwd()), used to
 *   resolve the project-scoped instincts directory.
 * @returns {Array<{id: string, trigger: string, confidence: number, outcome: string, title: string, linkedDomain: string}>}
 */
function loadInstinctsForDomain(domainKey, cwd) {
  if (!domainKey) return [];

  const globalInstinctsDir = path.join(getClaudeDir(), 'homunculus', 'instincts', 'personal');
  const projectInstinctsDir = findProjectInstinctsDir(cwd);
  const candidateInstincts = mergeInstincts(
    loadInstinctsFromDir(globalInstinctsDir),
    projectInstinctsDir ? loadInstinctsFromDir(projectInstinctsDir) : []
  );

  return candidateInstincts.filter(instinct => instinct.linkedDomain === domainKey);
}

module.exports = {
  INSTINCT_CONFIDENCE_THRESHOLD,
  INSTINCT_CAP,
  INSTINCT_CONTEXT_CHAR_CAP,
  INSTINCT_EXTENSIONS,
  MIN_VERIFIED_EVIDENCE_COUNT,
  normalizePath,
  parseInstinctFrontmatter,
  loadInstinctsFromDir,
  findProjectInstinctsDir,
  mergeInstincts,
  selectTopInstincts,
  buildInstinctsContext,
  collectInstinctContext,
  loadInstinctsForDomain,
  isVerifiedExperience,
  selectRelevantInstincts,
};
