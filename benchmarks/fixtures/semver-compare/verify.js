'use strict';

/**
 * Hidden verifier for the `semver-compare` fixture.
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

const modulePath = path.resolve(process.cwd(), 'src/compare-versions.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/compare-versions.js is missing or is not a regular file');
  process.exit(1);
}

let compareVersions;
try {
  ({ compareVersions } = require(modulePath));
} catch (error) {
  console.error(`src/compare-versions.js failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof compareVersions !== 'function') {
  console.error('src/compare-versions.js must export a compareVersions function');
  process.exit(1);
}

function expectOrder(a, b, expected) {
  assert.equal(compareVersions(a, b), expected, `${a} vs ${b}`);
  // Antisymmetry catches implementations that special-case one argument order.
  // `-expected || 0` normalizes -0, which strict equality treats as distinct.
  assert.equal(compareVersions(b, a), -expected || 0, `${b} vs ${a} (antisymmetry)`);
}

check('contract', 'rejects non-string input', () => {
  assert.throws(() => compareVersions('1.0.0', 1), TypeError);
});

const publicCases = [
  ['equal versions', '1.2.3', '1.2.3', 0],
  ['patch ordering', '1.2.3', '1.2.4', -1],
  ['minor ordering', '1.3.0', '1.2.9', 1],
  ['multi-digit minor', '1.10.0', '1.9.0', 1],
  ['multi-digit patch', '1.0.10', '1.0.9', 1],
  ['prerelease below release', '1.0.0-alpha', '1.0.0', -1],
  ['prerelease ordering', '1.0.0-alpha', '1.0.0-beta', -1],
  ['numeric prerelease segment', '1.0.0-alpha.2', '1.0.0-alpha.10', -1],
  ['shorter prerelease ranks lower', '1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['build metadata ignored', '1.0.0+build.1', '1.0.0+build.2', 0],
];

for (const [name, a, b, expected] of publicCases) {
  check('regression', name, () => expectOrder(a, b, expected));
}

const hiddenCases = [
  ['major dominates minor', '2.0.0', '1.99.99', 1],
  ['large numeric segments', '1.0.100', '1.0.99', 1],
  ['leading-zero-free numeric prerelease', '1.0.0-1', '1.0.0-2', -1],
  ['numeric prerelease ranks below alphanumeric', '1.0.0-1', '1.0.0-alpha', -1],
  ['multi-segment prerelease', '1.0.0-alpha.beta', '1.0.0-beta', -1],
  ['prerelease with numeric then alpha', '1.0.0-rc.1', '1.0.0-rc.1.1', -1],
  ['build metadata on one side only', '1.0.0', '1.0.0+sha.abc', 0],
  ['build metadata does not mask prerelease', '1.0.0-alpha+001', '1.0.0+002', -1],
  ['prerelease compared before build metadata', '1.0.0-alpha.1+x', '1.0.0-alpha.2+y', -1],
  ['equal prereleases', '1.0.0-beta.3', '1.0.0-beta.3', 0],
  ['zero versions', '0.0.0', '0.0.1', -1],
  ['double-digit major', '10.0.0', '9.99.99', 1],
];

for (const [name, a, b, expected] of hiddenCases) {
  check('generalization', name, () => expectOrder(a, b, expected));
}

check('generalization', 'sorts a full list correctly', () => {
  const input = ['1.0.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-rc.1', '0.9.9', '1.0.1', '1.10.0', '1.9.0'];
  const expected = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.9.0', '1.10.0'];
  assert.deepEqual([...input].sort(compareVersions), expected);
});

check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/compare-versions.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
