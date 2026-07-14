'use strict';

/**
 * Unit tests for scripts/lib/inject-dedup.js — the shared session-scoped
 * dedup state used by domain-context-inject.js, and cleared by
 * pre-compact.js on compaction (see tests/hooks/pre-compact-dedup-reset.test.js).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const injectDedupPath = path.resolve(__dirname, '../../scripts/lib/inject-dedup.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function withSessionKey(key, fn) {
  const previous = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = key;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = previous;
  }
}

if (test('getSessionKey returns CLAUDE_SESSION_ID when set', () => {
  const { getSessionKey } = freshRequire(injectDedupPath);
  withSessionKey('my-session-key', () => {
    assert.strictEqual(getSessionKey(), 'my-session-key');
  });
})) passed++; else failed++;

if (test('getSessionKey falls back to a 12-char SHA1 of cwd when unset', () => {
  const previous = process.env.CLAUDE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  try {
    const { getSessionKey } = freshRequire(injectDedupPath);
    const key = getSessionKey();
    assert.strictEqual(key.length, 12);
    assert.ok(/^[0-9a-f]{12}$/.test(key), `expected hex string, got ${key}`);
  } finally {
    if (previous !== undefined) process.env.CLAUDE_SESSION_ID = previous;
  }
})) passed++; else failed++;

if (test('getStatePath is scoped to the session key inside os.tmpdir()', () => {
  const { getStatePath } = freshRequire(injectDedupPath);
  withSessionKey('scoped-key-1', () => {
    const statePath = getStatePath();
    assert.ok(statePath.includes('ecc-injected-scoped-key-1.json'), statePath);
  });
})) passed++; else failed++;

if (test('loadInjected returns an empty Set when no state file exists', () => {
  const { loadInjected, getStatePath } = freshRequire(injectDedupPath);
  withSessionKey(`no-state-${Date.now()}`, () => {
    const statePath = getStatePath();
    try { fs.unlinkSync(statePath); } catch { /* not present */ }
    const injected = loadInjected();
    assert.ok(injected instanceof Set);
    assert.strictEqual(injected.size, 0);
  });
})) passed++; else failed++;

if (test('saveInjected persists a Set, and loadInjected reads it back', () => {
  const { saveInjected, loadInjected, getStatePath } = freshRequire(injectDedupPath);
  withSessionKey(`roundtrip-${Date.now()}`, () => {
    saveInjected(new Set(['domain_a', 'domain_b']));
    const reloaded = loadInjected();
    assert.deepStrictEqual([...reloaded].sort(), ['domain_a', 'domain_b']);
    fs.unlinkSync(getStatePath());
  });
})) passed++; else failed++;

if (test('clearInjected removes the state file so loadInjected is empty afterward', () => {
  const { saveInjected, loadInjected, clearInjected, getStatePath } = freshRequire(injectDedupPath);
  withSessionKey(`clear-${Date.now()}`, () => {
    saveInjected(new Set(['domain_a']));
    assert.ok(fs.existsSync(getStatePath()));

    clearInjected();

    assert.ok(!fs.existsSync(getStatePath()));
    assert.strictEqual(loadInjected().size, 0);
  });
})) passed++; else failed++;

if (test('clearInjected is a no-op (never throws) when no state file exists', () => {
  const { clearInjected, getStatePath } = freshRequire(injectDedupPath);
  withSessionKey(`clear-missing-${Date.now()}`, () => {
    try { fs.unlinkSync(getStatePath()); } catch { /* already absent */ }
    assert.doesNotThrow(() => clearInjected());
  });
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
