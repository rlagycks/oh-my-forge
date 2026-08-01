'use strict';

const assert = require('node:assert/strict');
const { compareVersions } = require('../src/compare-versions.js');

const cases = [
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

let failed = 0;
for (const [name, a, b, expected] of cases) {
  try {
    assert.equal(compareVersions(a, b), expected);
    assert.equal(compareVersions(b, a), -expected || 0, 'comparison must be antisymmetric');
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
