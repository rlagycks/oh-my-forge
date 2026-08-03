'use strict';

const assert = require('assert');

const { MEMBERS_PER_PAIR, createPairBudgetGuard } = require('../../benchmarks/lib/pair-budget');

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

const PER_EPISODE = 1;

console.log('pair-budget');

test('rejects a non-positive per-episode budget', () => {
  assert.throws(() => createPairBudgetGuard(0), TypeError);
  assert.throws(() => createPairBudgetGuard(-1), TypeError);
  assert.throws(() => createPairBudgetGuard('1'), TypeError);
});

test('a cap that funds exactly one episode but not two refuses the pair up front', () => {
  // The regression the review asked for: previously the first member ran, the
  // second was refused, and with --require-comparable that aborted the whole
  // run AFTER paying for one side.
  const guard = createPairBudgetGuard(PER_EPISODE);
  const first = guard.reserve({ taskId: 't', repetition: 1, remainingCostUsd: 1.5 });

  assert.strictEqual(first.ok, false, 'the pair must be refused before the first member runs');
  assert.strictEqual(first.required, PER_EPISODE * MEMBERS_PER_PAIR);
  assert.match(first.reason, /cannot fund both members/);
  assert.strictEqual(guard.isFirstMember('t', 1), true, 'a refused pair must not be marked started');
});

test('a cap that funds two episodes admits both members', () => {
  const guard = createPairBudgetGuard(PER_EPISODE);
  const first = guard.reserve({ taskId: 't', repetition: 1, remainingCostUsd: 2 });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.budget, PER_EPISODE);

  // The runner has now spent on the first member, so less remains — but the
  // reservation already covered this one.
  const second = guard.reserve({ taskId: 't', repetition: 1, remainingCostUsd: 1.05 });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.budget, PER_EPISODE, 'both members must get the same budget');
  assert.strictEqual(second.required, PER_EPISODE, 'the second member is already funded');
});

test('both members always receive an identical budget', () => {
  const guard = createPairBudgetGuard(2.5);
  const first = guard.reserve({ taskId: 't', repetition: 1, remainingCostUsd: 100 });
  const second = guard.reserve({ taskId: 't', repetition: 1, remainingCostUsd: 97.5 });
  assert.strictEqual(first.budget, second.budget);
});

test('pairs are tracked per task and repetition', () => {
  const guard = createPairBudgetGuard(PER_EPISODE);
  guard.reserve({ taskId: 'a', repetition: 1, remainingCostUsd: 10 });

  assert.strictEqual(guard.isFirstMember('a', 1), false);
  assert.strictEqual(guard.isFirstMember('a', 2), true, 'a different repetition is a different pair');
  assert.strictEqual(guard.isFirstMember('b', 1), true, 'a different task is a different pair');

  // A fresh pair still needs the full two-member reservation.
  const other = guard.reserve({ taskId: 'a', repetition: 2, remainingCostUsd: 1.5 });
  assert.strictEqual(other.ok, false);
});

test('an unlimited run budget always admits the pair', () => {
  const guard = createPairBudgetGuard(PER_EPISODE);
  for (const remainingCostUsd of [null, undefined, Number.NaN, Infinity]) {
    const fresh = createPairBudgetGuard(PER_EPISODE);
    assert.strictEqual(fresh.reserve({ taskId: 't', repetition: 1, remainingCostUsd }).ok, true);
  }
  assert.strictEqual(guard.reserve({ taskId: 't', repetition: 9, remainingCostUsd: null }).ok, true);
});

test('a run that funds N pairs refuses the N+1th before spending on it', () => {
  const guard = createPairBudgetGuard(PER_EPISODE);
  let remaining = 4; // exactly two pairs

  for (const repetition of [1, 2]) {
    assert.strictEqual(guard.reserve({ taskId: 't', repetition, remainingCostUsd: remaining }).ok, true);
    remaining -= PER_EPISODE;
    assert.strictEqual(guard.reserve({ taskId: 't', repetition, remainingCostUsd: remaining }).ok, true);
    remaining -= PER_EPISODE;
  }

  assert.strictEqual(remaining, 0);
  const third = guard.reserve({ taskId: 't', repetition: 3, remainingCostUsd: remaining });
  assert.strictEqual(third.ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
