'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveEccRoot } = require('../../scripts/lib/resolve-ecc-root');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function touch(filePath, content = '') {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function withEnv(vars, fn) {
  const snapshot = {};
  for (const key of Object.keys(vars)) {
    snapshot[key] = process.env[key];
    const next = vars[key];
    if (next === null || next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(next);
    }
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      const prev = snapshot[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

let passed = 0;
let failed = 0;

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ecc-root-'));
const fakeHome = path.join(fixtureRoot, 'home');
mkdirp(fakeHome);

if (test('prefers CLAUDE_PLUGIN_ROOT when set', () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: '/tmp/omf-claude', CODEX_PLUGIN_ROOT: null }, () => {
    const resolved = resolveEccRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, '/tmp/omf-claude');
  });
})) passed++; else failed++;

if (test('falls back to CODEX_PLUGIN_ROOT when CLAUDE_PLUGIN_ROOT is unset', () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: '/tmp/omf-codex' }, () => {
    const resolved = resolveEccRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, '/tmp/omf-codex');
  });
})) passed++; else failed++;

if (test('detects standard ~/.codex install when probe exists', () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: null }, () => {
    const probePath = path.join(fakeHome, '.codex', 'scripts', 'lib', 'utils.js');
    touch(probePath, '// probe\n');
    const resolved = resolveEccRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, path.join(fakeHome, '.codex'));
  });
})) passed++; else failed++;

if (test('defaults to ~/.claude when no candidates found', () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: null }, () => {
    const cleanHome = path.join(fixtureRoot, 'clean-home');
    mkdirp(cleanHome);
    const resolved = resolveEccRoot({ homeDir: cleanHome });
    assert.strictEqual(resolved, path.join(cleanHome, '.claude'));
  });
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

