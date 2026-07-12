'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildContinuityPacket } = require('../../scripts/lib/continuity-packet');

let tmpRoot;

function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-packet-test-'));
}

function teardown() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function writeLog(entries) {
  const logPath = path.join(tmpRoot, 'index.jsonl');
  const lines = entries.map(entry =>
    typeof entry === 'string' ? entry : JSON.stringify(entry)
  );
  fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
  return logPath;
}

function writeOntology(domains) {
  const ontologyDir = path.join(tmpRoot, '.claude', 'ontology');
  fs.mkdirSync(ontologyDir, { recursive: true });
  const index = {};
  for (const domain of domains) {
    index[domain] = { summary: `fixture domain ${domain}`, files: [], dependsOn: [] };
  }
  fs.writeFileSync(path.join(ontologyDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  return ontologyDir;
}

// Fixture: 8 entries across 2 projects/domains, appended oldest -> newest.
// Relevant to "oh-my-forge" project: d1, d3, d6, d7, d8 (5 total)
// Irrelevant: d2 (project=other-project), d5 (unknown domain, no project field)
// Plus one unparseable garbage line.
function fixtureEntries() {
  return [
    { id: 'd1', date: '2026-07-01', type: 'design', domain: 'domain_common', summary: 'Chose JSONL for decisions log', why: 'append-only avoids lock contention', ref: 'PR #10' },
    { id: 'd2', date: '2026-07-02', type: 'bug-fix', domain: 'domain_other', project: 'other-project', summary: 'Fixed off-by-one', why: 'loop bound wrong' },
    { id: 'd3', date: '2026-07-03', type: 'refactor', domain: 'domain_agents', summary: 'Split agent loader', why: 'file exceeded 800 lines' },
    'not valid json {{{',
    { id: 'd5', date: '2026-07-04', type: 'constraint', domain: 'domain_unknown', summary: 'irrelevant domain not in ontology', why: 'not tracked' },
    { id: 'd6', date: '2026-07-05', type: 'design', project: 'oh-my-forge', domain: 'domain_zzz', summary: 'Matched via project field', why: 'project field wins over domain', ref: 'PR #55' },
    { id: 'd7', date: '2026-07-06', type: 'bug-fix', domain: 'domain_common', summary: 'X'.repeat(200), why: 'summary is deliberately very long to force truncation', ref: 'PR #99' },
    { id: 'd8', date: '2026-07-07', type: 'design', domain: 'domain_agents', summary: 'Latest decision', why: 'newest one', ref: 'PR #100' },
  ];
}

function test(name, fn) {
  setup();
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  } finally {
    teardown();
  }
}

let passed = 0;
let failed = 0;
function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

console.log('\n=== Testing continuity-packet ===\n');

run('filters entries relevant to project via project field or ontology domain', () => {
  const logPath = writeLog(fixtureEntries());
  const ontologyDir = writeOntology(['domain_common', 'domain_agents']);

  const { text, decisionCount } = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
  });

  assert.strictEqual(decisionCount, 5, 'should include d1, d3, d6, d7, d8 only');
  assert.ok(text.includes('Latest decision'));
  assert.ok(text.includes('Matched via project field'));
  assert.ok(!text.includes('Fixed off-by-one'), 'other-project entry must be excluded');
  assert.ok(!text.includes('irrelevant domain not in ontology'), 'unknown-domain entry must be excluded');
});

run('orders decisions newest first', () => {
  const logPath = writeLog(fixtureEntries());
  const ontologyDir = writeOntology(['domain_common', 'domain_agents']);

  const { text } = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
    maxChars: 100000,
  });

  const lines = text.split('\n').filter(l => l.startsWith('- ['));
  assert.ok(lines[0].includes('Latest decision'), 'newest (d8) should be first');
  assert.ok(lines[lines.length - 1].includes('Chose JSONL'), 'oldest relevant (d1) should be last');
});

run('respects maxDecisions', () => {
  const logPath = writeLog(fixtureEntries());
  const ontologyDir = writeOntology(['domain_common', 'domain_agents']);

  const { decisionCount, text } = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
    maxDecisions: 2,
    maxChars: 100000,
  });

  assert.strictEqual(decisionCount, 2);
  const lines = text.split('\n').filter(l => l.startsWith('- ['));
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].includes('Latest decision'));
  assert.ok(lines[1].includes('XXXX'), 'second line should be the long-summary entry (d7)');
});

run('truncates a single rendered line to 160 chars', () => {
  const logPath = writeLog(fixtureEntries());
  const ontologyDir = writeOntology(['domain_common', 'domain_agents']);

  const { text } = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
    maxChars: 100000,
  });

  const longLine = text.split('\n').find(l => l.includes('XXXX'));
  assert.ok(longLine, 'expected the deliberately long line to be present');
  assert.strictEqual(longLine.length, 160);
  assert.ok(longLine.endsWith('...'));
});

run('hard-caps total text at maxChars by dropping oldest lines', () => {
  const logPath = writeLog(fixtureEntries());
  const ontologyDir = writeOntology(['domain_common', 'domain_agents']);

  const full = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
    maxChars: 100000,
  });
  assert.strictEqual(full.decisionCount, 5);

  const capped = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
    maxChars: 260,
  });

  assert.ok(capped.text.length <= 260, `expected <=260 chars, got ${capped.text.length}`);
  assert.ok(capped.decisionCount < full.decisionCount, 'should drop lines to fit maxChars');
  assert.ok(capped.text.includes('Latest decision'), 'newest line should survive trimming');
  assert.ok(!capped.text.includes('Chose JSONL'), 'oldest line should be dropped first');
});

run('returns null text when the log file is missing', () => {
  const ontologyDir = writeOntology(['domain_common']);
  const result = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: path.join(tmpRoot, 'does-not-exist.jsonl'),
    ontologyDir,
  });

  assert.deepStrictEqual(result, { text: null, decisionCount: 0 });
});

run('returns null text when no entries are relevant to the project', () => {
  const logPath = writeLog([
    { id: 'x1', date: '2026-07-01', type: 'design', domain: 'domain_unrelated', summary: 'n/a', why: 'n/a' },
  ]);
  const ontologyDir = writeOntology(['domain_common']);

  const result = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
  });

  assert.deepStrictEqual(result, { text: null, decisionCount: 0 });
});

run('skips garbage/unparseable lines without throwing', () => {
  const logPath = writeLog([
    'totally not json',
    '{"broken":',
    { id: 'ok1', date: '2026-07-01', type: 'design', domain: 'domain_common', summary: 'still works', why: 'valid entry among garbage' },
  ]);
  const ontologyDir = writeOntology(['domain_common']);

  const result = buildContinuityPacket({
    cwd: '/Users/dev/oh-my-forge',
    globalLogPath: logPath,
    ontologyDir,
  });

  assert.strictEqual(result.decisionCount, 1);
  assert.ok(result.text.includes('still works'));
});

run('never throws even with a missing ontology directory', () => {
  const logPath = writeLog(fixtureEntries());
  assert.doesNotThrow(() => {
    const result = buildContinuityPacket({
      cwd: '/Users/dev/oh-my-forge',
      globalLogPath: logPath,
      ontologyDir: path.join(tmpRoot, 'no-such-ontology-dir'),
    });
    // domain-based entries (d1, d3, d7, d8) are excluded without ontology;
    // only the project-field match (d6) should remain.
    assert.strictEqual(result.decisionCount, 1);
    assert.ok(result.text.includes('Matched via project field'));
  });
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
