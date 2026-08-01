'use strict';

/**
 * Hidden verifier for the `retry-backoff-policy` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
 *
 * Determinism comes from injected now/random/sleep, never from wall-clock time.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const failures = [];

async function check(group, name, fn) {
  try {
    await fn();
  } catch (error) {
    failures.push(`[${group}] ${name}: ${error.message.split('\n')[0]}`);
  }
}

function loadModule(relative, name) {
  const modulePath = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    console.error(`${relative} is missing or is not a regular file`);
    process.exit(1);
  }
  try {
    const exported = require(modulePath)[name];
    if (typeof exported !== 'function') {
      console.error(`${relative} must export a ${name} function`);
      process.exit(1);
    }
    return exported;
  } catch (error) {
    console.error(`${relative} failed to load: ${error.message}`);
    process.exit(1);
  }
}

const computeDelay = loadModule('src/backoff.js', 'computeDelay');
const retry = loadModule('src/retry.js', 'retry');

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

const failing = message => async () => { throw new Error(message); };

(async () => {
  // --- Contract -----------------------------------------------------------
  await check('contract', 'computeDelay rejects a negative attempt', () => {
    assert.throws(() => computeDelay(-1, { baseDelayMs: 1, maxDelayMs: 2, random: () => 1 }), TypeError);
    assert.throws(() => computeDelay(1.5, { baseDelayMs: 1, maxDelayMs: 2, random: () => 1 }), TypeError);
  });

  // --- Regression: the shipped public cases -------------------------------
  await check('regression', 'delay grows exponentially', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 10000, random: () => 1 };
    assert.equal(computeDelay(0, options), 100);
    assert.equal(computeDelay(1, options), 200);
    assert.equal(computeDelay(2, options), 400);
  });

  await check('regression', 'delay is capped', () => {
    assert.equal(computeDelay(5, { baseDelayMs: 100, maxDelayMs: 250, random: () => 1 }), 250);
  });

  await check('regression', 'jitter halves the delay at random() === 0', () => {
    assert.equal(computeDelay(1, { baseDelayMs: 100, maxDelayMs: 10000, random: () => 0 }), 100);
  });

  await check('regression', 'makes at most maxAttempts attempts', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('nope'); }, { maxAttempts: 3 }, deps),
      /nope/
    );
    assert.equal(calls, 3);
    assert.equal(deps.slept.length, 2);
  });

  await check('regression', 'does not retry a non-retryable error', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('fatal'); }, { maxAttempts: 5, isRetryable: () => false }, deps),
      /fatal/
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.slept, []);
  });

  await check('regression', 'stops when the elapsed budget would be exceeded', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('slow'); }, { maxAttempts: 10, baseDelayMs: 100, maxElapsedMs: 250 }, deps),
      /slow/
    );
    assert.ok(calls < 10, `expected an early stop, got ${calls}`);
  });

  await check('regression', 'returns the resolved value', async () => {
    assert.equal(await retry(async () => 'ok', {}, createDeps()), 'ok');
  });

  // --- Generalization -----------------------------------------------------
  await check('generalization', 'exponential curve continues past attempt 2', () => {
    const options = { baseDelayMs: 50, maxDelayMs: 100000, random: () => 1 };
    assert.deepEqual(
      [3, 4, 5].map(attempt => computeDelay(attempt, options)),
      [400, 800, 1600]
    );
  });

  await check('generalization', 'jitter multiplier is applied after the cap', () => {
    // Cap 250, jitter 0.5 -> floor(250 * 0.5) = 125. Jittering before the cap
    // would return 250 here.
    assert.equal(computeDelay(9, { baseDelayMs: 100, maxDelayMs: 250, random: () => 0 }), 125);
  });

  await check('generalization', 'delay is floored to an integer', () => {
    const delay = computeDelay(0, { baseDelayMs: 101, maxDelayMs: 10000, random: () => 0.5 });
    assert.ok(Number.isInteger(delay), `expected an integer, got ${delay}`);
    assert.equal(delay, Math.floor(101 * 0.75));
  });

  await check('generalization', 'jitter never drops below half the capped delay', () => {
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      const delay = computeDelay(2, { baseDelayMs: 100, maxDelayMs: 10000, random: () => value });
      assert.ok(delay >= 200 && delay <= 400, `attempt 2 jitter out of range: ${delay}`);
    }
  });

  await check('generalization', 'maxAttempts of 1 makes no retry', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('once'); }, { maxAttempts: 1 }, deps),
      /once/
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.slept, []);
  });

  await check('generalization', 'succeeds on a later attempt and stops', async () => {
    const deps = createDeps();
    let calls = 0;
    const value = await retry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return `ok-${calls}`;
    }, { maxAttempts: 5 }, deps);
    assert.equal(value, 'ok-3');
    assert.equal(calls, 3);
    assert.equal(deps.slept.length, 2);
  });

  await check('generalization', 'sleeps use the exponential schedule', async () => {
    const deps = createDeps({ random: () => 1 });
    await assert.rejects(
      retry(failing('x'), { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 10000, maxElapsedMs: 1000000 }, deps),
      /x/
    );
    assert.deepEqual(deps.slept, [10, 20, 40]);
  });

  await check('generalization', 'isRetryable receives the thrown error', async () => {
    const deps = createDeps();
    const seen = [];
    await assert.rejects(
      retry(failing('inspect-me'), { maxAttempts: 2, isRetryable: error => { seen.push(error.message); return true; } }, deps),
      /inspect-me/
    );
    assert.deepEqual(seen, ['inspect-me', 'inspect-me']);
  });

  await check('generalization', 'a non-retryable error surfaces on a later attempt too', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => {
        calls += 1;
        throw new Error(calls < 2 ? 'transient' : 'fatal');
      }, { maxAttempts: 9, isRetryable: error => error.message === 'transient' }, deps),
      /fatal/
    );
    assert.equal(calls, 2);
    assert.equal(deps.slept.length, 1);
  });

  await check('generalization', 'the elapsed budget accounts for the clock start', async () => {
    const deps = createDeps({ startAt: 5000 });
    await assert.rejects(
      retry(failing('budget'), { maxAttempts: 10, baseDelayMs: 100, maxElapsedMs: 250 }, deps),
      /budget/
    );
    // Budget is measured from the first attempt, not from epoch.
    assert.ok(deps.slept.length >= 1, 'a non-zero budget must allow at least one sleep');
  });

  await check('generalization', 'a zero elapsed budget prevents any sleep', async () => {
    const deps = createDeps();
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls += 1; throw new Error('nobudget'); }, { maxAttempts: 5, maxElapsedMs: 0 }, deps),
      /nobudget/
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.slept, []);
  });

  await check('generalization', 'the operation receives the attempt index', async () => {
    const deps = createDeps();
    const seen = [];
    await assert.rejects(
      retry(async attempt => { seen.push(attempt); throw new Error('idx'); }, { maxAttempts: 3 }, deps),
      /idx/
    );
    assert.deepEqual(seen, [0, 1, 2]);
  });

  // --- Scope --------------------------------------------------------------
  await check('scope', 'backoff module still present', () => {
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'src/backoff.js')), 'src/backoff.js was removed');
  });

  await check('scope', 'test directory still present', () => {
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
  });

  await check('scope', 'package.json still declares the test script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.scripts?.test, 'node test/retry.test.js');
  });

  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log('all checks passed');
  process.exit(0);
})();
