'use strict';

const assert = require('assert');

const {
  REQUIRED_PACKAGE_ARTIFACT_PATHS,
  findMissingDeclaredArtifactPaths,
  findMissingDeclaredPackagePaths,
  findMissingRequiredArtifactPaths,
  findUntrackedArtifactPaths,
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

if (test('requires every declared file, directory, and glob to contribute to the tarball', () => {
  const artifactPaths = new Set([
    'scripts/ecc.js',
    'contexts/dev.md',
    'scripts/install-apply.js',
  ]);

  assert.deepStrictEqual(
    findMissingDeclaredArtifactPaths(
      ['scripts/ecc.js', 'contexts/', 'scripts/*-apply.js', 'missing/', 'rules/*.md'],
      artifactPaths
    ),
    [
      'missing is listed in package.json files but does not contribute a path to npm pack',
      'rules/*.md is listed in package.json files but does not contribute a path to npm pack',
    ]
  );
})) passed++; else failed++;

if (test('requires runtime, ontology, and install manifest paths in the artifact', () => {
  const artifactPaths = new Set(REQUIRED_PACKAGE_ARTIFACT_PATHS.slice(1));
  const missing = findMissingRequiredArtifactPaths(artifactPaths);
  assert.deepStrictEqual(missing, [REQUIRED_PACKAGE_ARTIFACT_PATHS[0]]);
})) passed++; else failed++;

if (test('requires the foreground ontology maintainer CLI and its execution boundary', () => {
  const required = [
    'scripts/ontology-maintain.js',
    'scripts/lib/ontology-maintainer-runtime.js',
    'scripts/lib/ontology-maintainer-process.js',
    'scripts/lib/ontology-maintainer-providers/claude-code.js',
    'scripts/lib/ontology-maintainer-providers/codex-cli.js',
    'scripts/lib/ontology-maintainer-providers/index.js',
  ];
  assert.deepStrictEqual(findMissingRequiredArtifactPaths(new Set()), REQUIRED_PACKAGE_ARTIFACT_PATHS);
  assert.deepStrictEqual(findMissingRequiredArtifactPaths(new Set(REQUIRED_PACKAGE_ARTIFACT_PATHS)), []);
  assert.ok(required.every(relativePath => REQUIRED_PACKAGE_ARTIFACT_PATHS.includes(relativePath)));
})) passed++; else failed++;

if (test('rejects untracked artifacts from every shipped directory', () => {
  const unexpected = findUntrackedArtifactPaths(
    new Set([
      '.agents/skills/tdd-workflow/SKILL.md',
      '.agents/skills/tdd-workflow/local-notes.md',
      '.codex/local-settings.toml',
      'scripts/lib/ignored-secret.js',
      'scripts/ecc.js',
    ]),
    new Set(['.agents/skills/tdd-workflow/SKILL.md', 'scripts/ecc.js'])
  );
  assert.deepStrictEqual(unexpected, [
    '.agents/skills/tdd-workflow/local-notes.md',
    '.codex/local-settings.toml',
    'scripts/lib/ignored-secret.js',
  ]);
})) passed++; else failed++;

if (test('does not flag tracked artifact files', () => {
  const unexpected = findUntrackedArtifactPaths(
    new Set(['.agents/plugins/marketplace.json', '.codex/config.toml']),
    new Set(['.agents/plugins/marketplace.json', '.codex/config.toml'])
  );
  assert.deepStrictEqual(unexpected, []);
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) process.exit(1);
