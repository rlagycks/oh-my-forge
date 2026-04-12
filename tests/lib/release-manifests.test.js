'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readReleaseManifestVersions,
  findReleaseManifestVersionMismatches,
} = require('../../scripts/lib/release-manifests');

const repoRoot = path.join(__dirname, '..', '..');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createFixture(versions) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-manifests-'));

  writeJson(path.join(rootDir, 'package.json'), {
    name: 'fixture',
    version: versions.packageVersion,
  });

  writeJson(path.join(rootDir, '.codex-plugin', 'plugin.json'), {
    name: 'fixture',
    version: versions.codexPluginVersion,
  });

  writeJson(path.join(rootDir, '.claude-plugin', 'marketplace.json'), {
    name: 'fixture',
    metadata: {
      version: versions.marketplaceMetadataVersion,
    },
    plugins: [
      {
        name: 'fixture',
        version: versions.marketplacePluginVersion,
      },
    ],
  });

  return rootDir;
}

function cleanup(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

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

console.log('\n=== release-manifests ===\n');

if (test('reports no mismatches when all shipped versions match', () => {
  const rootDir = createFixture({
    packageVersion: '1.10.2',
    codexPluginVersion: '1.10.2',
    marketplaceMetadataVersion: '1.10.2',
    marketplacePluginVersion: '1.10.2',
  });

  try {
    const snapshot = readReleaseManifestVersions(rootDir);
    assert.deepStrictEqual(findReleaseManifestVersionMismatches(snapshot), []);
  } finally {
    cleanup(rootDir);
  }
})) passed++; else failed++;

if (test('flags each manifest that diverges from package.json', () => {
  const rootDir = createFixture({
    packageVersion: '1.10.2',
    codexPluginVersion: '1.9.0',
    marketplaceMetadataVersion: '1.9.1',
    marketplacePluginVersion: '1.9.1',
  });

  try {
    const snapshot = readReleaseManifestVersions(rootDir);
    const mismatches = findReleaseManifestVersionMismatches(snapshot);
    assert.strictEqual(mismatches.length, 3);
    assert.ok(mismatches.some(line => line.includes('.codex-plugin/plugin.json version 1.9.0')));
    assert.ok(mismatches.some(line => line.includes('metadata.version 1.9.1')));
    assert.ok(mismatches.some(line => line.includes('plugins[0] (fixture) version 1.9.1')));
  } finally {
    cleanup(rootDir);
  }
})) passed++; else failed++;

if (test('current repository release manifests are in sync', () => {
  const snapshot = readReleaseManifestVersions(repoRoot);
  const mismatches = findReleaseManifestVersionMismatches(snapshot);
  assert.deepStrictEqual(mismatches, []);
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
