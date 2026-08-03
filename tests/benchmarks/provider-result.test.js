'use strict';

const assert = require('assert');
const { classifyProviderResult } = require('../../benchmarks/lib/provider-result');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

const healthy = {
  is_error: false,
  terminal_reason: 'completed',
  usage: { input_tokens: 2, cache_read_input_tokens: 90000, cache_creation_input_tokens: 1000, output_tokens: 800 },
};

console.log('provider-result');

test('accepts a real episode', () => {
  assert.deepStrictEqual(classifyProviderResult(healthy), { ok: true, reason: null });
});

test('rejects the exact shape that destroyed the first pilot', () => {
  // is_error true, api_error, zero tokens, exits 0 with valid JSON.
  const outage = {
    is_error: true,
    terminal_reason: 'api_error',
    usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 },
  };
  const result = classifyProviderResult(outage);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /is_error/);
});

test('rejects a stop that did no work even when is_error is false', () => {
  for (const reason of ['api_error', 'budget_exhausted', 'refusal', 'max_turns']) {
    const result = classifyProviderResult({ ...healthy, is_error: false, terminal_reason: reason });
    assert.strictEqual(result.ok, false, `${reason} must be rejected`);
  }
});

test('rejects zero context even if the payload otherwise looks fine', () => {
  const result = classifyProviderResult({
    ...healthy,
    usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 500 },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /zero context/);
});

test('rejects zero output', () => {
  const result = classifyProviderResult({ ...healthy, usage: { ...healthy.usage, output_tokens: 0 } });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /zero output/);
});

test('rejects a missing or non-object payload', () => {
  assert.strictEqual(classifyProviderResult(null).ok, false);
  assert.strictEqual(classifyProviderResult(undefined).ok, false);
  assert.strictEqual(classifyProviderResult('nope').ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
