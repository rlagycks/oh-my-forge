'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readReleaseManifestVersions,
  findReleaseManifestVersionMismatches,
  findMissingPackagedPaths,
} = require('../../scripts/lib/release-manifests');

const repoRoot = path.join(__dirname, '..', '..');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function createFixture(versions) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-manifests-'));

  writeJson(path.join(rootDir, 'package.json'), {
    name: 'fixture',
    version: versions.packageVersion,
    files: versions.packageFiles || [],
  });

  writeJson(path.join(rootDir, 'package-lock.json'), {
    name: 'fixture',
    version: versions.packageLockVersion || versions.packageVersion,
    packages: {
      '': {
        name: 'fixture',
        version: versions.packageLockPackageVersion || versions.packageVersion,
      },
    },
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

  writeText(
    path.join(rootDir, 'agent.yaml'),
    `spec_version: "0.1.0"\nname: fixture\nversion: ${versions.agentYamlVersion || versions.packageVersion}\n`
  );
  writeText(
    path.join(rootDir, 'AGENTS.md'),
    `# Fixture\n\n**Version:** ${versions.agentsDocVersion || versions.packageVersion}\n`
  );

  for (const packagedPath of versions.presentPackageFiles || []) {
    const filePath = path.join(rootDir, packagedPath);
    if (packagedPath.endsWith('/')) {
      fs.mkdirSync(filePath, { recursive: true });
      continue;
    }

    writeText(filePath, 'fixture\n');
  }

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
    packageFiles: [
      '.claude-plugin/README.md',
      '.codex-plugin/README.md',
    ],
    presentPackageFiles: [
      '.claude-plugin/README.md',
      '.codex-plugin/README.md',
    ],
  });

  try {
    const snapshot = readReleaseManifestVersions(rootDir);
    assert.deepStrictEqual(findReleaseManifestVersionMismatches(snapshot), []);
    assert.deepStrictEqual(findMissingPackagedPaths(snapshot), []);
  } finally {
    cleanup(rootDir);
  }
})) passed++; else failed++;

if (test('flags each manifest that diverges from package.json', () => {
  const rootDir = createFixture({
    packageVersion: '1.10.2',
    packageLockVersion: '1.9.0',
    packageLockPackageVersion: '1.9.1',
    codexPluginVersion: '1.9.0',
    marketplaceMetadataVersion: '1.9.1',
    marketplacePluginVersion: '1.9.1',
    agentYamlVersion: '1.8.9',
    agentsDocVersion: '1.8.8',
  });

  try {
    const snapshot = readReleaseManifestVersions(rootDir);
    const mismatches = findReleaseManifestVersionMismatches(snapshot);
    assert.strictEqual(mismatches.length, 7);
    assert.ok(mismatches.some(line => line.includes('package-lock.json version 1.9.0')));
    assert.ok(mismatches.some(line => line.includes('package-lock.json packages[""] version 1.9.1')));
    assert.ok(mismatches.some(line => line.includes('agent.yaml version 1.8.9')));
    assert.ok(mismatches.some(line => line.includes('AGENTS.md version 1.8.8')));
    assert.ok(mismatches.some(line => line.includes('.codex-plugin/plugin.json version 1.9.0')));
    assert.ok(mismatches.some(line => line.includes('metadata.version 1.9.1')));
    assert.ok(mismatches.some(line => line.includes('plugins[0] (fixture) version 1.9.1')));
  } finally {
    cleanup(rootDir);
  }
})) passed++; else failed++;

if (test('flags missing packaged files declared in package.json', () => {
  const rootDir = createFixture({
    packageVersion: '1.10.2',
    codexPluginVersion: '1.10.2',
    marketplaceMetadataVersion: '1.10.2',
    marketplacePluginVersion: '1.10.2',
    packageFiles: [
      '.claude-plugin/README.md',
      '.codex-plugin/README.md',
    ],
    presentPackageFiles: [
      '.codex-plugin/README.md',
    ],
  });

  try {
    const snapshot = readReleaseManifestVersions(rootDir);
    const missing = findMissingPackagedPaths(snapshot);
    assert.deepStrictEqual(missing, [
      '.claude-plugin/README.md is listed in package.json files but does not exist',
    ]);
  } finally {
    cleanup(rootDir);
  }
})) passed++; else failed++;

if (test('current repository release manifests and packaged files are in sync', () => {
  const snapshot = readReleaseManifestVersions(repoRoot);
  const mismatches = [
    ...findReleaseManifestVersionMismatches(snapshot),
    ...findMissingPackagedPaths(snapshot),
  ];
  assert.deepStrictEqual(mismatches, []);
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
