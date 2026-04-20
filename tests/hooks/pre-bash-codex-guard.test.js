/**
 * Tests for pre-bash-codex-guard.js — validator-only Codex bash guard
 *
 * Run with: node tests/hooks/pre-bash-codex-guard.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/pre-bash-codex-guard.js');
const {
  createDomainDelegation,
  createFallbackRescue,
} = require('../../scripts/lib/codex-handoff');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(command) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
  });
}

function makeRequestFile(request) {
  const file = path.join(os.tmpdir(), `codex-request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(request, null, 2), 'utf8');
  return file;
}

function fakeDispatchCmd(requestFile, extraFlags = '') {
  return `node "/repo/scripts/lib/codex-handoff.js" dispatch --request-file ${requestFile} ${extraFlags}`.trim();
}

function fakeCompanionCmd(domainId, extraFlags = '') {
  const domainFlag = domainId ? `--domain-id ${domainId}` : '';
  return `node "/some/path/codex-companion.mjs" task ${domainFlag} ${extraFlags} --prompt-file /tmp/brief.txt`.trim();
}

function getStatePathForSession(sessionId) {
  return path.join(os.tmpdir(), `ecc-codex-guard-${sessionId}.json`);
}

function runWithSession(sessionId, command) {
  // Set a deterministic session ID so we control the state file
  process.env.CLAUDE_SESSION_ID = sessionId;
  // Reload the module fresh each time to avoid cached state
  delete require.cache[hookPath];
  const { run } = require(hookPath);
  const result = run(makeInput(command));
  delete process.env.CLAUDE_SESSION_ID;
  return result;
}

function cleanState(sessionId) {
  try { fs.unlinkSync(getStatePathForSession(sessionId)); } catch (_error) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testNonCodexCommandPassThrough() {
  const sessionId = 'test-non-codex-' + Date.now();
  cleanState(sessionId);

  const result = runWithSession(sessionId, 'npm run test');
  assert.strictEqual(result, makeInput('npm run test'), 'Non-codex command should pass through');
  console.log('  PASS testNonCodexCommandPassThrough');
  cleanState(sessionId);
}

function testPromptFileDomainCallAllowed() {
  const sessionId = 'test-dispatch-plan-auto-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Add retry guard coverage',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  }));

  try {
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.ok(typeof result === 'string', 'Dispatch with valid request file should be allowed');
    console.log('  PASS testPromptFileDomainCallAllowed');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testRawCompanionCallsBlocked() {
  const sessionId = 'test-raw-companion-' + Date.now();
  cleanState(sessionId);

  const result = runWithSession(sessionId, fakeCompanionCmd('domain_hooks'));
  assert.deepStrictEqual(result, { exitCode: 2 },
    'Raw codex-companion calls should be blocked in favor of dispatch');
  console.log('  PASS testRawCompanionCallsBlocked');
  cleanState(sessionId);
}

function testInvalidDispatchRequestBlocked() {
  const sessionId = 'test-invalid-request-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile({
    schemaVersion: 'ecc.codex.handoff.request.v1',
    kind: 'domain',
    state: 'ROUTED',
    engine: 'codex',
    source: 'manual-delegate',
    mode: 'foreground',
    write: true,
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Broken request',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  try {
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.deepStrictEqual(result, { exitCode: 2 },
      'Invalid dispatch request should be blocked');
    console.log('  PASS testInvalidDispatchRequestBlocked');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testReadOnlyDispatchRequestBlocked() {
  const sessionId = 'test-read-only-request-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile({
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
    task: 'Read-only request',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  try {
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.deepStrictEqual(result, { exitCode: 2 },
      'Read-only Codex dispatch request should be blocked by schema validation');
    console.log('  PASS testReadOnlyDispatchRequestBlocked');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testSecondCallSameDomainBlocked() {
  const sessionId = 'test-second-same-domain-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_codex',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Plan auto domain',
    files: ['scripts/lib/codex-handoff.js'],
  }));

  try {
    runWithSession(sessionId, fakeDispatchCmd(requestFile));

    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.deepStrictEqual(result, { exitCode: 2 },
      'Second automatic dispatch for same domain should return { exitCode: 2 }');
    console.log('  PASS testSecondCallSameDomainBlocked');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testSecondCallDifferentDomainAllowed() {
  const sessionId = 'test-second-diff-domain-' + Date.now();
  cleanState(sessionId);

  const requestFile1 = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_hooks',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Hooks plan',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  }));
  const requestFile2 = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_session',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Session plan',
    files: ['scripts/hooks/session-start-bootstrap.js'],
  }));

  try {
    runWithSession(sessionId, fakeDispatchCmd(requestFile1));
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile2));
    assert.ok(typeof result === 'string',
      'Second automatic dispatch for a different domain should be allowed');
    console.log('  PASS testSecondCallDifferentDomainAllowed');
  } finally {
    try { fs.unlinkSync(requestFile1); } catch (_error) { /* ignore */ }
    try { fs.unlinkSync(requestFile2); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testManualBackgroundDispatchAllowed() {
  const sessionId = 'test-manual-background-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createFallbackRescue({
    source: 'manual-rescue',
    engine: 'codex',
    mode: 'background',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Manual fallback rescue',
    files: ['misc/untracked.js'],
  }));

  try {
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.ok(typeof result === 'string',
      'Manual background dispatch should be allowed');
    console.log('  PASS testManualBackgroundDispatchAllowed');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testPlanAutoBackgroundDispatchBlocked() {
  const sessionId = 'test-plan-auto-background-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile({
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
    task: 'Broken plan auto',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });

  try {
    const result = runWithSession(sessionId, fakeDispatchCmd(requestFile));
    assert.deepStrictEqual(result, { exitCode: 2 },
      'Automatic plan dispatch should reject background mode');
    console.log('  PASS testPlanAutoBackgroundDispatchBlocked');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testStateFileHasDomainsKey() {
  const sessionId = 'test-state-shape-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_qa',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'QA plan',
    files: ['docs/qa/bug-topology.md'],
  }));

  runWithSession(sessionId, fakeDispatchCmd(requestFile));

  const statePath = getStatePathForSession(sessionId);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(state.domains, 'State file should have a "domains" key');
  assert.strictEqual(state.domains['domain_qa'], 1, 'domains.domain_qa should equal 1');
  assert.ok(!('invocations' in state), 'Old "invocations" key should not exist');
  console.log('  PASS testStateFileHasDomainsKey');
  try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
  cleanState(sessionId);
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

