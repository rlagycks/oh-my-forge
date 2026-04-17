'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const commandPath = path.join(repoRoot, 'commands', 'save-session.md');
const commandMd = fs.readFileSync(commandPath, 'utf8');

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

console.log('\nsave-session-failure-trace.test.js');

if (test('save-session prioritizes failure traces over generic lessons', () => {
  assert.ok(commandMd.includes('Failure Trace Ledger'), 'missing failure trace ledger section');
  assert.ok(commandMd.includes('False-normal signals'), 'missing false-normal prompt');
  assert.ok(commandMd.includes('Evidence still missing'), 'missing missing-evidence prompt');
  assert.ok(commandMd.includes('Next suspicion'), 'missing next suspicion prompt');
  assert.ok(commandMd.includes('Do not save a vague lesson'), 'missing vague lesson guardrail');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
