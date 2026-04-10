'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { appendEntry, buildEntry, today } = require('../../scripts/lib/ontology-changelog');

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

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-changelog-test-'));
  fs.mkdirSync(path.join(dir, '.claude', 'ontology'), { recursive: true });
  return dir;
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

console.log('\n=== Testing ontology-changelog ===\n');

// buildEntry
run('buildEntry includes domain and action', () => {
  const entry = buildEntry({ domain: 'domain_foo', action: 'added' });
  assert.ok(entry.includes('domain_foo'));
  assert.ok(entry.includes('[added]'));
});

run('buildEntry includes today date', () => {
  const entry = buildEntry({ domain: 'domain_bar', action: 'updated' });
  assert.ok(entry.includes(today()));
});

run('buildEntry includes changedFields when provided', () => {
  const entry = buildEntry({ domain: 'domain_x', action: 'updated', changedFields: ['files', 'spec'] });
  assert.ok(entry.includes('files, spec'));
});

run('buildEntry includes trigger and reason', () => {
  const entry = buildEntry({
    domain: 'domain_x',
    action: 'added',
    trigger: 'ontology-sync',
    reason: 'spec found',
  });
  assert.ok(entry.includes('ontology-sync'));
  assert.ok(entry.includes('spec found'));
});

run('buildEntry omits Fields/Trigger/Reason lines when not provided', () => {
  const entry = buildEntry({ domain: 'domain_x', action: 'removed' });
  assert.ok(!entry.includes('**Fields**'));
  assert.ok(!entry.includes('**Trigger**'));
  assert.ok(!entry.includes('**Reason**'));
});

// appendEntry — file creation
run('appendEntry creates CHANGELOG.md when missing', () => {
  const root = makeTmpRoot();
  appendEntry(root, { domain: 'domain_test', action: 'added', trigger: 'test' });
  const changelogPath = path.join(root, '.claude', 'ontology', 'CHANGELOG.md');
  assert.ok(fs.existsSync(changelogPath));
  const content = fs.readFileSync(changelogPath, 'utf8');
  assert.ok(content.includes('domain_test'));
  fs.rmSync(root, { recursive: true });
});

run('appendEntry prepends new entry to existing file', () => {
  const root = makeTmpRoot();
  appendEntry(root, { domain: 'domain_first', action: 'added', trigger: 'test' });
  appendEntry(root, { domain: 'domain_second', action: 'updated', trigger: 'test' });
  const changelogPath = path.join(root, '.claude', 'ontology', 'CHANGELOG.md');
  const content = fs.readFileSync(changelogPath, 'utf8');
  const idxFirst = content.indexOf('domain_first');
  const idxSecond = content.indexOf('domain_second');
  // second entry was appended last, so it should appear before first (newest first)
  assert.ok(idxSecond < idxFirst, 'Newest entry should appear before older entry');
  fs.rmSync(root, { recursive: true });
});

run('appendEntry does not throw on missing directory (graceful fail)', () => {
  // point to a root that has no .claude/ontology dir
  const fakeRoot = path.join(os.tmpdir(), 'no-such-dir-' + Date.now());
  // should not throw
  appendEntry(fakeRoot, { domain: 'domain_x', action: 'added' });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