function testRedirectionOutputNotTreatedAsPositional() {
  const sessionId = 'test-redir-out-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_redir_out',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Redirection output test',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  }));

  try {
    const cmd = fakeDispatchCmd(requestFile) + ' > /tmp/codex-out.txt';
    const result = runWithSession(sessionId, cmd);
    assert.ok(typeof result === 'string',
      'Redirection output target should not be treated as a positional argument');
    console.log('  PASS testRedirectionOutputNotTreatedAsPositional');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testRedirectionInputNotTreatedAsPositional() {
  const sessionId = 'test-redir-in-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_redir_in',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Redirection input test',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  }));

  try {
    const cmd = fakeDispatchCmd(requestFile) + ' < /tmp/codex-in.txt';
    const result = runWithSession(sessionId, cmd);
    assert.ok(typeof result === 'string',
      'Redirection input target should not be treated as a positional argument');
    console.log('  PASS testRedirectionInputNotTreatedAsPositional');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testSingleQuotedRequestFileValidated() {
  // A path wrapped in single quotes should still be validated, not skipped as
  // if it contained a shell variable.
  const sessionId = 'test-single-quoted-' + Date.now();
  cleanState(sessionId);

  const requestFile = makeRequestFile(createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_sq_test',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Single-quoted path test',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  }));

  try {
    // Replace the unquoted path with a single-quoted path in the dispatch command
    const cmd = fakeDispatchCmd(requestFile).replace(
      '--request-file ' + requestFile,
      "--request-file '" + requestFile + "'"
    );
    const result = runWithSession(sessionId, cmd);
    assert.ok(typeof result === 'string',
      'Single-quoted request file path should be validated and allowed');
    console.log('  PASS testSingleQuotedRequestFileValidated');
  } finally {
    try { fs.unlinkSync(requestFile); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

function testSingleQuotedPathWithDollarValidated() {
  // A single-quoted path containing a literal $ must still be validated.
  // The guard must NOT skip validation because the $ is inside single quotes
  // and is therefore a literal character, not a shell variable reference.
  const sessionId = 'test-sq-dollar-' + Date.now();
  cleanState(sessionId);

  const tmpDir = os.tmpdir();
  const literalDollarPath = path.join(tmpDir, 'request$sqtest-' + Date.now() + '.json');
  const payload = createDomainDelegation({
    source: 'plan-auto',
    domainId: 'domain_dollar_sq',
    engine: 'codex',
    routingRoot: '/repo',
    planFile: '/repo/.claude/plans/retry.md',
    task: 'Dollar-in-path single-quote test',
    files: ['scripts/hooks/pre-bash-codex-guard.js'],
  });
  fs.writeFileSync(literalDollarPath, JSON.stringify(payload, null, 2), 'utf8');

  try {
    const base = fakeDispatchCmd(literalDollarPath);
    // Wrap path in single quotes — $ must be treated as literal by the guard
    const cmd = base.replace(
      '--request-file ' + literalDollarPath,
      "--request-file '" + literalDollarPath + "'"
    );
    const result = runWithSession(sessionId, cmd);
    assert.ok(typeof result === 'string',
      'Single-quoted path with literal $ should be validated (not skipped as shell var)');
    console.log('  PASS testSingleQuotedPathWithDollarValidated');
  } finally {
    try { fs.unlinkSync(literalDollarPath); } catch (_error) { /* ignore */ }
    cleanState(sessionId);
  }
}

const tests = [
  testNonCodexCommandPassThrough,
  testPromptFileDomainCallAllowed,
  testRawCompanionCallsBlocked,
  testInvalidDispatchRequestBlocked,
  testReadOnlyDispatchRequestBlocked,
  testSecondCallSameDomainBlocked,
  testSecondCallDifferentDomainAllowed,
  testManualBackgroundDispatchAllowed,
  testPlanAutoBackgroundDispatchBlocked,
  testStateFileHasDomainsKey,
  testRedirectionOutputNotTreatedAsPositional,
  testRedirectionInputNotTreatedAsPositional,
  testSingleQuotedRequestFileValidated,
  testSingleQuotedPathWithDollarValidated,
];

let passed = 0;
let failed = 0;

console.log('\npre-bash-codex-guard.test.js (validator-only guard)');

for (const test of tests) {
  try {
    test();
    passed++;
  } catch (err) {
    console.error(`  FAIL ${test.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
