'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getSessionKey() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getPinnedEnginePath(projectRoot) {
  const rootHash = crypto
    .createHash('sha1')
    .update(path.resolve(projectRoot || process.cwd()))
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `ecc-codex-engine-${getSessionKey()}-${rootHash}.json`);
}

// Stamped into every pin this version writes. Pins written before Codex became
// opt-in carry no marker: they recorded engine: "codex" purely because a codex
// binary was on PATH, and honoring them after the upgrade would keep forcing the
// codex-first lockdown on users who never opted in. Bump this whenever a change
// to the resolution policy makes previously-cached verdicts wrong.
const ENGINE_PIN_POLICY = 'codex-opt-in-v1';

function loadPinnedEngine(projectRoot) {
  try {
    const data = JSON.parse(fs.readFileSync(getPinnedEnginePath(projectRoot), 'utf8'));
    if (data?.policy !== ENGINE_PIN_POLICY) return null;
    return data?.engine === 'claude' || data?.engine === 'codex' ? data.engine : null;
  } catch {
    return null;
  }
}

function savePinnedEngine(projectRoot, engine) {
  try {
    fs.writeFileSync(
      getPinnedEnginePath(projectRoot),
      JSON.stringify({ engine, policy: ENGINE_PIN_POLICY }),
      'utf8'
    );
  } catch { /* never block on state save failure */ }
}

function readConfiguredEngine(projectRoot) {
  const env = process.env.CLAUDE_IMPL_ENGINE;
  if (env === 'claude') return 'claude';
  if (env === 'codex') return 'codex';

  const settingsCandidates = [
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(projectRoot || '', '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];

  for (const filePath of settingsCandidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed.implementationEngine === 'claude') return 'claude';
      if (parsed.implementationEngine === 'codex') return 'codex';
    } catch { /* skip */ }
  }

  // Codex is opt-in. Having the binary installed is not a statement of intent,
  // and treating it as one silently locks every ontology-tracked file behind
  // /codex-delegate for users who never asked for it. To route work through
  // Codex, set implementationEngine: "codex" or CLAUDE_IMPL_ENGINE=codex.
  return 'claude';
}

function detectPinnedImplementationEngine(projectRoot) {
  const env = process.env.CLAUDE_IMPL_ENGINE;
  if (env === 'claude') return 'claude';
  if (env === 'codex') return 'codex';

  const pinned = loadPinnedEngine(projectRoot);
  if (pinned) return pinned;

  const detected = readConfiguredEngine(projectRoot);
  savePinnedEngine(projectRoot, detected);
  return detected;
}

function readImplementationEngineValue(text) {
  const value = String(text || '');
  try {
    const parsed = JSON.parse(value);
    if (parsed?.implementationEngine === 'claude' || parsed?.implementationEngine === 'codex') {
      return parsed.implementationEngine;
    }
  } catch { /* fall through to regex */ }

  const match = value.match(/["']implementationEngine["']\s*:\s*["'](claude|codex)["']/);
  return match ? match[1] : null;
}

function touchesImplementationEngine(text) {
  return /["']implementationEngine["']/.test(String(text || ''));
}

module.exports = {
  ENGINE_PIN_POLICY,
  detectPinnedImplementationEngine,
  getPinnedEnginePath,
  readConfiguredEngine,
  readImplementationEngineValue,
  touchesImplementationEngine,
};
