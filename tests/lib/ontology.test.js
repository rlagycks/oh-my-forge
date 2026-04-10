'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

let tmpRoot;
let origCwd;

function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-test-'));
  const ontologyDir = path.join(tmpRoot, '.claude', 'ontology');
  fs.mkdirSync(ontologyDir, { recursive: true });

  const index = {
    $schema: './_schema.json',
    domain_common: {
      summary: 'Common files',
      files: ['README.md', 'scripts/lib/ontology.js'],
      spec: 'docs/features/common.md',
      codexWorkerHint: 'read-only'
    },
    domain_agents: {
      summary: 'Agent files',
      files: ['agents/'],
      spec: 'docs/features/agents.md',
      codexWorkerHint: 'workspace-write'
    }
  };
  fs.writeFileSync(path.join(ontologyDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  origCwd = process.cwd;
  process.cwd = () => tmpRoot;

  delete require.cache[require.resolve('../../scripts/lib/ontology')];
}

function teardown() {
  process.cwd = origCwd;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete require.cache[require.resolve('../../scripts/lib/ontology')];
}

function cli(args) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'lib', 'ontology.js');
  return spawnSync(process.execPath, [script, ...args], {
    cwd: tmpRoot,
    encoding: 'utf8'
  });
}

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

let passed = 0;
let failed = 0;
function run(name, fn) {
  setup();
  try {
    if (test(name, fn)) passed++; else failed++;
  } finally {
    teardown();
  }
}

console.log('\n=== Testing ontology CLI ===\n');

run('keys command returns domain_ key list', () => {
  const result = cli(['keys']);
  assert.strictEqual(result.status, 0);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.includes('domain_common'));
  assert.ok(lines.includes('domain_agents'));
});

run('query --domain returns JSON with files array', () => {
  const result = cli(['query', '--domain', 'domain_common']);
  assert.strictEqual(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data.files));
  assert.ok(data.files.includes('scripts/lib/ontology.js'));
});

run('query --domain --fields returns only requested fields', () => {
  const result = cli(['query', '--domain', 'domain_common', '--fields', 'files']);
  assert.strictEqual(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.deepStrictEqual(Object.keys(data), ['files']);
  assert.ok(Array.isArray(data.files));
});

run('query missing domain exits with error', () => {
  const result = cli(['query', '--domain', 'domain_missing']);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('domain not found'));
});

run('summary command contains all domain keys', () => {
  const result = cli(['summary']);
  assert.strictEqual(result.status, 0);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.some(l => l.startsWith('domain_common')));
  assert.ok(lines.some(l => l.startsWith('domain_agents')));
});

run('query --file returns matching domain entry', () => {
  const result = cli(['query', '--file', 'scripts/lib/ontology.js']);
  assert.strictEqual(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data.files));
  assert.ok(data.files.includes('scripts/lib/ontology.js'));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
