/**
 * Tests for scripts/lib/codex-guard-policy.js — shared Codex guard predicates.
 *
 * Run with: node tests/lib/codex-guard-policy.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  isCodexGuardBypassed,
  isMetaPath,
  isSelfRepoRoot,
} = require('../../scripts/lib/codex-guard-policy');

function testIsCodexGuardBypassed() {
  assert.strictEqual(isCodexGuardBypassed({ ECC_BYPASS_CODEX_GUARD: '1' }), true,
    'env value "1" should bypass');
  assert.strictEqual(isCodexGuardBypassed({ ECC_BYPASS_CODEX_GUARD: '0' }), false,
    'env value "0" should not bypass');
  assert.strictEqual(isCodexGuardBypassed({ ECC_BYPASS_CODEX_GUARD: 'true' }), false,
    'only the literal "1" bypasses');
  assert.strictEqual(isCodexGuardBypassed({}), false, 'missing env should not bypass');
  console.log('  PASS testIsCodexGuardBypassed');
}

function testIsMetaPath() {
  const metaPaths = [
    '.claude/ontology/index.json',
    'scripts/hooks/pre-bash-codex-guard.js',
    'scripts/lib/codex-guard-policy.js',
    'agents/planner.md',
    'skills/plan.md',
    'commands/plan.md',
    'hooks/hooks.json',
    'tests/hooks/example.test.js',
    'docs/README.md',
    'node_modules/pkg/index.js',
    'README.md', // root-level markdown
    'package.json', // root-level json
    'tests', // bare prefix without trailing slash
  ];
  for (const p of metaPaths) {
    assert.strictEqual(isMetaPath(p), true, `should be meta: ${p}`);
  }

  const nonMetaPaths = [
    'src/tracked.js',
    'lib/util.js',
    'scripts/setup.js', // scripts/ itself is not meta, only hooks/ and lib/
    'app/docs/page.tsx', // prefix must anchor at the repo root
    'index.js', // root-level but not .md/.json
    '',
  ];
  for (const p of nonMetaPaths) {
    assert.strictEqual(isMetaPath(p), false, `should NOT be meta: ${p}`);
  }

  assert.strictEqual(isMetaPath('scripts\\hooks\\x.js'), true,
    'backslash paths should be normalized');
  console.log('  PASS testIsMetaPath');
}

function testIsSelfRepoRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-guard-policy-'));
  const repoDir = path.join(tempRoot, 'repo');
  const subDir = path.join(repoDir, 'sub');
  const nestedSubDir = path.join(subDir, 'nested');
  const siblingDir = path.join(tempRoot, 'repo-foo');
  fs.mkdirSync(nestedSubDir, { recursive: true });
  fs.mkdirSync(siblingDir, { recursive: true });

  const originalCwd = process.cwd();
  try {
    process.chdir(repoDir);
    // process.cwd() returns the realpath while repoDir may be the symlinked
    // form (/var vs /private/var on macOS) — comparison must be symlink-safe.
    assert.strictEqual(isSelfRepoRoot(repoDir), true,
      'ontology root equal to cwd should be self-repo (symlink-safe)');
    assert.strictEqual(isSelfRepoRoot(subDir), false,
      'a different directory should not be self-repo');
    assert.strictEqual(isSelfRepoRoot(null), false, 'null root is never self-repo');
    assert.strictEqual(isSelfRepoRoot(''), false, 'empty root is never self-repo');

    process.chdir(subDir);
    assert.strictEqual(isSelfRepoRoot(repoDir), true,
      'cwd inside a subdirectory of the root IS self-repo (F1: subdirectories count)');

    process.chdir(nestedSubDir);
    assert.strictEqual(isSelfRepoRoot(repoDir), true,
      'cwd nested multiple levels inside the root is still self-repo');

    process.chdir(siblingDir);
    assert.strictEqual(isSelfRepoRoot(repoDir), false,
      'a sibling directory sharing a name prefix (repo-foo vs repo) must NOT be treated as self-repo');

    assert.strictEqual(isSelfRepoRoot(repoDir, repoDir), true,
      'explicit cwd argument should be honored');
    assert.strictEqual(isSelfRepoRoot(repoDir, subDir), true,
      'explicit cwd argument inside the root should be honored');
    assert.strictEqual(isSelfRepoRoot(repoDir, siblingDir), false,
      'explicit sibling cwd argument should not be honored');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('  PASS testIsSelfRepoRoot');
}

const tests = [
  testIsCodexGuardBypassed,
  testIsMetaPath,
  testIsSelfRepoRoot,
];

let passed = 0;
let failed = 0;

console.log('\ncodex-guard-policy.test.js');

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
