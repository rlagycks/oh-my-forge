'use strict';

/**
 * Hidden verifier for the `interval-overlap-convention` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
 *
 * The convention under test (half-open [start, end)) is stated only by the
 * module's sibling helpers, so this is a brownfield task.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const failures = [];

function check(group, name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`[${group}] ${name}: ${error.message.split('\n')[0]}`);
  }
}

const modulePath = path.resolve(process.cwd(), 'src/interval.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/interval.js is missing or is not a regular file');
  process.exit(1);
}

let contains;
let duration;
let isEmpty;
let overlaps;
try {
  ({ contains, duration, isEmpty, overlaps } = require(modulePath));
} catch (error) {
  console.error(`src/interval.js failed to load: ${error.message}`);
  process.exit(1);
}

for (const [name, fn] of [['contains', contains], ['duration', duration], ['isEmpty', isEmpty], ['overlaps', overlaps]]) {
  if (typeof fn !== 'function') {
    console.error(`src/interval.js must export a ${name} function`);
    process.exit(1);
  }
}

const range = (start, end) => ({ start, end });

function expectOverlap(a, b, expected) {
  assert.strictEqual(overlaps(a, b), expected, `${a.start}-${a.end} vs ${b.start}-${b.end}`);
  // Overlap is symmetric; an asymmetric result means a boundary was mishandled.
  assert.strictEqual(overlaps(b, a), expected, `${b.start}-${b.end} vs ${a.start}-${a.end} (symmetry)`);
}

// --- Contract -------------------------------------------------------------
check('contract', 'rejects malformed intervals', () => {
  assert.throws(() => overlaps(null, range(0, 1)), TypeError);
  assert.throws(() => overlaps(range(0, 1), { start: 'a', end: 1 }), TypeError);
  assert.throws(() => overlaps(range(5, 1), range(0, 1)), RangeError);
});

check('contract', 'returns a boolean', () => {
  assert.strictEqual(typeof overlaps(range(0, 1), range(0, 1)), 'boolean');
});

// --- Sibling helpers must not regress ------------------------------------
check('siblings', 'contains excludes the end instant', () => {
  assert.equal(contains(range(0, 10), 0), true);
  assert.equal(contains(range(0, 10), 9), true);
  assert.equal(contains(range(0, 10), 10), false);
  assert.equal(contains(range(0, 10), -1), false);
});

check('siblings', 'duration is end minus start', () => {
  assert.equal(duration(range(5, 12)), 7);
  assert.equal(duration(range(4, 4)), 0);
});

check('siblings', 'isEmpty when start equals end', () => {
  assert.equal(isEmpty(range(4, 4)), true);
  assert.equal(isEmpty(range(4, 5)), false);
});

// --- Convention -----------------------------------------------------------
check('convention', 'touching intervals do not overlap', () => {
  expectOverlap(range(0, 10), range(10, 20), false);
});

check('convention', 'a one-unit gap does not overlap', () => {
  expectOverlap(range(0, 10), range(11, 20), false);
});

check('convention', 'a one-unit intersection does overlap', () => {
  expectOverlap(range(0, 10), range(9, 20), true);
});

check('convention', 'overlap is consistent with contains', () => {
  // If either interval contains the other's start instant, they overlap.
  for (const [a, b] of [
    [range(0, 10), range(5, 15)],
    [range(0, 10), range(10, 15)],
    [range(0, 10), range(-5, 0)],
    [range(0, 10), range(-5, 1)],
  ]) {
    const expected = contains(a, b.start) || contains(b, a.start);
    expectOverlap(a, b, expected);
  }
});

// --- Generalization -------------------------------------------------------
check('generalization', 'identical intervals overlap', () => {
  expectOverlap(range(3, 8), range(3, 8), true);
});

check('generalization', 'a fully contained interval overlaps', () => {
  expectOverlap(range(0, 100), range(10, 20), true);
});

check('generalization', 'disjoint intervals do not overlap', () => {
  expectOverlap(range(0, 5), range(10, 20), false);
});

check('generalization', 'shared start instant overlaps', () => {
  expectOverlap(range(0, 10), range(0, 3), true);
});

check('generalization', 'shared end instant overlaps', () => {
  expectOverlap(range(0, 10), range(7, 10), true);
});

check('generalization', 'an empty interval never overlaps', () => {
  // An empty interval covers no instants, so it cannot share one.
  expectOverlap(range(5, 5), range(0, 10), false);
  expectOverlap(range(5, 5), range(5, 10), false);
  expectOverlap(range(5, 5), range(0, 5), false);
  expectOverlap(range(5, 5), range(5, 5), false);
});

check('generalization', 'negative and fractional bounds behave the same way', () => {
  expectOverlap(range(-10, -5), range(-5, 0), false);
  expectOverlap(range(-10, -4), range(-5, 0), true);
  expectOverlap(range(0.5, 1.5), range(1.5, 2.5), false);
  expectOverlap(range(0.5, 1.6), range(1.5, 2.5), true);
});

check('generalization', 'a back-to-back schedule has no conflicts', () => {
  const slots = [range(0, 10), range(10, 20), range(20, 30), range(30, 40)];
  const conflicts = slots.flatMap((a, index) => slots.slice(index + 1).filter(b => overlaps(a, b)));
  assert.deepEqual(conflicts, [], 'adjacent bookings must not conflict');
});

// --- Scope ----------------------------------------------------------------
check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/interval.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
