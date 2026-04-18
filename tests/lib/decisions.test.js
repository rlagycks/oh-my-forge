'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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

run('addDecision: can append durable failure traces without writing domain files', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const before = fs.readFileSync(domainFile, 'utf8');

  const entry = addDecision({
    domain: 'domain_commands',
    type: 'failure-trace',
    summary: 'parser fallback suspicion',
    why: 'SessionEnd captured an unresolved failure trace',
    ref: 'failure-trace:session-a:abc123',
    falseNormalSignals: ['tests passed but evidence missing'],
    verifyWith: ['prove changed-path coverage'],
    nextSuspicion: 'parseCodexResult fallback path',
    writeDomain: false,
  });

  assert.strictEqual(entry.type, 'failure-trace');
  assert.strictEqual(fs.readFileSync(domainFile, 'utf8'), before, 'domain file should remain unchanged');

  const results = queryDecisions({ type: 'failure-trace' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].ref, 'failure-trace:session-a:abc123');
});

run('addDecision: dedupes durable promotions by ref when requested', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  const first = addDecision({
    domain: 'domain_commands',
    type: 'failure-trace',
    summary: 'same failure trace',
    why: 'same root',
    ref: 'failure-trace:session-a:dedupe',
    writeDomain: false,
    dedupeRef: true,
  });
  const second = addDecision({
    domain: 'domain_commands',
    type: 'failure-trace',
    summary: 'same failure trace',
    why: 'same root',
    ref: 'failure-trace:session-a:dedupe',
    writeDomain: false,
    dedupeRef: true,
  });

  assert.strictEqual(second.id, first.id);
  const results = queryDecisions({ type: 'failure-trace' });
  assert.strictEqual(results.length, 1);

  const refIndexFile = path.join(tmpRoot, '.claude', 'decisions', 'refs.json');
  assert.ok(fs.existsSync(refIndexFile), 'dedupe should maintain a lightweight ref index');
  const refIndex = JSON.parse(fs.readFileSync(refIndexFile, 'utf8'));
  assert.strictEqual(Object.keys(refIndex).length, 1);
  assert.strictEqual(Object.values(refIndex)[0].id, first.id);
});

run('addDecision: backfills dedupe index from recent global log entry', () => {
  const logDir = path.join(tmpRoot, '.claude', 'decisions');
  const logFile = path.join(logDir, 'index.jsonl');
  fs.mkdirSync(logDir, { recursive: true });

  const existing = {
    id: 'dec-existing-tail',
    date: '2026-04-19',
    type: 'failure-trace',
    domain: 'domain_commands',
    summary: 'existing tail failure trace',
    why: 'same unresolved failure trace',
    ref: 'failure-trace:session-a:tail',
  };
  fs.writeFileSync(logFile, JSON.stringify(existing) + '\n', 'utf8');

  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  const returned = addDecision({
    domain: 'domain_commands',
    type: 'failure-trace',
    summary: 'new duplicate failure trace',
    why: 'same unresolved failure trace',
    ref: 'failure-trace:session-a:tail',
    writeDomain: false,
    dedupeRef: true,
  });

  assert.strictEqual(returned.id, existing.id);
  assert.strictEqual(queryDecisions({ type: 'failure-trace' }).length, 1);

  const refIndexFile = path.join(logDir, 'refs.json');
  const refIndex = JSON.parse(fs.readFileSync(refIndexFile, 'utf8'));
  const key = JSON.stringify(['domain_commands', 'failure-trace', 'failure-trace:session-a:tail']);
  assert.strictEqual(refIndex[key].id, existing.id);
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

run('addDecision: prevention auto-injects constraint for bug-fix', () => {
  const { addDecision } = require('../../scripts/lib/decisions');
  addDecision({
    domain: 'domain_commands',
    type: 'bug-fix',
    summary: 'inline scripts instead of require paths',
    why: 'plugin does not install scripts/ dir',
    prevention: 'require("./scripts/'
  });

  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));

  assert.ok(Array.isArray(domainData.constraints));
  const injected = domainData.constraints.find(c => c.includes('|pattern:'));
  assert.ok(injected, 'constraint with |pattern: should be injected');
  assert.ok(injected.includes('require("./scripts/'), 'pattern should contain the prevention keyword');
});

