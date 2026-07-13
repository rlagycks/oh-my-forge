'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pluginRoot = path.resolve(__dirname, '..', '..');

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

// Helper to run hook in isolated fresh environment
function runHookFresh(scriptPath, payload, hookLabel) {
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-home-'));
  const freshProject = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-proj-'));

  // Init minimal git repo
  spawnSync('git', ['init', '-q'], { cwd: freshProject });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: freshProject });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: freshProject });

  try {
    const result = spawnSync(
      'node',
      [path.join(pluginRoot, 'scripts/hooks/run-with-flags.js'),
       hookLabel,
       scriptPath,
       '--request-file', path.join(pluginRoot, 'scripts/hooks/requests/standard-strict.json')
      ],
      {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: pluginRoot,
          HOME: freshHome,
          PATH: process.env.PATH
        },
        cwd: freshProject,
        timeout: 5000
      }
    );

    const combined = (result.stdout || '') + (result.stderr || '');

    return {
      exit: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      combined: combined,
      freshHome,
      freshProject
    };
  } finally {
    try { fs.rmSync(freshHome, { recursive: true }); } catch { /* best-effort cleanup */ }
    try { fs.rmSync(freshProject, { recursive: true }); } catch { /* best-effort cleanup */ }
  }
}

let passed = 0;
let failed = 0;

console.log('\n=== Fresh Install Verification ===\n');

// Test 1: pre-compact from empty state
if (test('pre-compact.js runs successfully from empty state', () => {
  const result = runHookFresh('scripts/hooks/pre-compact.js', {}, 'pre:compact');
  assert.strictEqual(result.exit, 0, `pre-compact exit: expected 0, got ${result.exit}`);
  assert(result.combined.includes('[PreCompact]'), 'Missing [PreCompact] log marker');
})) passed++; else failed++;

// Test 2: domain-context-inject handles no ontology
if (test('domain-context-inject.js handles no ontology gracefully', () => {
  const payload = { tool_name: 'Read', tool_input: { file_path: 'test.js' }, cwd: '/tmp' };
  const result = runHookFresh('scripts/hooks/domain-context-inject.js', payload, 'pre:domain-context');
  assert.strictEqual(result.exit, 0, `domain-context exit: expected 0, got ${result.exit}`);
  const lines = result.stdout.split('\n');
  const jsonLine = lines[0];
  JSON.parse(jsonLine); // Should not throw
})) passed++; else failed++;

// Test 3: pre-bash-block-no-verify passes through clean commands
if (test('pre-bash-block-no-verify.js passes through clean commands', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'echo test' },
    cwd: '/tmp'
  };
  const result = runHookFresh('scripts/hooks/pre-bash-block-no-verify.js', payload, 'pre:bash:no-verify');
  assert.strictEqual(result.exit, 0, `block-no-verify exit: expected 0, got ${result.exit}`);
  const lines = result.stdout.split('\n');
  const jsonLine = lines[0];
  JSON.parse(jsonLine); // Should not throw
})) passed++; else failed++;

// Test 4: Hooks complete in under 2 seconds
if (test('Hooks complete in under 2 seconds', () => {
  const hooks = [
    { script: 'scripts/hooks/pre-compact.js', payload: {}, label: 'pre:compact' }
  ];
  hooks.forEach(({ script, payload, label }) => {
    const start = Date.now();
    runHookFresh(script, payload, label);
    const duration = Date.now() - start;
    assert(duration < 2000, `${label} took ${duration}ms (limit: 2000ms)`);
  });
})) passed++; else failed++;

// Test 5: No stack traces in stderr
if (test('No stack traces in stderr output', () => {
  const result = runHookFresh('scripts/hooks/pre-compact.js', {}, 'pre:compact');
  const hasStackTrace = result.stderr.match(/^\s+at\s+/m) || result.stderr.includes('Error:');
  assert(!hasStackTrace, `Unexpected stack trace in stderr: ${result.stderr}`);
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
