/**
 * Tests for pre-bash-codex-guard.js — domain-keyed invocation counter
 *
 * Run with: node tests/hooks/pre-bash-codex-guard.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const hookPath = path.resolve(__dirname, '../../scripts/hooks/pre-bash-codex-guard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(command) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
  });
}

function fakeCompanionCmd(domainId) {
  const domainFlag = domainId ? `--domain-id ${domainId}` : '';
  return `node "/some/path/codex-companion.mjs" task ${domainFlag} --prompt-file /tmp/brief.txt`;
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
  try { fs.unlinkSync(getStatePathForSession(sessionId)); } catch {}
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

function testFirstDomainCallAllowed() {
  const sessionId = 'test-first-domain-' + Date.now();
  cleanState(sessionId);

  const cmd = fakeCompanionCmd('domain_hooks');
  const result = runWithSession(sessionId, cmd);
  // Should not return exitCode:2 (i.e. result is a string, not an object with exitCode)
  assert.ok(typeof result === 'string', 'First domain call should be allowed (string result)');
  console.log('  PASS testFirstDomainCallAllowed');
  cleanState(sessionId);
}

function testSecondCallSameDomainBlocked() {
  const sessionId = 'test-second-same-domain-' + Date.now();
  cleanState(sessionId);

  const cmd = fakeCompanionCmd('domain_codex');

  // First call — should pass
  runWithSession(sessionId, cmd);

  // Second call for same domain — should be blocked
  const result = runWithSession(sessionId, cmd);
  assert.deepStrictEqual(result, { exitCode: 2 },
    'Second call for same domain should return { exitCode: 2 }');
  console.log('  PASS testSecondCallSameDomainBlocked');
  cleanState(sessionId);
}

function testSecondCallDifferentDomainAllowed() {
  const sessionId = 'test-second-diff-domain-' + Date.now();
  cleanState(sessionId);

  const cmd1 = fakeCompanionCmd('domain_hooks');
  const cmd2 = fakeCompanionCmd('domain_session');

  // Call domain_hooks first
  runWithSession(sessionId, cmd1);

  // Then call domain_session — should be allowed (different domain)
  const result = runWithSession(sessionId, cmd2);
  assert.ok(typeof result === 'string',
    'Second call for a different domain should be allowed');
  console.log('  PASS testSecondCallDifferentDomainAllowed');
  cleanState(sessionId);
}

function testDefaultDomainUsedWhenNoDomainId() {
  const sessionId = 'test-default-domain-' + Date.now();
  cleanState(sessionId);

  // Command without --domain-id → uses '_default'
  const cmdNoId = `node "/path/codex-companion.mjs" task --prompt-file /tmp/brief.txt`;

  runWithSession(sessionId, cmdNoId);

  // Second call with no domain-id — same '_default' bucket, should block
  const result = runWithSession(sessionId, cmdNoId);
  assert.deepStrictEqual(result, { exitCode: 2 },
    'No domain-id: second call should be blocked via _default bucket');
  console.log('  PASS testDefaultDomainUsedWhenNoDomainId');
  cleanState(sessionId);
}

function testStateFileHasDomainsKey() {
  const sessionId = 'test-state-shape-' + Date.now();
  cleanState(sessionId);

  runWithSession(sessionId, fakeCompanionCmd('domain_qa'));

  const statePath = getStatePathForSession(sessionId);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(state.domains, 'State file should have a "domains" key');
  assert.strictEqual(state.domains['domain_qa'], 1, 'domains.domain_qa should equal 1');
  assert.ok(!('invocations' in state), 'Old "invocations" key should not exist');
  console.log('  PASS testStateFileHasDomainsKey');
  cleanState(sessionId);
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

const tests = [
  testNonCodexCommandPassThrough,
  testFirstDomainCallAllowed,
  testSecondCallSameDomainBlocked,
  testSecondCallDifferentDomainAllowed,
  testDefaultDomainUsedWhenNoDomainId,
  testStateFileHasDomainsKey,
];

let passed = 0;
let failed = 0;

console.log('\npre-bash-codex-guard.test.js (domain-keyed counter)');

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
