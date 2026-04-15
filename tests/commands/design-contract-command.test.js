'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const commandPath = path.join(repoRoot, 'commands', 'design-contract.md');
const quickRefPath = path.join(repoRoot, 'COMMANDS-QUICK-REF.md');

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
const quickRefMd = read(quickRefPath);

console.log('\ndesign-contract-command.test.js');

if (test('design-contract declares the translation workflow and enforceable outputs', () => {
  expectIncludes(commandMd, '# Design Contract');
  expectIncludes(commandMd, '## Phase 1 — Extract');
  expectIncludes(commandMd, '## Phase 2 — Translate');
  expectIncludes(commandMd, '## Verification Points');
  expectIncludes(commandMd, '## False-Normal Checks');
  expectIncludes(commandMd, '## Expansion Forbidden');
  expectIncludes(commandMd, '## Handoff Format');
})) passed++; else failed++;

if (test('design-contract links to adjacent commands in the workflow', () => {
  expectIncludes(commandMd, '`/plan`');
  expectIncludes(commandMd, '`/ontology-extract`');
  expectIncludes(commandMd, '`/prp-plan`');
  expectIncludes(commandMd, 'promote-contract');
})) passed++; else failed++;

if (test('quick reference includes the design-contract command', () => {
  expectIncludes(quickRefMd, '`/design-contract`');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
