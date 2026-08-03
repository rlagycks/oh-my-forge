'use strict';

const assert = require('node:assert/strict');
const { createLruCache } = require('../src/lru-cache.js');

const cases = [
  ['stores and reads back', () => {
    const cache = createLruCache(2);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.size, 1);
  }],
  ['evicts the oldest when over capacity', () => {
    const cache = createLruCache(2);
    cache.set('a', 1).set('b', 2).set('c', 3);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.size, 2);
  }],
  ['get refreshes recency', () => {
    const cache = createLruCache(2);
    cache.set('a', 1).set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.has('a'), true, 'a was just read and must survive');
    assert.equal(cache.has('b'), false);
  }],
  ['overwrite refreshes recency', () => {
    const cache = createLruCache(2);
    cache.set('a', 1).set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);
    assert.equal(cache.get('a'), 10);
    assert.equal(cache.has('b'), false);
  }],
  ['overwrite does not grow the cache', () => {
    const cache = createLruCache(2);
    cache.set('a', 1).set('a', 2);
    assert.equal(cache.size, 1);
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
