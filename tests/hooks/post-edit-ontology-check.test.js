'use strict';

/**
 * Tests for scripts/hooks/post-edit-ontology-check.js
 *
 * Run with: node tests/hooks/post-edit-ontology-check.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  run,
  resolveProjectRoot,
} = require('../../scripts/hooks/post-edit-ontology-check');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function makeInput(filePath) {
  return JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
  });
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

let passed = 0;
let failed = 0;
function run_(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

console.log('\n=== Testing post-edit-ontology-check ===\n');

run_('passes through raw input on invalid JSON', () => {
  const raw = 'not-json';
  assert.strictEqual(run(raw), raw);
});

run_('passes through when no file_path in tool_input', () => {
  const raw = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
  assert.strictEqual(run(raw), raw);
});

run_('passes through for non-ontology file', () => {
  const raw = makeInput(path.join(REPO_ROOT, 'README.md'));
  assert.strictEqual(run(raw), raw);
});

run_('passes through for docs/features/ file in subdirectory (not a spec file)', () => {
  // Subdirectory files should NOT trigger (only flat docs/features/*.md)
  const raw = makeInput(path.join(REPO_ROOT, 'docs', 'features', 'sub', 'deep.md'));
  assert.strictEqual(run(raw), raw);
});

run_('returns raw input for index.json (validator runs, but input is still passed through)', () => {
  // We can't control validator output in unit tests, but we can verify the hook
  // always returns rawInput regardless of validation result.
  const raw = makeInput(path.join(REPO_ROOT, '.claude', 'ontology', 'index.json'));
  const result = run(raw);
  assert.strictEqual(result, raw, 'hook must always return rawInput');
});

run_('returns raw input for a spec file (docs/features/hooks.md)', () => {
  const raw = makeInput(path.join(REPO_ROOT, 'docs', 'features', 'hooks.md'));
  const result = run(raw);
  assert.strictEqual(result, raw, 'hook must always return rawInput');
});

run_('resolves the project root from the edited file even when plugin-root env vars point elsewhere', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'post-edit-ontology-'));
  const pluginRoot = path.join(fixtureRoot, 'plugin-root');
  const projectRoot = path.join(fixtureRoot, 'project-root');
  const editedFile = path.join(projectRoot, 'docs', 'features', 'hooks.md');

  mkdirp(path.join(pluginRoot, '.claude', 'ontology'));
  mkdirp(path.join(projectRoot, '.claude', 'ontology'));
  mkdirp(path.dirname(editedFile));
  fs.writeFileSync(path.join(pluginRoot, '.claude', 'ontology', 'index.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, '.claude', 'ontology', 'index.json'), '{}\n', 'utf8');
  fs.writeFileSync(editedFile, '# hooks\n', 'utf8');

  withEnv({ CLAUDE_PLUGIN_ROOT: pluginRoot, CODEX_PLUGIN_ROOT: path.join(fixtureRoot, 'codex-root') }, () => {
    const resolved = resolveProjectRoot(editedFile);
    assert.strictEqual(resolved, projectRoot);
  });
});

run_('handles tool_input.path fallback (Write tool format)', () => {
  const raw = JSON.stringify({
    tool_name: 'Write',
    tool_input: { path: path.join(REPO_ROOT, 'README.md'), content: 'x' },
  });
  assert.strictEqual(run(raw), raw);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
