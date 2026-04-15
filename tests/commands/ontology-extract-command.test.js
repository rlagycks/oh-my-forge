'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const commandPath = path.join(repoRoot, 'commands', 'ontology-extract.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

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

function expectIncludes(content, snippet, message) {
  assert.ok(content.includes(snippet), message || `Expected to include: ${snippet}`);
}

let passed = 0;
let failed = 0;

const commandMd = read(commandPath);

console.log('\nontology-extract-command.test.js');

if (test('ontology-extract documents the promote-contract fast path for existing design contracts', () => {
  expectIncludes(commandMd, '`/design-contract`');
  expectIncludes(commandMd, 'promote-contract');
  expectIncludes(commandMd, 'node "$PLUGIN_ROOT/scripts/lib/ontology.js" promote-contract');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
