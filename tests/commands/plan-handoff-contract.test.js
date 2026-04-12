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

if (test('plan treats process.cwd() as the routing root for ontology/fileMap checks', () => {
  expectIncludes(planMd, 'treat `process.cwd()` as the active project root');
  expectIncludes(planMd, 'Do NOT use `CLAUDE_PLUGIN_ROOT` to decide whether the current project has an ontology');
  expectIncludes(planMd, 'fileMap');
})) passed++; else failed++;

if (test('plan no longer falls back to a domain-less /codex-delegate call', () => {
  expectNotIncludes(planMd, 'prompt: "Run /codex-delegate with this plan context:');
  expectIncludes(planMd, '/codex:rescue --wait --fresh');
})) passed++; else failed++;

if (test('plan blocks silent Claude fallback when engine=codex but routing data is unavailable', () => {
  expectIncludes(planMd, 'Do NOT silently switch to Claude implementation');
  expectIncludes(planMd, 'BLOCKED');
})) passed++; else failed++;

if (test('codex-delegate uses foreground rescue for automatic plan handoff', () => {
  expectIncludes(codexDelegateMd, '/codex:rescue <BRIEF> --wait --fresh');
  expectNotIncludes(codexDelegateMd, '/codex:rescue <BRIEF> --background --fresh');
})) passed++; else failed++;

if (test('codex-delegate documents background rescue as a manual path only', () => {
  expectIncludes(codexDelegateMd, 'If you explicitly want queued background work, call `/codex:rescue --background` directly');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
