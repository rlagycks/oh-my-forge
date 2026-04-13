'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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

function loadPinnedEngine(projectRoot) {
  try {
    const data = JSON.parse(fs.readFileSync(getPinnedEnginePath(projectRoot), 'utf8'));
    return data?.engine === 'claude' || data?.engine === 'codex' ? data.engine : null;
  } catch {
    return null;
  }
}

function savePinnedEngine(projectRoot, engine) {
  try {
    fs.writeFileSync(getPinnedEnginePath(projectRoot), JSON.stringify({ engine }), 'utf8');
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

  try {
    execFileSync('which', ['codex'], { stdio: 'ignore' });
    return 'codex';
  } catch {
    return 'claude';
  }
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
  detectPinnedImplementationEngine,
  readImplementationEngineValue,
  touchesImplementationEngine,
};
