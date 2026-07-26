'use strict';

const assert = require('assert');

const {
  REQUIRED_PACKAGE_ARTIFACT_PATHS,
  findMissingDeclaredPackagePaths,
  findMissingRequiredArtifactPaths,
  findUntrackedAgentArtifactPaths,
  normalizePackagePath,
} = require('../../scripts/lib/package-artifact');

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

console.log('\n=== package-artifact ===\n');

if (test('normalizes npm package paths without allowing parent traversal', () => {
  assert.strictEqual(normalizePackagePath('./scripts/ecc.js'), 'scripts/ecc.js');
  assert.strictEqual(normalizePackagePath('scripts\\ecc.js'), 'scripts/ecc.js');
  assert.strictEqual(normalizePackagePath('../.agents/private.txt'), null);
  assert.strictEqual(normalizePackagePath('/.agents/private.txt'), null);
})) passed++; else failed++;

if (test('reports declared package paths that do not exist in the source tree', () => {
  const missing = findMissingDeclaredPackagePaths(
    ['scripts/ecc.js', 'install.sh', '.agents/'],
    new Set(['scripts/ecc.js', '.agents/'])
  );
  assert.deepStrictEqual(missing, ['install.sh is listed in package.json files but does not exist']);
})) passed++; else failed++;

if (test('requires runtime, ontology, and install manifest paths in the artifact', () => {
  const artifactPaths = new Set(REQUIRED_PACKAGE_ARTIFACT_PATHS.slice(1));
  const missing = findMissingRequiredArtifactPaths(artifactPaths);
  assert.deepStrictEqual(missing, [REQUIRED_PACKAGE_ARTIFACT_PATHS[0]]);
})) passed++; else failed++;

if (test('rejects an untracked .agents artifact while allowing tracked agent assets', () => {
  const unexpected = findUntrackedAgentArtifactPaths(
    new Set([
      '.agents/skills/tdd-workflow/SKILL.md',
      '.agents/skills/tdd-workflow/local-notes.md',
      'scripts/ecc.js',
    ]),
    new Set(['.agents/skills/tdd-workflow/SKILL.md'])
  );
  assert.deepStrictEqual(unexpected, ['.agents/skills/tdd-workflow/local-notes.md']);
})) passed++; else failed++;

if (test('does not flag tracked .agents artifact files', () => {
  const unexpected = findUntrackedAgentArtifactPaths(
    new Set(['.agents/plugins/marketplace.json']),
    new Set(['.agents/plugins/marketplace.json'])
  );
  assert.deepStrictEqual(unexpected, []);
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) process.exit(1);
