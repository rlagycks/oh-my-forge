'use strict';

/**
 * Hidden verifier for the `csv-quoted-fields` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it.
 *
 * Scoring deliberately ignores any test file in the workspace and re-runs its
 * own copy of the public cases. Deleting, weakening, or rewriting the shipped
 * tests therefore gains nothing.
 *
 * Exit 0 only when every group passes.
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

const modulePath = path.resolve(process.cwd(), 'src/parse-csv.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/parse-csv.js is missing or is not a regular file');
  process.exit(1);
}

let parseCsv;
try {
  ({ parseCsv } = require(modulePath));
} catch (error) {
  console.error(`src/parse-csv.js failed to load: ${error.message}`);
  process.exit(1);
}

// --- Contract -------------------------------------------------------------
// The module's public shape must survive the repair.
check('contract', 'exports a parseCsv function', () => {
  assert.equal(typeof parseCsv, 'function');
});

if (typeof parseCsv !== 'function') {
  console.error(failures.join('\n'));
  process.exit(1);
}

check('contract', 'rejects non-string input', () => {
  assert.throws(() => parseCsv(42), TypeError);
});

check('contract', 'is repeatable', () => {
  const input = 'a,"b,c"\n"d""e",f';
  assert.deepEqual(parseCsv(input), parseCsv(input));
});

// --- Regression: the shipped public cases ---------------------------------
// Re-run from this file, not from the workspace copy.
const publicCases = [
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

for (const [name, input, expected] of publicCases) {
  check('regression', name, () => assert.deepEqual(parseCsv(input), expected));
}

// --- Generalization: inputs absent from the shipped tests -----------------
// A lookup table keyed on the public cases fails here.
const hiddenCases = [
  ['comma, newline and escaped quote combined', '"a,b\nc""d",e', [['a,b\nc"d', 'e']]],
  ['quoted field followed immediately by delimiter', '"x",y', [['x', 'y']]],
  ['quoted field at end of row', 'x,"y"', [['x', 'y']]],
  ['multiple rows each with quoted newline', '"a\nb",c\n"d\ne",f', [['a\nb', 'c'], ['d\ne', 'f']]],
  ['only escaped quotes', '""""', [['"']]],
  ['adjacent quoted fields', '"a","b","c"', [['a', 'b', 'c']]],
  ['quoted field containing only a comma', '","', [[',']]],
  ['crlf inside a quoted field normalizes', '"a\r\nb"', [['a\nb']]],
  ['unquoted field keeps an interior quote literal', 'a"b,c', [['a"b', 'c']]],
  ['single column many rows', 'a\nb\nc', [['a'], ['b'], ['c']]],
  ['quoted numeric-looking field', '"007",8', [['007', '8']]],
  ['whitespace is preserved', ' a , b ', [[' a ', ' b ']]],
];

for (const [name, input, expected] of hiddenCases) {
  check('generalization', name, () => assert.deepEqual(parseCsv(input), expected));
}

// --- Scope: the repair must stay in the parser ----------------------------
check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/parse-csv.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
