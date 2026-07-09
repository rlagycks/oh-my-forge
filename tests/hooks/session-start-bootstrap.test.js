'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolvePluginRoot,
  writeRootPointer,
  ROOT_POINTER_FILENAME,
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

if (test('writes the resolved root to ~/.claude/.omf-root when the runner exists', () => {
  const pointerHome = path.join(fixtureRoot, 'pointer-home-happy');
  mkdirp(pointerHome);
  const pluginRoot = path.join(fixtureRoot, 'pointer-plugin-root');
  touchRunner(pluginRoot);

  const wrote = writeRootPointer(pluginRoot, { homeDir: pointerHome });
  assert.strictEqual(wrote, true);

  const pointerPath = path.join(pointerHome, '.claude', ROOT_POINTER_FILENAME);
  const contents = fs.readFileSync(pointerPath, 'utf8').trim();
  assert.strictEqual(contents, path.resolve(pluginRoot));
})) passed++; else failed++;

if (test('does not write the pointer file when the root has no runner', () => {
  const pointerHome = path.join(fixtureRoot, 'pointer-home-no-runner');
  mkdirp(pointerHome);
  const invalidRoot = path.join(fixtureRoot, 'pointer-invalid-root');
  mkdirp(invalidRoot);

  const wrote = writeRootPointer(invalidRoot, { homeDir: pointerHome });
  assert.strictEqual(wrote, false);

  const pointerPath = path.join(pointerHome, '.claude', ROOT_POINTER_FILENAME);
  assert.strictEqual(fs.existsSync(pointerPath), false);
})) passed++; else failed++;

if (test('never throws when the pointer directory cannot be created', () => {
  const pointerHome = path.join(fixtureRoot, 'pointer-home-unwritable');
  mkdirp(pointerHome);
  // Create a plain file where the `.claude` directory needs to go, so
  // mkdirSync(targetDir, { recursive: true }) fails with ENOTDIR.
  fs.writeFileSync(path.join(pointerHome, '.claude'), 'not a directory', 'utf8');

  const pluginRoot = path.join(fixtureRoot, 'pointer-plugin-root-2');
  touchRunner(pluginRoot);

  let wrote;
  assert.doesNotThrow(() => {
    wrote = writeRootPointer(pluginRoot, { homeDir: pointerHome });
  });
  assert.strictEqual(wrote, false);
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
