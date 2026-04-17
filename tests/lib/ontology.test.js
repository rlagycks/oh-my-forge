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
  fs.mkdirSync(path.join(tmpRoot, 'docs', 'contracts'), { recursive: true });

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
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'contracts', 'retry-safe-webhooks.md'), [
    '# Design Contract: Retry-safe Webhooks',
    '',
    '## Problem One Line',
    '- Prevent duplicate webhook side effects when retries happen.',
    '',
    '## Mission',
    '- Deliver webhook retries safely without widening scope.',
    '',
    '## Success',
    '- Retry attempts are idempotent.',
    '',
    '## Not Do',
    '- Do not redesign the whole notification pipeline.',
    '',
    '## Inputs / Contracts',
    '- Existing webhook payload shape stays stable.',
    '',
    '## Verification Points',
    '- Unit tests prove repeated deliveries stay idempotent.',
    '',
    '## False-Normal Checks',
    '- A 200 response alone is not proof of safe retries.',
    '',
    '## Expansion Forbidden',
    '- No unrelated queue refactor.',
    '',
    '## Handoff Format',
    '- Current State',
    '- Evidence',
    '- Open Risks',
    '- Next Action',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'contracts', 'incomplete.md'), [
    '# Design Contract: Incomplete',
    '',
    '## Problem One Line',
    '- Fix retries.',
    '',
    '## Mission',
    '- Retry work.',
    '',
    '## Success',
    '- Tests pass.',
  ].join('\n'), 'utf8');

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

run('promote-contract prints an ontology detail fragment from a design contract markdown file', () => {
  const result = cli([
    'promote-contract',
    '--contract-file', 'docs/contracts/retry-safe-webhooks.md',
    '--domain', 'domain_webhooks',
  ]);
  assert.strictEqual(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.domain, 'domain_webhooks');
  assert.strictEqual(data.summary, 'Prevent duplicate webhook side effects when retries happen.');
  assert.ok(data.executionContract.notDo.includes('No unrelated queue refactor.'), JSON.stringify(data, null, 2));
  assert.ok(data.completionContract.handoffTemplate.includes('Evidence'), JSON.stringify(data, null, 2));
});

run('promote-contract can merge into an existing detail file and write it back', () => {
  const detailFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_webhooks.json');
  fs.writeFileSync(detailFile, JSON.stringify({
    domain: 'domain_webhooks',
    version: '1.0',
    summary: 'Old summary',
    constraints: ['Keep auth stable'],
    executionContract: {
      notDo: ['Do not break auth'],
    },
  }, null, 2), 'utf8');

  const result = cli([
    'promote-contract',
    '--contract-file', 'docs/contracts/retry-safe-webhooks.md',
    '--detail-file', '.claude/ontology/domain_webhooks.json',
    '--write',
  ]);
  assert.strictEqual(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  const written = JSON.parse(fs.readFileSync(detailFile, 'utf8'));
  assert.strictEqual(data.domain, 'domain_webhooks');
  assert.strictEqual(written.summary, 'Prevent duplicate webhook side effects when retries happen.');
  assert.ok(written.constraints.includes('Keep auth stable'), JSON.stringify(written, null, 2));
  assert.ok(written.constraints.includes('Existing webhook payload shape stays stable.'), JSON.stringify(written, null, 2));
  assert.ok(written.executionContract.notDo.includes('Do not break auth'), JSON.stringify(written, null, 2));
  assert.ok(written.executionContract.notDo.includes('No unrelated queue refactor.'), JSON.stringify(written, null, 2));
});

run('promote-contract rejects incomplete design contracts before writing detail files', () => {
  const detailFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_incomplete.json');
  const result = cli([
    'promote-contract',
    '--contract-file', 'docs/contracts/incomplete.md',
    '--detail-file', '.claude/ontology/domain_incomplete.json',
    '--write',
  ]);

  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Invalid design contract'), result.stderr);
  assert.ok(result.stderr.includes('Not Do'), result.stderr);
  assert.ok(!fs.existsSync(detailFile), 'incomplete contract should not be written');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
