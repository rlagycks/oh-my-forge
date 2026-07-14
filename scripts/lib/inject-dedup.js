'use strict';

/**
 * Shared session-scoped dedup state for domain-context-inject.js.
 *
 * State file: /tmp/ecc-injected-<sessionKey>.json — tracks which domains have
 * already been injected this session, keyed by CLAUDE_SESSION_ID (or a SHA1
 * of cwd as fallback for environments without that env var).
 *
 * Extracted so pre-compact.js can clear this state on compaction: compaction
 * can drop previously-injected domain context from the visible transcript
 * while session_id stays the same, so without an explicit clear the dedup
 * check would treat every domain as "already injected" for the rest of the
 * session and context would never come back.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getStatePath() {
  return path.join(os.tmpdir(), `ecc-injected-${getSessionKey()}.json`);
}

function loadInjected() {
  try {
    const data = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    return Array.isArray(data) ? new Set(data) : new Set();
  } catch {
    return new Set();
  }
}

function saveInjected(set) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify([...set]), 'utf8');
  } catch { /* ignore write errors — never block */ }
}

/**
 * Clear the dedup state for the current session, so already-injected domains
 * become eligible for re-injection. Call this after any event that can drop
 * previously-injected context (e.g. compaction).
 */
function clearInjected() {
  try {
    fs.rmSync(getStatePath(), { force: true });
  } catch { /* ignore — never block */ }
}

module.exports = { getSessionKey, getStatePath, loadInjected, saveInjected, clearInjected };
