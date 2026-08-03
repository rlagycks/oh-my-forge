'use strict';

const assert = require('node:assert/strict');
const { deepMerge } = require('../src/deep-merge.js');

const cases = [
  ['merges flat keys', () => {
    assert.deepEqual(deepMerge({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  }],
  ['merges nested objects', () => {
    assert.deepEqual(deepMerge({ a: { x: 1 } }, { a: { y: 2 } }), { a: { x: 1, y: 2 } });
  }],
  ['source replaces arrays', () => {
    assert.deepEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
  }],
  ['undefined does not overwrite', () => {
    assert.deepEqual(deepMerge({ a: 1 }, { a: undefined }), { a: 1 });
  }],
  ['does not mutate its inputs', () => {
    const target = { a: { x: 1 } };
    deepMerge(target, { a: { y: 2 } });
    assert.deepEqual(target, { a: { x: 1 } }, 'target must not be mutated');
  }],
  ['blocks __proto__ pollution', () => {
    deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}}'));
    assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
  }],
  ['blocks constructor pollution', () => {
    deepMerge({}, JSON.parse('{"constructor": {"prototype": {"polluted2": true}}}'));
    assert.equal({}.polluted2, undefined, 'Object.prototype was polluted');
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
