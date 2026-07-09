'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findDuplicateHookRegistrations,
  isPluginInstalled,
  extractHookScriptNames,
} = require('../../scripts/lib/hook-duplicate-check');

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

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

let passed = 0;
let failed = 0;

console.log('\nhook-duplicate-check.test.js');

if (test('extractHookScriptNames ignores runner/wrapper scripts', () => {
  const names = extractHookScriptNames(
    'node ~/.claude/scripts/hook.js run-with-flags.js "scripts/hooks/session-start-bootstrap.js"'
  );
  assert.ok(names.has('session-start-bootstrap.js'));
  assert.ok(!names.has('hook.js'));
  assert.ok(!names.has('run-with-flags.js'));
})) passed++; else failed++;

if (test('isPluginInstalled detects cache-managed install', () => {
  const homeDir = makeTempDir('hook-dup-check-cache-');
  try {
    fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'cache', 'oh-my-forge'), { recursive: true });
    assert.strictEqual(isPluginInstalled(homeDir), true);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('isPluginInstalled returns false when plugin is not present', () => {
  const homeDir = makeTempDir('hook-dup-check-none-');
  try {
    fs.mkdirSync(path.join(homeDir, '.claude', 'plugins'), { recursive: true });
    assert.strictEqual(isPluginInstalled(homeDir), false);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('findDuplicateHookRegistrations returns null when plugin is not installed', () => {
  const homeDir = makeTempDir('hook-dup-check-noplugin-');
  const repoRoot = makeTempDir('hook-dup-check-repo-');
  try {
    const result = findDuplicateHookRegistrations({ repoRoot, homeDir });
    assert.strictEqual(result, null);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('findDuplicateHookRegistrations flags scripts referenced in both hooks.json and settings.json', () => {
  const homeDir = makeTempDir('hook-dup-check-dup-');
  const repoRoot = makeTempDir('hook-dup-check-repo-');
  try {
    fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'cache', 'oh-my-forge'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'hooks'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{
            matcher: '*',
            hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/session-start-bootstrap.js"' }],
          }],
        },
      })
    );

    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{
            matcher: '*',
            hooks: [{ type: 'command', command: 'node ~/.claude/scripts/hook.js session-start-bootstrap.js' }],
          }],
        },
      })
    );

    const result = findDuplicateHookRegistrations({ repoRoot, homeDir });
    assert.ok(result, 'expected a result when plugin is installed and both files exist');
    assert.deepStrictEqual(result.duplicateScripts, ['session-start-bootstrap.js']);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('findDuplicateHookRegistrations reports no duplicates when settings.json has no overlap', () => {
  const homeDir = makeTempDir('hook-dup-check-clean-');
  const repoRoot = makeTempDir('hook-dup-check-repo-');
  try {
    fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'cache', 'oh-my-forge'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'hooks'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{
            matcher: '*',
            hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/session-start-bootstrap.js"' }],
          }],
        },
      })
    );

    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [] } })
    );

    const result = findDuplicateHookRegistrations({ repoRoot, homeDir });
    assert.ok(result);
    assert.deepStrictEqual(result.duplicateScripts, []);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
