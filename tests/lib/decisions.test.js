'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Patch CWD and homedir to point at a temp directory so tests are isolated
let tmpRoot;
let origCwd;
let origHomedir;

function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-test-'));
  // Create a minimal ontology dir with one domain file
  const ontologyDir = path.join(tmpRoot, '.claude', 'ontology');
  fs.mkdirSync(ontologyDir, { recursive: true });
  fs.writeFileSync(
    path.join(ontologyDir, 'domain_commands.json'),
    JSON.stringify({ domain: 'domain_commands', version: '1.0', summary: 'test' }),
    'utf8'
  );

  origCwd = process.cwd;
  origHomedir = os.homedir;
  process.cwd = () => tmpRoot;
  os.homedir = () => tmpRoot;

  // Re-require decisions.js with patched cwd/homedir
  delete require.cache[require.resolve('../../scripts/lib/decisions')];
}

function teardown() {
  process.cwd = origCwd;
  os.homedir = origHomedir;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete require.cache[require.resolve('../../scripts/lib/decisions')];
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
    if (test(name, fn)) passed++;
    else failed++;
  } finally {
    teardown();
  }
}

console.log('\n=== Testing decisions ===\n');

run('addDecision: writes entry to domain file and global log', () => {
  const { addDecision } = require('../../scripts/lib/decisions');
  const entry = addDecision({
    domain: 'domain_commands',
    type: 'bug-fix',
    summary: 'fixed path bug',
    why: 'scripts/ not installed by plugin'
  });

  assert.ok(entry.id, 'entry should have id');
  assert.strictEqual(entry.type, 'bug-fix');
  assert.strictEqual(entry.summary, 'fixed path bug');

  // Check domain file updated
  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  assert.ok(Array.isArray(domainData.decisions));
  assert.strictEqual(domainData.decisions.length, 1);
  assert.strictEqual(domainData.decisions[0].id, entry.id);

  // Check global log
  const logFile = path.join(tmpRoot, '.claude', 'decisions', 'index.jsonl');
  assert.ok(fs.existsSync(logFile));
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.strictEqual(logged.id, entry.id);
});

run('addDecision: throws on missing required fields', () => {
  const { addDecision } = require('../../scripts/lib/decisions');
  assert.throws(() => addDecision({ type: 'bug-fix', summary: 'x', why: 'y' }), /domain is required/);
  assert.throws(() => addDecision({ domain: 'domain_commands', type: 'unknown', summary: 'x', why: 'y' }), /type must be/);
  assert.throws(() => addDecision({ domain: 'domain_commands', type: 'bug-fix', why: 'y' }), /summary is required/);
  assert.throws(() => addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'x' }), /why is required/);
});

run('queryDecisions: filters by domain', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'cmd bug', why: 'reason a' });
  addDecision({ domain: 'domain_commands', type: 'design', summary: 'cmd design', why: 'reason b' });

  const results = queryDecisions({ domain: 'domain_commands' });
  assert.strictEqual(results.length, 2);
  assert.ok(results.every(e => e.domain === 'domain_commands'));
});

run('queryDecisions: filters by type', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'bug', why: 'root' });
  addDecision({ domain: 'domain_commands', type: 'design', summary: 'design', why: 'intent' });

  const results = queryDecisions({ type: 'bug-fix' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].type, 'bug-fix');
});

run('queryDecisions: filters by file', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'a', why: 'b', files: ['commands/plan.md'] });
  addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'c', why: 'd', files: ['scripts/lib/utils.js'] });

  const results = queryDecisions({ file: 'plan.md' });
  assert.strictEqual(results.length, 1);
  assert.ok(results[0].files.includes('commands/plan.md'));
});

run('queryDecisions: free-text search in summary and why', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  addDecision({ domain: 'domain_commands', type: 'bug-fix', summary: 'silent failure fix', why: 'plugin missing scripts/' });
  addDecision({ domain: 'domain_commands', type: 'design', summary: 'unrelated', why: 'something else' });

  const results = queryDecisions({ q: 'silent' });
  assert.strictEqual(results.length, 1);
  assert.ok(results[0].summary.includes('silent'));
});

run('listDomains: returns domains with decisions', () => {
  const { addDecision, listDomains } = require('../../scripts/lib/decisions');
  addDecision({ domain: 'domain_commands', type: 'design', summary: 'x', why: 'y' });

  const domains = listDomains();
  assert.ok(domains.includes('domain_commands'));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
