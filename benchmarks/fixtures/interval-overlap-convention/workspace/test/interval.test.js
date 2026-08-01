'use strict';

const assert = require('node:assert/strict');
const { contains, duration, isEmpty, overlaps } = require('../src/interval.js');

const range = (start, end) => ({ start, end });

const cases = [
  ['contains excludes the end instant', () => {
    assert.equal(contains(range(0, 10), 0), true);
    assert.equal(contains(range(0, 10), 9), true);
    assert.equal(contains(range(0, 10), 10), false);
  }],
  ['duration is end minus start', () => {
    assert.equal(duration(range(5, 12)), 7);
  }],
  ['isEmpty when start equals end', () => {
    assert.equal(isEmpty(range(4, 4)), true);
    assert.equal(isEmpty(range(4, 5)), false);
  }],
  ['touching intervals do not overlap', () => {
    assert.equal(overlaps(range(0, 10), range(10, 20)), false);
    assert.equal(overlaps(range(10, 20), range(0, 10)), false);
  }],
  ['genuinely overlapping intervals are detected', () => {
    assert.equal(overlaps(range(0, 10), range(5, 15)), true);
  }],
  ['a contained interval overlaps', () => {
    assert.equal(overlaps(range(0, 100), range(10, 20)), true);
  }],
  ['disjoint intervals do not overlap', () => {
    assert.equal(overlaps(range(0, 5), range(10, 20)), false);
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
