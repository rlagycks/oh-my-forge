'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildDecisionsCommand,
} = require('../../scripts/hooks/bug-fix-enforcer');

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

function touch(filePath) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, '// fixture\n', 'utf8');
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

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-fix-enforcer-'));
const fakeHome = path.join(fixtureRoot, 'home');
mkdirp(fakeHome);

let passed = 0;
let failed = 0;

console.log('\n=== bug-fix-enforcer ===\n');

if (test('uses CODEX_PLUGIN_ROOT when building the /decide helper command', () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: '/tmp/omf-codex' }, () => {
    const command = buildDecisionsCommand({ homeDir: fakeHome });
    assert.strictEqual(command, 'node "/tmp/omf-codex/scripts/lib/decisions.js"');
  });
})) passed++; else failed++;

if (test('falls back to resolved ~/.codex install instead of local repo-relative scripts path', () => {
  const codexRoot = path.join(fakeHome, '.codex');
  touch(path.join(codexRoot, 'scripts', 'lib', 'utils.js'));
  withEnv({ CLAUDE_PLUGIN_ROOT: null, CODEX_PLUGIN_ROOT: null }, () => {
    const command = buildDecisionsCommand({ homeDir: fakeHome });
    assert.strictEqual(command, `node "${path.join(codexRoot, 'scripts', 'lib', 'decisions.js')}"`);
  });
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
