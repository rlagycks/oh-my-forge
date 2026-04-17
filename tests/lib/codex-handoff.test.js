'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildBrief,
  buildCompanionCommand,
  createPlanRoute,
  createDomainDelegation,
  createFallbackRescue,
  dispatchHandoff,
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
    sourceDocs: {
      apiSpec: ['docs/features/hooks/api.md'],
      prd: ['docs/features/hooks/prd.md'],
    },
  });

  const validation = validateHandoff(request);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(request.kind, 'domain');
  assert.strictEqual(request.domainId, 'domain_hooks');
  assert.strictEqual(request.source, 'manual-delegate');
  assert.strictEqual(request.state, 'ROUTED');
  assert.strictEqual(request.write, true);
  assert.deepStrictEqual(request.dependsOn, ['domain_utils']);
  assert.deepStrictEqual(request.sourceDocs.apiSpec, ['docs/features/hooks/api.md']);
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
  assert.strictEqual(request.source, 'manual-rescue');
  assert.strictEqual(request.write, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(request, 'domainId'));
})) passed++; else failed++;

if (test('validateHandoff rejects domain handoffs without domainId', () => {
  const validation = validateHandoff({
    schemaVersion: 'ecc.codex.handoff.request.v1',
    kind: 'domain',
    state: 'ROUTED',
    engine: 'codex',
    source: 'manual-delegate',
    mode: 'foreground',
    write: true,
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Broken handoff',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('domainId'), validation.error);
})) passed++; else failed++;

if (test('validateHandoff rejects background mode for automatic plan handoffs', () => {
  const validation = validateHandoff({
    schemaVersion: 'ecc.codex.handoff.request.v1',
    kind: 'domain',
    state: 'ROUTED',
    engine: 'codex',
    source: 'plan-auto',
    mode: 'background',
    write: true,
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    domainId: 'domain_hooks',
    task: 'Broken automatic handoff',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('/mode') || validation.error.includes('constant'), validation.error);
})) passed++; else failed++;

if (test('validateHandoff rejects Codex requests that do not opt into write mode', () => {
  const validation = validateHandoff({
    schemaVersion: 'ecc.codex.handoff.request.v1',
    kind: 'domain',
    state: 'ROUTED',
    engine: 'codex',
    source: 'manual-delegate',
    mode: 'foreground',
    write: false,
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    domainId: 'domain_hooks',
    task: 'Read-only handoff',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('/write') || validation.error.includes('constant'), validation.error);
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
    sourceDocs: {
      apiSpec: ['docs/features/hooks/api.md'],
    },
  });

    const brief = buildBrief(request);
    assert.ok(brief.includes('DOMAIN    : domain_hooks'), brief);
    assert.ok(brief.includes('PROBLEM   : Add retry guard coverage'), brief);
    assert.ok(brief.includes('SUCCESS   :'), brief);
    assert.ok(brief.includes('CHECKS    :'), brief);
    assert.ok(brief.includes('SOURCE    : manual-delegate'), brief);
    assert.ok(brief.includes('SOURCE DOCS: apiSpec=docs/features/hooks/api.md'), brief);
    assert.ok(brief.includes('load only when code/types do not contain the needed contract'), brief);
    assert.ok(brief.includes('WRITE     : true'), brief);
    assert.ok(brief.includes('PLAN FILE : /repo/.claude/plans/retry.md'), brief);
    assert.ok(brief.includes('FALSE NORMAL DETECTOR:'), brief);
    assert.ok(brief.includes('HANDOFF   : Return: RESULT / FILES CHANGED / TESTS / EVIDENCE / FALSE NORMAL CHECKS / FALSE NORMAL SIGNALS / OPEN RISKS / NEXT ACTION / SUMMARY'), brief);
    assert.strictEqual(request.schemaVersion, 'ecc.codex.handoff.request.v2');
    assert.ok(Array.isArray(request.successCriteria) && request.successCriteria.length > 0, JSON.stringify(request));
    assert.ok(Array.isArray(request.completionChecks) && request.completionChecks.length > 0, JSON.stringify(request));
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
    assert.ok(command.includes('--write'), command);
    assert.ok(command.includes('--prompt-file'), command);
    assert.ok(!command.includes('Add retry guard coverage'), command);
  } finally {
    fs.unlinkSync(promptFile);
  }
})) passed++; else failed++;

if (test('createPlanRoute marks generated Codex handoffs as write-enabled', () => {
  const route = createPlanRoute({
    engine: 'codex',
    routingRoot: path.resolve(__dirname, '../..'),
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Guard tracked files',
    files: ['scripts/hooks/pre-bash-codex-guard.js', 'scripts/hooks/pre-write-edit-codex-guard.js'],
  });

  assert.strictEqual(route.state, 'ROUTED');
  assert.ok(route.handoffs.length > 0, 'Expected at least one handoff');
  assert.ok(route.handoffs.every(handoff => handoff.write === true), JSON.stringify(route.handoffs, null, 2));
})) passed++; else failed++;

if (test('createPlanRoute applies ontology retrieval profiles to generated handoffs', () => {
  const route = createPlanRoute({
    engine: 'codex',
    routingRoot: path.resolve(__dirname, '../..'),
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Tighten hook routing packet usage',
    files: ['scripts/hooks/domain-context-inject.js'],
  });

  const request = route.handoffs.find(handoff => handoff.kind === 'domain' && handoff.domainId === 'domain_hooks');
  assert.ok(request, JSON.stringify(route, null, 2));
  assert.ok(request.successCriteria.some(line => line.includes('capture/inject 경계가 유지')), JSON.stringify(request, null, 2));
  assert.ok(request.notDo.some(line => line.includes('장시간 차단')), JSON.stringify(request, null, 2));
  assert.ok(request.notDo.some(line => line.includes('오래된 설계 결정')), JSON.stringify(request, null, 2));
  assert.ok(request.completionChecks.some(line => line.includes('훅이 조용하다고')), JSON.stringify(request, null, 2));
})) passed++; else failed++;

if (test('dispatchHandoff runs the companion with a generated prompt file and parses the result', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dispatch-'));
  const companionPath = path.join(fixtureDir, 'fake-companion.mjs');
  fs.writeFileSync(companionPath, [
    'import fs from "node:fs";',
    'const promptIdx = process.argv.indexOf("--prompt-file");',
    'const hasWrite = process.argv.includes("--write");',
    'if (promptIdx === -1) {',
    '  console.log("RESULT: BLOCKED");',
    '  console.log("FILES CHANGED: none");',
    '  console.log("TESTS: FAIL");',
    '  console.log("EVIDENCE: prompt file missing");',
    '  console.log("FALSE NORMAL CHECKS: request never reached Codex execution");',
    '  console.log("FALSE NORMAL SIGNALS: task was never executed");',
    '  console.log("OPEN RISKS: task not executed");',
    '  console.log("NEXT ACTION: fix prompt file generation");',
    '  console.log("SUMMARY: prompt file missing");',
    '  process.exit(0);',
    '}',
    'const prompt = fs.readFileSync(process.argv[promptIdx + 1], "utf8");',
    'console.log("RESULT: DONE");',
    'console.log("FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js");',
    'console.log("TESTS: PASS");',
    'console.log("EVIDENCE: updated guard path | prompt file consumed");',
    'console.log("FALSE NORMAL CHECKS: verified prompt included BRIEF and SOURCE");',
    'console.log("FALSE NORMAL SIGNALS: none");',
    'console.log("OPEN RISKS: none");',
    'console.log("NEXT ACTION: review diff and merge");',
    'console.log(`SUMMARY: ${prompt.includes("BRIEF") && prompt.includes("SOURCE") && hasWrite ? "dispatch ok" : "prompt malformed"}`);',
  ].join('\n'), 'utf8');

  try {
    const result = dispatchHandoff({
      companionPath,
      request,
    });

    assert.strictEqual(result.result, 'DONE');
    assert.strictEqual(result.tests, 'PASS');
    assert.ok(result.summary.includes('dispatch ok'), result.summary);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('dispatchHandoff resolves the companion from CODEX_COMPANION_PATH when explicit path is absent', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dispatch-env-'));
  const companionPath = path.join(fixtureDir, 'env-companion.mjs');
  fs.writeFileSync(companionPath, [
    'console.log("RESULT: DONE");',
    'console.log("FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js");',
    'console.log("TESTS: PASS");',
    'console.log("EVIDENCE: env override path used");',
    'console.log("FALSE NORMAL CHECKS: confirmed env path companion executed");',
    'console.log("FALSE NORMAL SIGNALS: none");',
    'console.log("OPEN RISKS: none");',
    'console.log("NEXT ACTION: keep env override documented");',
    'console.log("SUMMARY: env path ok");',
  ].join('\n'), 'utf8');

  const previous = process.env.CODEX_COMPANION_PATH;
  process.env.CODEX_COMPANION_PATH = companionPath;
  try {
    const result = dispatchHandoff({ request });
    assert.strictEqual(result.result, 'DONE');
    assert.ok(result.summary.includes('env path ok'), result.summary);
  } finally {
    if (previous === undefined) delete process.env.CODEX_COMPANION_PATH;
    else process.env.CODEX_COMPANION_PATH = previous;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('dispatchHandoff auto-resolves the companion when no explicit path or env override is provided', () => {
  const request = createDomainDelegation({
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dispatch-auto-'));
  const eccRoot = path.join(fixtureDir, 'ecc-root');
  const companionPath = path.join(eccRoot, 'scripts', 'codex-companion.mjs');
  fs.mkdirSync(path.dirname(companionPath), { recursive: true });
  fs.writeFileSync(companionPath, [
    'console.log("RESULT: DONE");',
    'console.log("FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js");',
    'console.log("TESTS: PASS");',
    'console.log("EVIDENCE: bounded auto discovery resolved ecc-root script");',
    'console.log("FALSE NORMAL CHECKS: confirmed auto-resolved companion actually executed");',
    'console.log("FALSE NORMAL SIGNALS: none");',
    'console.log("OPEN RISKS: none");',
    'console.log("NEXT ACTION: keep fallback discovery bounded");',
    'console.log("SUMMARY: auto path ok");',
  ].join('\n'), 'utf8');

  const previous = process.env.CODEX_COMPANION_PATH;
  delete process.env.CODEX_COMPANION_PATH;
  try {
    const result = dispatchHandoff({
      request,
      envRoot: eccRoot,
      homeDir: fixtureDir,
    });
    assert.strictEqual(result.result, 'DONE');
    assert.ok(result.summary.includes('auto path ok'), result.summary);
  } finally {
    if (previous === undefined) delete process.env.CODEX_COMPANION_PATH;
    else process.env.CODEX_COMPANION_PATH = previous;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('dispatchHandoff turns missing RESULT output into explicit BLOCKED status', () => {
  const request = createFallbackRescue({
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Fallback rescue',
    files: ['src/untracked.js'],
  });

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dispatch-blocked-'));
  const companionPath = path.join(fixtureDir, 'fake-companion.mjs');
  fs.writeFileSync(companionPath, 'console.log("SUMMARY: missing result");\n', 'utf8');

  try {
    const result = dispatchHandoff({
      companionPath,
      request,
    });

    assert.strictEqual(result.state, 'BLOCKED');
    assert.strictEqual(result.result, 'BLOCKED');
    assert.ok(result.error.includes('RESULT'), result.error);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('parseCodexResult parses successful Codex output into a schema-valid result', () => {
  const result = parseCodexResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js, tests/hooks/pre-bash-codex-guard.test.js',
    'TESTS: PASS',
    'EVIDENCE: updated guard logic | added coverage',
    'FALSE NORMAL CHECKS: confirmed test pass covers changed path',
    'FALSE NORMAL SIGNALS: none',
    'OPEN RISKS: none',
    'NEXT ACTION: request review',
    'SUMMARY: Updated the guard and added validator coverage.',
  ].join('\n'));

  const validation = validateResult(result);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(result.result, 'DONE');
  assert.deepStrictEqual(result.evidence, ['updated guard logic', 'added coverage']);
  assert.deepStrictEqual(result.falseNormalChecks, ['confirmed test pass covers changed path']);
  assert.deepStrictEqual(result.falseNormalSignals, []);
  assert.deepStrictEqual(result.openRisks, []);
  assert.strictEqual(result.nextAction, 'request review');
  assert.deepStrictEqual(result.filesChanged, [
    'scripts/hooks/pre-bash-codex-guard.js',
    'tests/hooks/pre-bash-codex-guard.test.js',
  ]);
})) passed++; else failed++;

if (test('parseCodexResult blocks DONE when only tests look healthy', () => {
  const result = parseCodexResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js',
    'TESTS: PASS',
    'SUMMARY: tests passed',
  ].join('\n'));

  const validation = validateResult(result);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.state, 'BLOCKED');
  assert.strictEqual(result.result, 'BLOCKED');
  assert.ok(result.error.includes('False-normal detector'), result.error);
  assert.ok(result.falseNormalSignals.some(signal => signal.includes('EVIDENCE')), JSON.stringify(result));
  assert.ok(result.falseNormalSignals.some(signal => signal.includes('FALSE NORMAL CHECKS')), JSON.stringify(result));
  assert.ok(result.falseNormalSignals.some(signal => signal.includes('NEXT ACTION')), JSON.stringify(result));
})) passed++; else failed++;

if (test('parseCodexResult blocks DONE with unresolved false-normal signals', () => {
  const result = parseCodexResult([
    'RESULT: DONE',
    'FILES CHANGED: scripts/hooks/pre-bash-codex-guard.js',
    'TESTS: PASS',
    'EVIDENCE: updated guard logic',
    'FALSE NORMAL CHECKS: checked the changed guard path',
    'FALSE NORMAL SIGNALS: green tests did not exercise the dispatch path',
    'OPEN RISKS: none',
    'NEXT ACTION: request review',
    'SUMMARY: Updated the guard.',
  ].join('\n'));

  const validation = validateResult(result);
  assert.strictEqual(validation.valid, true, validation.error);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.state, 'BLOCKED');
  assert.strictEqual(result.result, 'BLOCKED');
  assert.ok(result.falseNormalSignals.includes('green tests did not exercise the dispatch path'), JSON.stringify(result));
  assert.ok(result.error.includes('unresolved FALSE NORMAL SIGNALS'), result.error);
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
