'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const hooksPath = path.join(repoRoot, '.codex', 'hooks.json');

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

function loadHookCommands() {
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  return hooks.hooks.PreToolUse.flatMap(group => (
    (group.hooks || []).map(hook => hook.command)
  ));
}

function runHookCommand(command, cwd) {
  const result = spawnSync('/bin/zsh', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repoRoot, 'README.md'),
      },
    }),
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

let passed = 0;
let failed = 0;

console.log('\ncodex-hooks-config.test.js');

if (test('project-local Codex hooks resolve from the git root instead of a relative cwd', () => {
  const commands = loadHookCommands();
  assert.ok(commands.length > 0, 'expected project-local Codex hooks');
  for (const command of commands) {
    assert.ok(
      command.includes('git rev-parse --show-toplevel'),
      `hook command should resolve from git root: ${command}`
    );
    assert.ok(
      !command.includes('node "scripts/hooks/'),
      `hook command should not use cwd-relative script paths: ${command}`
    );
  }
})) passed++; else failed++;

if (test('project-local Codex hooks still execute when Codex starts in a subdirectory', () => {
  const commands = loadHookCommands();
  const subdir = path.join(repoRoot, 'skills');
  for (const command of commands) {
    const result = runHookCommand(command, subdir);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(!/MODULE_NOT_FOUND/.test(result.stderr), result.stderr);
  }
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
