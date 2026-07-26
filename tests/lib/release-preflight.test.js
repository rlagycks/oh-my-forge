'use strict';

const assert = require('assert');

const { findWorktreeChanges } = require('../../scripts/lib/release-preflight');

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

let passed = 0;
let failed = 0;

console.log('\n=== release-preflight ===\n');

if (test('accepts a clean porcelain status', () => {
  assert.deepStrictEqual(findWorktreeChanges(''), []);
  assert.deepStrictEqual(findWorktreeChanges('\n'), []);
})) passed++; else failed++;

if (test('rejects unstaged, staged, and untracked content', () => {
  assert.deepStrictEqual(
    findWorktreeChanges(' M scripts/release.sh\nM  package.json\n?? .agents/skills/local/SKILL.md\n'),
    [' M scripts/release.sh', 'M  package.json', '?? .agents/skills/local/SKILL.md']
  );
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) process.exit(1);