run('addDecision: prevention not injected for design type', () => {
  const { addDecision } = require('../../scripts/lib/decisions');
  addDecision({
    domain: 'domain_commands',
    type: 'design',
    summary: 'architectural choice',
    why: 'cleaner api',
    prevention: 'some-pattern'
  });

  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  // design type should NOT inject constraint
  const injected = (domainData.constraints || []).find(c => c.includes('|pattern:'));
  assert.ok(!injected, 'design type should not inject prevention constraint');
});

run('addDecision: prevention not duplicated on re-add', () => {
  const { addDecision } = require('../../scripts/lib/decisions');
  const opts = {
    domain: 'domain_commands',
    type: 'constraint',
    summary: 'no hardcoded paths',
    why: 'portability',
    prevention: 'hardcoded-path'
  };
  addDecision(opts);
  addDecision(opts); // add again

  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  const injected = (domainData.constraints || []).filter(c => c.includes('|pattern:hardcoded-path'));
  assert.strictEqual(injected.length, 1, 'duplicate prevention constraint should not be added');
});

run('addDecision: stores failure-trace metadata and makes it searchable', () => {
  const { addDecision, queryDecisions } = require('../../scripts/lib/decisions');
  addDecision({
    domain: 'domain_commands',
    type: 'bug-fix',
    summary: 'silent completion blocked',
    why: 'result summary looked healthy but evidence was missing',
    evidence: ['missing test output'],
    falseNormalSignals: ['summary claimed done without proof'],
    verifyWith: ['rerun targeted tests'],
    nextSuspicion: 'parseCodexResult fallback path',
  });

  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  const [entry] = domainData.decisions;

  assert.deepStrictEqual(entry.evidence, ['missing test output']);
  assert.deepStrictEqual(entry.falseNormalSignals, ['summary claimed done without proof']);
  assert.deepStrictEqual(entry.verifyWith, ['rerun targeted tests']);
  assert.strictEqual(entry.nextSuspicion, 'parseCodexResult fallback path');

  const results = queryDecisions({ q: 'fallback path' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].summary, 'silent completion blocked');
});

run('CLI add: stores failure-trace metadata flags', () => {
  const script = path.join(__dirname, '..', '..', 'scripts', 'lib', 'decisions.js');
  const result = spawnSync(process.execPath, [
    script,
    'add',
    '--domain', 'domain_commands',
    '--type', 'bug-fix',
    '--summary', 'silent completion blocked',
    '--why', 'tests looked green but handoff evidence was absent',
    '--files', 'commands/plan.md,scripts/lib/codex-handoff.js',
    '--evidence', 'missing test output|blocked parser result',
    '--false-normal-signals', 'TESTS PASS without evidence|summary claimed done',
    '--verify-with', 'node tests/lib/codex-handoff.test.js|npm test',
    '--next-suspicion', 'parseCodexResult fallback path',
  ], {
    cwd: tmpRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpRoot,
      USERPROFILE: tmpRoot,
    },
  });

  assert.strictEqual(result.status, 0, result.stderr);

  const domainFile = path.join(tmpRoot, '.claude', 'ontology', 'domain_commands.json');
  const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  const [entry] = domainData.decisions;

  assert.deepStrictEqual(entry.evidence, ['missing test output', 'blocked parser result']);
  assert.deepStrictEqual(entry.falseNormalSignals, ['TESTS PASS without evidence', 'summary claimed done']);
  assert.deepStrictEqual(entry.verifyWith, ['node tests/lib/codex-handoff.test.js', 'npm test']);
  assert.strictEqual(entry.nextSuspicion, 'parseCodexResult fallback path');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
