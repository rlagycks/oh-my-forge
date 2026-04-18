'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const domainPath = path.join(repoRoot, '.claude', 'ontology', 'domain_session.json');
const docPath = path.join(repoRoot, 'docs', 'features', 'session.md');

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

let passed = 0;
let failed = 0;

console.log('\nsession-ontology-failure-trace.test.js');

if (test('domain_session ontology exposes a minimal failure-trace contract', () => {
  const domain = JSON.parse(fs.readFileSync(domainPath, 'utf8'));

  assert.ok(
    domain.executionContract.notDo.some(item => item.includes('generic lesson')),
    'missing generic lesson prohibition'
  );
  assert.ok(
    domain.completionContract.falseNormalChecks.some(item => item.includes('Tests passed but evidence missing')),
    'missing false-normal completion check'
  );
  assert.strictEqual(domain.failurePatterns[0].id, 'session-generic-lesson');
  assert.ok(domain.source.includes('scripts/lib/decisions.js'), 'missing durable decisions dependency');
  assert.ok(
    domain.constraints.some(item => item.includes('failure-trace 타입으로 승격')),
    'missing durable failure-trace promotion constraint'
  );
  assert.deepStrictEqual(domain.retrievalProfiles.context.maxDecisions, 0);
  assert.ok(
    domain.retrievalProfiles.context.include.includes('completionContract.falseNormalChecks'),
    'context profile must load only the relevant false-normal checks'
  );
})) passed++; else failed++;

if (test('session feature doc documents failure traces and minimal context loading', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  assert.ok(doc.includes('실패 흔적 장부'), 'missing failure trace constraint');
  assert.ok(doc.includes('durable decisions log'), 'missing durable promotion documentation');
  assert.ok(doc.includes('기본 context profile'), 'missing minimal retrieval constraint');
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
