'use strict';

/**
 * Engine resolution policy: Codex is opt-in.
 *
 * Regression guard for #59 — the previous fallback returned "codex" whenever a
 * `codex` binary happened to be on PATH, so merely having Codex installed
 * silently activated the codex-first lockdown (every ontology-tracked file
 * blocked behind /codex-delegate) for users who never asked for it. Engine
 * selection must come from explicit configuration only.
 *
 * Two independent implementations exist and must agree:
 *   - scripts/lib/implementation-engine.js  detectPinnedImplementationEngine()  (guards)
 *   - scripts/lib/utils.js                  detectImplementationEngine()        (/plan routing)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const enginePath = path.resolve(__dirname, '../../scripts/lib/implementation-engine.js');
const utilsPath = path.resolve(__dirname, '../../scripts/lib/utils.js');

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

/**
 * Run fn() in a throwaway project root with an isolated HOME and cwd, with no
 * pinned-engine state leaking in from other tests (the pin is keyed by
 * CLAUDE_SESSION_ID + a hash of the project root, so a unique session id per
 * case is enough to keep runs independent).
 *
 * @param {object} opts
 * @param {string|null} opts.projectEngine - implementationEngine for <root>/.claude/settings.json
 * @param {string|null} opts.globalEngine  - implementationEngine for <home>/.claude/settings.json
 * @param {string|undefined} opts.envEngine - CLAUDE_IMPL_ENGINE value
 */
function withProject({ projectEngine = null, globalEngine = null, envEngine } = {}, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-engine-'));
  const projectRoot = path.join(tempRoot, 'project');
  const fakeHome = path.join(tempRoot, 'home');
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });

  if (projectEngine) {
    fs.writeFileSync(
      path.join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ implementationEngine: projectEngine }),
      'utf8'
    );
  }
  if (globalEngine) {
    fs.writeFileSync(
      path.join(fakeHome, '.claude', 'settings.json'),
      JSON.stringify({ implementationEngine: globalEngine }),
      'utf8'
    );
  }

  const saved = {
    cwd: process.cwd(),
    home: process.env.HOME,
    userprofile: process.env.USERPROFILE,
    env: process.env.CLAUDE_IMPL_ENGINE,
    session: process.env.CLAUDE_SESSION_ID,
  };

  process.chdir(projectRoot);
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.CLAUDE_SESSION_ID = `impl-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (envEngine === undefined) delete process.env.CLAUDE_IMPL_ENGINE;
  else process.env.CLAUDE_IMPL_ENGINE = envEngine;

  try {
    return fn(projectRoot);
  } finally {
    process.chdir(saved.cwd);
    if (saved.home === undefined) delete process.env.HOME; else process.env.HOME = saved.home;
    if (saved.userprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = saved.userprofile;
    if (saved.env === undefined) delete process.env.CLAUDE_IMPL_ENGINE; else process.env.CLAUDE_IMPL_ENGINE = saved.env;
    if (saved.session === undefined) delete process.env.CLAUDE_SESSION_ID; else process.env.CLAUDE_SESSION_ID = saved.session;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function bothEngines(projectRoot) {
  const { detectPinnedImplementationEngine } = freshRequire(enginePath);
  const { detectImplementationEngine } = freshRequire(utilsPath);
  return {
    pinned: detectPinnedImplementationEngine(projectRoot),
    plan: detectImplementationEngine(),
  };
}

console.log('\nimplementation-engine.test.js');

// --- The core regression: no config means Claude, even with codex on PATH ---

if (test('defaults to claude when no engine is configured (codex is opt-in)', () => {
  withProject({}, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'claude', 'guard-side engine must default to claude');
    assert.strictEqual(plan, 'claude', '/plan-side engine must default to claude');
  });
})) passed++; else failed++;

if (test('presence of a codex binary on PATH does not by itself select codex', () => {
  // Stage a fake `codex` executable and put it first on PATH. Under the old
  // `which codex` fallback this alone flipped the engine to codex.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-bin-'));
  const fakeCodex = path.join(binDir, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nexit 0\n', 'utf8');
  fs.chmodSync(fakeCodex, 0o755);

  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
  try {
    withProject({}, (projectRoot) => {
      const { pinned, plan } = bothEngines(projectRoot);
      assert.strictEqual(pinned, 'claude', 'codex on PATH must not activate the codex-first lockdown');
      assert.strictEqual(plan, 'claude', 'codex on PATH must not auto-route /plan to codex');
    });
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

// --- Explicit opt-in still works, at every configuration layer ---

if (test('project settings implementationEngine: codex selects codex', () => {
  withProject({ projectEngine: 'codex' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'codex');
    assert.strictEqual(plan, 'codex');
  });
})) passed++; else failed++;

if (test('global settings implementationEngine: codex selects codex', () => {
  withProject({ globalEngine: 'codex' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'codex');
    assert.strictEqual(plan, 'codex');
  });
})) passed++; else failed++;

if (test('CLAUDE_IMPL_ENGINE=codex selects codex', () => {
  withProject({ envEngine: 'codex' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'codex');
    assert.strictEqual(plan, 'codex');
  });
})) passed++; else failed++;

if (test('CLAUDE_IMPL_ENGINE=claude overrides a codex project setting', () => {
  withProject({ projectEngine: 'codex', envEngine: 'claude' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'claude');
    assert.strictEqual(plan, 'claude');
  });
})) passed++; else failed++;

if (test('project settings take precedence over global settings', () => {
  withProject({ projectEngine: 'claude', globalEngine: 'codex' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'claude');
    assert.strictEqual(plan, 'claude');
  });
})) passed++; else failed++;

if (test('an explicit claude setting stays claude', () => {
  withProject({ projectEngine: 'claude' }, (projectRoot) => {
    const { pinned, plan } = bothEngines(projectRoot);
    assert.strictEqual(pinned, 'claude');
    assert.strictEqual(plan, 'claude');
  });
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
