'use strict';

const assert = require('node:assert/strict');
const { parseDuration } = require('../src/duration.js');

const cases = [
  ['hours', 'PT2H', 7200],
  ['minutes and seconds', 'PT1M30S', 90],
  ['days', 'P1D', 86400],
  ['weeks', 'P2W', 1209600],
  ['months before T', 'P1M', 2592000],
  ['minutes after T', 'PT1M', 60],
  ['years', 'P1Y', 31536000],
  ['combined date and time', 'P1DT2H3M4S', 93784],
  ['negative duration', '-PT1H', -3600],
  ['fractional seconds with a dot', 'PT1.5S', 1.5],
  ['fractional seconds with a comma', 'PT1,5S', 1.5],
];

const invalid = ['', 'P', 'PT', 'nope', '1H', 'PTS', 'P1H'];

let failed = 0;
for (const [name, input, expected] of cases) {
  try {
    assert.equal(parseDuration(input), expected);
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

for (const input of invalid) {
  try {
    assert.throws(() => parseDuration(input), error => error.message === 'invalid duration');
    console.log(`ok   rejects ${JSON.stringify(input)}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL rejects ${JSON.stringify(input)}: ${error.message.split('\n')[0]}`);
  }
}

const total = cases.length + invalid.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
