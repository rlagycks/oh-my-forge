'use strict';

const assert = require('node:assert/strict');
const { allocate, roundCents, taxFor, totalFor } = require('../src/money.js');

const cases = [
  ['roundCents rounds half to even', () => {
    assert.equal(roundCents(2.5), 2);
    assert.equal(roundCents(3.5), 4);
    assert.equal(roundCents(2.4), 2);
    assert.equal(roundCents(2.6), 3);
  }],
  ['taxFor uses the module convention', () => {
    assert.equal(taxFor(50, 0.05), 2);
  }],
  ['totalFor agrees with the tax convention', () => {
    // 50 cents at 5% is 2.5 cents, which rounds half-to-even down to 2.
    assert.equal(totalFor([50], 0.05), 52);
  }],
  ['allocate sums exactly to the input', () => {
    const parts = allocate(100, [1, 1, 1]);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), 100);
  }],
  ['allocate handles uneven weights', () => {
    const parts = allocate(101, [1, 1]);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), 101);
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
