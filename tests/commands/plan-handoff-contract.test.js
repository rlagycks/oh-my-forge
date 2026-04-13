'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const planCommandPath = path.join(repoRoot, 'commands', 'plan.md');
const codexDelegatePath = path.join(repoRoot, 'commands', 'codex-delegate.md');

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

function expectNotIncludes(content, snippet, message) {
  assert.ok(!content.includes(snippet), message || `Did not expect to include: ${snippet}`);
}

const planMd = read(planCommandPath);
const codexDelegateMd = read(codexDelegatePath);

let passed = 0;
let failed = 0;

console.log('\nplan-handoff-contract.test.js');

if (test('plan saves approved plans via save-plan helper', () => {
  expectIncludes(planMd, 'scripts/lib/save-plan.js');
  expectNotIncludes(planMd, 'node -e "\nconst fs=require(\'fs\')');
})) passed++; else failed++;

if (test('plan resolves engine via shared detectImplementationEngine helper', () => {
  expectIncludes(planMd, 'detectImplementationEngine');
  expectIncludes(planMd, 'scripts/lib/utils.js');
})) passed++; else failed++;

if (test('plan delegates routing and request construction to the shared codex handoff runtime', () => {
  expectIncludes(planMd, 'scripts/lib/codex-handoff.js');
  expectIncludes(planMd, 'createPlanRoute');
  expectIncludes(planMd, 'validateHandoff');
})) passed++; else failed++;

if (test('plan no longer falls back to a domain-less /codex-delegate call', () => {
  expectNotIncludes(planMd, 'prompt: "Run /codex-delegate with this plan context:');
  expectIncludes(planMd, 'domain-less `/codex-delegate` calls are invalid');
})) passed++; else failed++;

if (test('plan blocks silent Claude fallback when engine=codex but routing data is unavailable', () => {
  expectIncludes(planMd, 'Do NOT silently switch to Claude implementation');
  expectIncludes(planMd, 'BLOCKED');
})) passed++; else failed++;

if (test('codex-delegate documents the shared handoff runtime as the source of truth', () => {
  expectIncludes(codexDelegateMd, 'scripts/lib/codex-handoff.js');
  expectIncludes(codexDelegateMd, 'buildBrief');
  expectIncludes(codexDelegateMd, 'buildCompanionCommand');
})) passed++; else failed++;

if (test('codex-delegate documents background rescue as a manual path only', () => {
  expectIncludes(codexDelegateMd, 'Background mode is manual-only');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
