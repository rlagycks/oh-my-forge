'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildBrief,
  buildCompanionCommand,
  createDomainDelegation,
  createFallbackRescue,
  parseCodexResult,
  validateHandoff,
  validateResult,
} = require('../../scripts/lib/codex-handoff');

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

console.log('\ncodex-handoff.test.js');

if (test('createDomainDelegation returns a schema-valid domain handoff', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js', 'tests/hooks/pre-bash-codex-guard.test.js'],
    constraints: ['Do not use background mode'],
    dependsOn: ['domain_utils'],
  });

  const validation = validateHandoff(request);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(request.kind, 'domain');
  assert.strictEqual(request.domainId, 'domain_hooks');
  assert.strictEqual(request.state, 'ROUTED');
  assert.deepStrictEqual(request.dependsOn, ['domain_utils']);
})) passed++; else failed++;

if (test('createFallbackRescue returns a schema-valid fallback handoff without domainId', () => {
  const request = createFallbackRescue({
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Implement unmatched files',
    files: ['src/untracked.js'],
    featureName: 'Retry Guard',
  });

  const validation = validateHandoff(request);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(request.kind, 'fallback');
  assert.ok(!Object.prototype.hasOwnProperty.call(request, 'domainId'));
})) passed++; else failed++;

if (test('validateHandoff rejects domain handoffs without domainId', () => {
  const validation = validateHandoff({
    schemaVersion: 'ecc.codex.handoff.request.v1',
    kind: 'domain',
    state: 'ROUTED',
    engine: 'codex',
    mode: 'foreground',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Broken handoff',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('domainId'), validation.error);
})) passed++; else failed++;

if (test('buildBrief emits the shared handoff format', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
    constraints: ['Foreground only'],
  });

  const brief = buildBrief(request);
  assert.ok(brief.includes('DOMAIN    : domain_hooks'), brief);
  assert.ok(brief.includes('PLAN FILE : /repo/.claude/plans/retry.md'), brief);
  assert.ok(brief.includes('HANDOFF   : Return: RESULT / FILES CHANGED / TESTS / SUMMARY'), brief);
})) passed++; else failed++;

if (test('buildCompanionCommand emits prompt-file based command without inline prompt rewriting needs', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  const promptFile = path.join(os.tmpdir(), `codex-handoff-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, buildBrief(request), 'utf8');

  try {
    const command = buildCompanionCommand({
      companionPath: '/tmp/codex-companion.mjs',
      promptFile,
      request,
      fresh: true,
    });

    assert.ok(command.includes('node "/tmp/codex-companion.mjs" task'), command);
    assert.ok(command.includes('--domain-id domain_hooks'), command);
    assert.ok(command.includes('--prompt-file'), command);
    assert.ok(!command.includes('Add retry guard coverage'), command);
  } finally {
    fs.unlinkSync(promptFile);
  }
})) passed++; else failed++;

if (test('parseCodexResult parses successful Codex output into a schema-valid result', () => {
  const result = parseCodexResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js, tests/hooks/pre-bash-codex-guard.test.js',
    'TESTS: PASS',
    'SUMMARY: Updated the guard and added validator coverage.',
  ].join('\n'));

  const validation = validateResult(result);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(result.result, 'DONE');
  assert.deepStrictEqual(result.filesChanged, [
    'scripts/hooks/pre-bash-codex-guard.js',
    'tests/hooks/pre-bash-codex-guard.test.js',
  ]);
})) passed++; else failed++;

if (test('parseCodexResult turns missing RESULT output into explicit BLOCKED status', () => {
  const result = parseCodexResult('FILES CHANGED: none\nTESTS: SKIPPED\nSUMMARY: nothing');

  const validation = validateResult(result);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.state, 'BLOCKED');
  assert.strictEqual(result.result, 'BLOCKED');
  assert.ok(result.error.includes('RESULT'), result.error);
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
