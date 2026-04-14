'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
} = require('../../scripts/lib/ontology-routing');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-routing-'));
  const projectRoot = path.join(root, 'project');
  const pluginRoot = path.join(root, 'plugin-cache');
  const outsideRoot = path.join(root, 'outside');

  mkdirp(path.join(projectRoot, 'src'));
  mkdirp(path.join(projectRoot, 'services', 'inventory'));
  mkdirp(path.join(pluginRoot, '.claude', 'ontology'));
  mkdirp(outsideRoot);

  fs.writeFileSync(path.join(projectRoot, 'src', 'tracked.js'), 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'src', 'nested.js'), 'module.exports = 2;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'services', 'inventory', 'service.js'), 'module.exports = 3;\n', 'utf8');
  fs.writeFileSync(path.join(outsideRoot, 'other.js'), 'module.exports = 4;\n', 'utf8');
  writeJson(path.join(projectRoot, '.claude', 'ontology', 'domain_exact.json'), {
    domain: 'domain_exact',
    version: '1.0',
    executionContract: {
      mission: 'Handle exact file changes',
      success: ['Patch tracked.js safely'],
      notDo: ['Do not rewrite unrelated files'],
    },
    completionContract: {
      requiredEvidence: ['test proof'],
      falseNormalChecks: ['avoid summary-only completion'],
    },
    failurePatterns: [
      {
        id: 'exact-guard',
        symptom: 'guard bypass',
        looksNormalIf: 'diff is small',
        actuallyMeans: 'tracked path was not validated',
        verifyWith: ['inspect matched domain'],
        nextSuspicion: 'broken routing root',
      },
    ],
    retrievalProfiles: {
      implement: {
        include: ['summary', 'executionContract.success', 'failurePatterns'],
        maxFailurePatterns: 1,
      },
    },
  });

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_exact: {
      files: ['src/tracked.js'],
      summary: 'exact',
      owner: 'test',
      constraints: [],
      detail: '.claude/ontology/domain_exact.json',
    },
    domain_src: {
      files: ['src/'],
      summary: 'prefix',
      owner: 'test',
      constraints: [],
    },
    domain_inventory: {
      files: [],
      summary: 'slug',
      owner: 'test',
      constraints: [],
    },
  });

  writeJson(path.join(pluginRoot, '.claude', 'ontology', 'index.json'), {
    domain_plugin: {
      files: ['plugin-only.js'],
      summary: 'plugin',
      owner: 'plugin',
      constraints: [],
    },
  });

  return { root, projectRoot, pluginRoot, outsideRoot };
}

let passed = 0;
let failed = 0;

console.log('\nontology-routing.test.js');

if (test('resolveProjectOntologyRoot prefers the file path ancestry over plugin env root', () => {
  const fixture = makeFixture();
  process.env.CLAUDE_PLUGIN_ROOT = fixture.pluginRoot;
  try {
    const filePath = path.join(fixture.projectRoot, 'src', 'tracked.js');
    const result = resolveProjectOntologyRoot({ filePath, cwd: fixture.projectRoot });
    assert.strictEqual(result, fixture.projectRoot);
  } finally {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('resolveProjectOntologyRoot falls back to cwd ancestry when file ancestry has no ontology', () => {
  const fixture = makeFixture();
  try {
    const filePath = path.join(fixture.outsideRoot, 'other.js');
    const result = resolveProjectOntologyRoot({ filePath, cwd: path.join(fixture.projectRoot, 'src') });
    assert.strictEqual(result, fixture.projectRoot);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('matchFileToDomain supports exact file, directory prefix, and slug matching', () => {
  const fixture = makeFixture();
  try {
    const ontologyRoot = fixture.projectRoot;
    const maps = loadOntologyMaps(ontologyRoot);

    const exactMatch = matchFileToDomain({
      filePath: path.join(fixture.projectRoot, 'src', 'tracked.js'),
      ontologyRoot,
      fileMap: maps.fileMap,
    });
    assert.strictEqual(exactMatch.domainKey, 'domain_exact');

    const prefixMatch = matchFileToDomain({
      filePath: path.join(fixture.projectRoot, 'src', 'nested.js'),
      ontologyRoot,
      fileMap: maps.fileMap,
    });
    assert.strictEqual(prefixMatch.domainKey, 'domain_src');

    const slugMatch = matchFileToDomain({
      filePath: path.join(fixture.projectRoot, 'services', 'inventory', 'service.js'),
      ontologyRoot,
      fileMap: maps.fileMap,
    });
    assert.strictEqual(slugMatch.domainKey, 'domain_inventory');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('loadOntologyMaps merges detail metadata into flat index entries', () => {
  const fixture = makeFixture();
  try {
    const maps = loadOntologyMaps(fixture.projectRoot);
    const exact = maps.domainMap.domain_exact;

    assert.ok(exact.executionContract, JSON.stringify(exact, null, 2));
    assert.deepStrictEqual(exact.executionContract.success, ['Patch tracked.js safely']);
    assert.ok(Array.isArray(exact.failurePatterns));
    assert.strictEqual(exact.failurePatterns[0].id, 'exact-guard');
    assert.ok(exact.retrievalProfiles.implement);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
