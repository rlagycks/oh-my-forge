'use strict';

/**
 * Hidden verifier for the `iso-duration-parse` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
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

const modulePath = path.resolve(process.cwd(), 'src/duration.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/duration.js is missing or is not a regular file');
  process.exit(1);
}

let parseDuration;
try {
  ({ parseDuration } = require(modulePath));
} catch (error) {
  console.error(`src/duration.js failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof parseDuration !== 'function') {
  console.error('src/duration.js must export a parseDuration function');
  process.exit(1);
}

const expectValue = (input, expected) => assert.equal(parseDuration(input), expected, input);
const expectInvalid = input => assert.throws(
  () => parseDuration(input),
  error => error instanceof Error && error.message === 'invalid duration',
  `${JSON.stringify(input)} should be invalid`
);

// --- Contract -------------------------------------------------------------
check('contract', 'rejects non-string input', () => {
  assert.throws(() => parseDuration(60), TypeError);
  assert.throws(() => parseDuration(null), TypeError);
});

// --- Regression: the shipped public cases ---------------------------------
for (const [name, input, expected] of [
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
]) {
  check('regression', name, () => expectValue(input, expected));
}

for (const input of ['', 'P', 'PT', 'nope', '1H', 'PTS', 'P1H']) {
  check('regression', `rejects ${JSON.stringify(input)}`, () => expectInvalid(input));
}

// --- The M ambiguity ------------------------------------------------------
check('designator', 'M before and after T in one string', () => {
  // 1 month + 1 minute
  expectValue('P1MT1M', 2592000 + 60);
});

check('designator', 'months and minutes scale independently', () => {
  expectValue('P2MT30M', 2 * 2592000 + 1800);
});

check('designator', 'a date-only M is never minutes', () => {
  expectValue('P3M', 3 * 2592000);
});

// --- Generalization -------------------------------------------------------
for (const [name, input, expected] of [
  ['every component at once', 'P1Y2M3W4DT5H6M7S', 31536000 + 2 * 2592000 + 3 * 604800 + 4 * 86400 + 5 * 3600 + 6 * 60 + 7],
  ['zero components', 'P0D', 0],
  ['zero time', 'PT0S', 0],
  ['weeks combined with days', 'P1W1D', 604800 + 86400],
  ['years and days without time', 'P1Y1D', 31536000 + 86400],
  ['hours and seconds without minutes', 'PT1H30S', 3630],
  ['large values', 'PT100H', 360000],
  ['multi-digit components', 'P12DT36H', 12 * 86400 + 36 * 3600],
  ['negative combined duration', '-P1DT1H', -(86400 + 3600)],
  ['negative zero stays zero', '-PT0S', 0],
  ['fractional seconds round to three places', 'PT0.0005S', 0.001],
  ['fractional seconds truncate beyond three places', 'PT1.23456S', 1.235],
  ['fractional seconds with a comma and a whole part', 'PT10,25S', 10.25],
  ['fraction combined with other components', 'PT1M0.5S', 60.5],
]) {
  check('generalization', name, () => expectValue(input, expected));
}

for (const input of [
  'PT1S1H',
  'P1D1Y',
  '1PT1H',
  'PT1H ',
  ' PT1H',
  'P1YT',
  'PT.5S',
  'P-1D',
  'PT1H30',
  'pt1h',
  '--PT1H',
  'P1S',
]) {
  check('generalization', `rejects ${JSON.stringify(input)}`, () => expectInvalid(input));
}

check('generalization', 'a T separator with no time components is invalid', () => {
  expectInvalid('P1DT');
});

// --- Scope ----------------------------------------------------------------
check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/duration.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
