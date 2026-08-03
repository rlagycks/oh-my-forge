'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveAsset } = require('../src/resolve-asset.js');

const ROOT = path.resolve('/srv/assets');
const NUL = String.fromCharCode(0);

function expectForbidden(input) {
  assert.throws(() => resolveAsset(ROOT, input), error => error.message === 'forbidden path');
}

const cases = [
  ['serves a top-level file', () => {
    assert.equal(resolveAsset(ROOT, 'logo.png'), path.join(ROOT, 'logo.png'));
  }],
  ['serves a nested file', () => {
    assert.equal(resolveAsset(ROOT, 'img/icons/star.svg'), path.join(ROOT, 'img/icons/star.svg'));
  }],
  ['strips a leading slash', () => {
    assert.equal(resolveAsset(ROOT, '/logo.png'), path.join(ROOT, 'logo.png'));
  }],
  ['rejects parent traversal', () => expectForbidden('../../etc/passwd')],
  ['rejects nested traversal', () => expectForbidden('img/../../../etc/passwd')],
  ['rejects a sibling dir sharing the root prefix', () => expectForbidden('../assets-evil')],
  ['rejects a NUL byte', () => expectForbidden(`logo.png${NUL}.txt`)],
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
