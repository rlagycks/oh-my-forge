/**
 * Tests for pre-write-edit-codex-guard.js
 *
 * Run with: node tests/hooks/pre-write-edit-codex-guard.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/pre-write-edit-codex-guard.js');
const { run } = require(hookPath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(toolName, filePath) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath, content: 'test content' },
  });
}

function captureExit(fn) {
  let exitCode = null;
  const origExit = process.exit;
  const origStdout = process.stdout.write.bind(process.stdout);
  let stdout = '';

  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };
  process.stdout.write = (chunk) => { stdout += chunk; return true; };

  try {
    fn();
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) {
      process.exit = origExit;
      process.stdout.write = origStdout;
      throw e;
    }
  }

  process.exit = origExit;
  process.stdout.write = origStdout;
  return { exitCode, stdout };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testBypassEnvSkips() {
  process.env.ECC_BYPASS_CODEX_GUARD = '1';
  const input = makeInput('Edit', '/some/tracked/file.js');
  // Should not throw or exit
  let result;
  try {
    result = run(input);
  } finally {
    delete process.env.ECC_BYPASS_CODEX_GUARD;
  }
  assert.strictEqual(result, input, 'ECC_BYPASS_CODEX_GUARD=1 should pass through');
  console.log('  PASS testBypassEnvSkips');
}

function testInvalidJsonPassThrough() {
  const result = run('not valid json');
  assert.strictEqual(result, 'not valid json', 'Invalid JSON should pass through');
  console.log('  PASS testInvalidJsonPassThrough');
}

function testEmptyFilePathPassThrough() {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: {} });
  const result = run(input);
  assert.strictEqual(result, input, 'Empty file path should pass through');
  console.log('  PASS testEmptyFilePathPassThrough');
}

function testMetaPathsPassThrough() {
  const metaPaths = [
    '/some/project/.claude/ontology/index.json',
    '/some/project/scripts/hooks/constraint-guard.js',
    '/some/project/agents/planner.md',
    '/some/project/skills/plan.md',
    '/some/project/commands/plan.md',
    '/some/project/hooks/hooks.json',
    '/some/project/tests/hooks/example.test.js',
    '/some/project/docs/README.md',
  ];

  // These all pass through because resolvePluginRoot won't find an ontology
  // for arbitrary paths, so they all short-circuit at the pluginRoot check.
  for (const fp of metaPaths) {
    const input = makeInput('Edit', fp);
    const result = run(input);
    assert.strictEqual(result, input, `Meta path should pass through: ${fp}`);
  }
  console.log('  PASS testMetaPathsPassThrough');
}

function testNotTrackedFilePassThrough() {
  // File path that resolvePluginRoot can't resolve (no ontology found)
  const input = makeInput('Write', path.join(os.tmpdir(), 'random-file.js'));
  const result = run(input);
  assert.strictEqual(result, input, 'File with no plugin root should pass through');
  console.log('  PASS testNotTrackedFilePassThrough');
}

function testClaudeEnginePassThrough() {
  // If engine is claude, guard should not block even for tracked files
  process.env.CLAUDE_IMPL_ENGINE = 'claude';
  const input = makeInput('Edit', path.join(os.tmpdir(), 'some-source.js'));
  let result;
  try {
    result = run(input);
  } finally {
    delete process.env.CLAUDE_IMPL_ENGINE;
  }
  // It will pass through because either: no plugin root found, or engine=claude
  assert.strictEqual(result, input, 'ENGINE=claude should pass through');
  console.log('  PASS testClaudeEnginePassThrough');
}

function testSelfRepoMetaPathNotBypassed() {
  // When editing oh-my-forge itself (pluginRoot === cwd), meta paths should NOT be
  // exempt from the guard — otherwise the guard is completely ineffective on the
  // plugin's own ontology-tracked files.
  //
  // We use CLAUDE_PLUGIN_ROOT pointing to the real repo so resolvePluginRoot resolves,
  // and ENGINE=codex so the guard would activate if the file is tracked.
  // skills/plan.md IS in the ontology (domain_skills), so with ENGINE=codex the guard
  // should attempt to block (exit 2), proving the meta-path bypass was skipped.
  const repoRoot = path.resolve(__dirname, '../..');
  process.env.CLAUDE_PLUGIN_ROOT = repoRoot;
  process.env.CLAUDE_IMPL_ENGINE = 'codex';

  const trackedMetaFile = path.join(repoRoot, 'skills', 'plan.md');
  const input = makeInput('Edit', trackedMetaFile);

  let exitCode = null;
  const origExit = process.exit;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };

  try {
    run(input);
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) {
      process.exit = origExit;
      process.stdout.write = origStdoutWrite;
      delete process.env.CLAUDE_PLUGIN_ROOT;
      delete process.env.CLAUDE_IMPL_ENGINE;
      throw e;
    }
  }

  process.exit = origExit;
  process.stdout.write = origStdoutWrite;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.CLAUDE_IMPL_ENGINE;

  assert.strictEqual(exitCode, 2,
    'self-repo meta path (skills/plan.md) should be blocked by guard when ENGINE=codex');
  console.log('  PASS testSelfRepoMetaPathNotBypassed');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testBypassEnvSkips,
  testInvalidJsonPassThrough,
  testEmptyFilePathPassThrough,
  testMetaPathsPassThrough,
  testNotTrackedFilePassThrough,
  testClaudeEnginePassThrough,
  testSelfRepoMetaPathNotBypassed,
];

let passed = 0;
let failed = 0;

console.log('\npre-write-edit-codex-guard.test.js');

for (const test of tests) {
  try {
    test();
    passed++;
  } catch (err) {
    console.error(`  FAIL ${test.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
