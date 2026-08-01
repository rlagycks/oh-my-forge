'use strict';

const assert = require('node:assert/strict');
const { computeDelay } = require('../src/backoff.js');
const { retry } = require('../src/retry.js');

/** Deterministic deps: fixed random, recorded sleeps, clock advanced by sleeps. */
function createDeps({ random = () => 1, startAt = 0 } = {}) {
  const slept = [];
  let clock = startAt;
  return {
    slept,
    now: () => clock,
    random,
    sleep: async ms => { slept.push(ms); clock += ms; },
  };
}

const cases = [
  ['delay grows exponentially', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 10000, random: () => 1 };
    assert.equal(computeDelay(0, options), 100);
    assert.equal(computeDelay(1, options), 200);
    assert.equal(computeDelay(2, options), 400);
  }],
  ['delay is capped', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 250, random: () => 1 };
    assert.equal(computeDelay(5, options), 250);
  }],
  ['jitter halves the delay at random() === 0', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 10000, random: () => 0 };
    assert.equal(computeDelay(1, options), 100);
  }],
  ['makes at most maxAttempts attempts', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('nope'); }, { maxAttempts: 3 }, deps),
      /nope/
    );
    assert.equal(calls, 3);
    assert.equal(deps.slept.length, 2, 'no sleep after the final attempt');
  }],
  ['does not retry a non-retryable error', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(
        async () => { calls += 1; throw new Error('fatal'); },
        { maxAttempts: 5, isRetryable: () => false },
        deps
      ),
      /fatal/
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.slept, []);
  }],
  ['stops when the elapsed budget would be exceeded', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(
        async () => { calls += 1; throw new Error('slow'); },
        { maxAttempts: 10, baseDelayMs: 100, maxElapsedMs: 250 },
        deps
      ),
      /slow/
    );
    assert.ok(calls < 10, `expected an early stop, got ${calls} attempts`);
  }],
  ['returns the resolved value', async () => {
    const deps = createDeps();
    const value = await retry(async () => 'ok', {}, deps);
    assert.equal(value, 'ok');
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
