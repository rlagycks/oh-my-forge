'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolvePluginRoot,
} = require('../../scripts/hooks/session-start-bootstrap');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function touchRunner(rootDir) {
  const filePath = path.join(rootDir, 'scripts', 'hooks', 'run-with-flags.js');
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, '// runner\n', 'utf8');
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

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-bootstrap-'));
const fakeHome = path.join(fixtureRoot, 'home');
mkdirp(fakeHome);

let passed = 0;
let failed = 0;

console.log('\n=== session-start-bootstrap ===\n');

if (test('prefers CODEX_PLUGIN_ROOT when it points to a valid plugin root', () => {
  const codexRoot = path.join(fixtureRoot, 'codex-root');
  touchRunner(codexRoot);
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: codexRoot }, () => {
    const resolved = resolvePluginRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, path.resolve(codexRoot));
  });
})) passed++; else failed++;

if (test('ignores invalid env roots and falls back to discovered marketplace cache roots', () => {
  const cacheRoot = path.join(
    fakeHome,
    '.codex',
    'plugins',
    'cache',
    'oh-my-forge',
    'rlagycks',
    '1.11.4'
  );
  touchRunner(cacheRoot);
  withEnv({ CLAUDE_PLUGIN_ROOT: '/tmp/not-a-plugin-root', CODEX_PLUGIN_ROOT: null }, () => {
    const resolved = resolvePluginRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, cacheRoot);
  });
})) passed++; else failed++;

if (test('detects ~/.codex marketplace cache roots when env vars are unset', () => {
  const cacheRoot = path.join(
    fakeHome,
    '.codex',
    'plugins',
    'cache',
    'oh-my-forge',
    'rlagycks',
    '1.11.4'
  );
  touchRunner(cacheRoot);
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: null }, () => {
    const resolved = resolvePluginRoot({ homeDir: fakeHome });
    assert.strictEqual(resolved, cacheRoot);
  });
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
