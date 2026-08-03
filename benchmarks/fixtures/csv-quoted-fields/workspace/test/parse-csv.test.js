'use strict';

const assert = require('node:assert/strict');
const { parseCsv } = require('../src/parse-csv.js');

const cases = [
  ['empty input', '', []],
  ['single row', 'a,b,c', [['a', 'b', 'c']]],
  ['two rows', 'a,b\nc,d', [['a', 'b'], ['c', 'd']]],
  ['trailing newline', 'a,b\n', [['a', 'b']]],
  ['crlf line endings', 'a,b\r\nc,d', [['a', 'b'], ['c', 'd']]],
  ['empty fields', 'a,,c', [['a', '', 'c']]],
  ['quoted field with comma', 'a,"b,c",d', [['a', 'b,c', 'd']]],
  ['quoted field with newline', 'a,"b\nc"', [['a', 'b\nc']]],
  ['escaped quote', '"say ""hi"""', [['say "hi"']]],
  ['quoted empty field', 'a,"",c', [['a', '', 'c']]],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  try {
    assert.deepEqual(parseCsv(input), expected);
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
