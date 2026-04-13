'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectAutoCandidates,
  resolveCodexCompanionPath,
} = require('../../scripts/lib/resolve-codex-companion');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content = '// companion\n') {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`  FAIL ${name}: ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\nresolve-codex-companion.test.js');

if (test('resolveCodexCompanionPath prefers explicit path over env and auto candidates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    const explicitPath = path.join(root, 'explicit', 'codex-companion.mjs');
    const envPath = path.join(root, 'env', 'codex-companion.mjs');
    const eccRoot = path.join(root, 'ecc-root');
    writeFile(explicitPath);
    writeFile(envPath);
    writeFile(path.join(eccRoot, 'scripts', 'codex-companion.mjs'));

    const resolved = resolveCodexCompanionPath({
      explicitPath,
      envPath,
      envRoot: eccRoot,
      homeDir: root,
    });

    assert.strictEqual(resolved.source, 'flag');
    assert.strictEqual(resolved.path, path.resolve(explicitPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('resolveCodexCompanionPath falls back to CODEX_COMPANION_PATH before auto discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    const envPath = path.join(root, 'env', 'codex-companion.mjs');
    const eccRoot = path.join(root, 'ecc-root');
    writeFile(envPath);
    writeFile(path.join(eccRoot, 'scripts', 'codex-companion.mjs'));

    const resolved = resolveCodexCompanionPath({
      envPath,
      envRoot: eccRoot,
      homeDir: root,
    });

    assert.strictEqual(resolved.source, 'env');
    assert.strictEqual(resolved.path, path.resolve(envPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('collectAutoCandidates includes ECC root and codex-plugin-cc locations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    const eccRoot = path.join(root, 'ecc-root');
    const candidates = collectAutoCandidates({
      envRoot: eccRoot,
      homeDir: root,
    });

    assert.ok(candidates.includes(path.join(eccRoot, 'scripts', 'codex-companion.mjs')));
    assert.ok(candidates.includes(path.join(root, '.claude', 'plugins', 'codex-plugin-cc', 'scripts', 'codex-companion.mjs')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('resolveCodexCompanionPath auto-discovers a companion under the ECC root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    const eccRoot = path.join(root, 'ecc-root');
    const candidate = path.join(eccRoot, 'scripts', 'codex-companion.mjs');
    writeFile(candidate);

    const resolved = resolveCodexCompanionPath({
      envRoot: eccRoot,
      homeDir: root,
    });

    assert.strictEqual(resolved.source, 'auto');
    assert.strictEqual(resolved.path, path.resolve(candidate));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('resolveCodexCompanionPath auto-discovers a companion from plugin cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    const cached = path.join(root, '.claude', 'plugins', 'cache', 'codex-plugin-cc', 'openai', '1.2.3', 'scripts', 'codex-companion.mjs');
    writeFile(cached);

    const resolved = resolveCodexCompanionPath({
      homeDir: root,
      envRoot: path.join(root, 'missing-ecc-root'),
    });

    assert.strictEqual(resolved.source, 'auto');
    assert.strictEqual(resolved.path, path.resolve(cached));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('resolveCodexCompanionPath throws a useful error when no candidate exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-codex-companion-'));
  try {
    let caught = null;
    try {
      resolveCodexCompanionPath({
        homeDir: root,
        envRoot: path.join(root, 'missing-ecc-root'),
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, 'Expected resolver to throw');
    assert.ok(caught.message.includes('Unable to resolve Codex companion path'), caught.message);
    assert.ok(Array.isArray(caught.attemptedPaths), 'Expected attemptedPaths on the error');
    assert.ok(caught.attemptedPaths.length > 0, 'Expected at least one attempted path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
