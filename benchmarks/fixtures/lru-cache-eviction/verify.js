'use strict';

/**
 * Hidden verifier for the `lru-cache-eviction` fixture.
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

const modulePath = path.resolve(process.cwd(), 'src/lru-cache.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/lru-cache.js is missing or is not a regular file');
  process.exit(1);
}

let createLruCache;
try {
  ({ createLruCache } = require(modulePath));
} catch (error) {
  console.error(`src/lru-cache.js failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof createLruCache !== 'function') {
  console.error('src/lru-cache.js must export a createLruCache function');
  process.exit(1);
}

// --- Contract -------------------------------------------------------------
check('contract', 'rejects an invalid capacity', () => {
  assert.throws(() => createLruCache(0), TypeError);
  assert.throws(() => createLruCache(1.5), TypeError);
  assert.throws(() => createLruCache('2'), TypeError);
});

check('contract', 'get returns undefined for a missing key', () => {
  assert.equal(createLruCache(2).get('nope'), undefined);
});

check('contract', 'has returns a boolean', () => {
  const cache = createLruCache(2).set('a', 1);
  assert.strictEqual(cache.has('a'), true);
  assert.strictEqual(cache.has('b'), false);
});

check('contract', 'set remains chainable', () => {
  const cache = createLruCache(2);
  assert.strictEqual(cache.set('a', 1), cache);
});

// --- Regression: the shipped public cases ---------------------------------
check('regression', 'stores and reads back', () => {
  const cache = createLruCache(2);
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.size, 1);
});

check('regression', 'evicts the oldest when over capacity', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.size, 2);
});

check('regression', 'get refreshes recency', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
});

check('regression', 'overwrite refreshes recency', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('b', 2);
  cache.set('a', 10);
  cache.set('c', 3);
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.has('b'), false);
});

check('regression', 'overwrite does not grow the cache', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('a', 2);
  assert.equal(cache.size, 1);
});

// --- Generalization -------------------------------------------------------
check('generalization', 'a missing-key get does not disturb recency', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('b', 2);
  cache.get('zzz');
  cache.set('c', 3);
  // 'a' is still the least recently used; a failed lookup must change nothing.
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
});

check('generalization', 'has() does not count as a use', () => {
  const cache = createLruCache(2);
  cache.set('a', 1).set('b', 2);
  cache.has('a');
  cache.set('c', 3);
  assert.equal(cache.has('a'), false, 'has() must not refresh recency');
});

check('generalization', 'capacity of one always keeps the newest', () => {
  const cache = createLruCache(1);
  cache.set('a', 1).set('b', 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.has('a'), false);
});

check('generalization', 'interleaved access over a longer run', () => {
  const cache = createLruCache(3);
  cache.set('a', 1).set('b', 2).set('c', 3);
  cache.get('a');
  cache.set('d', 4);            // evicts b
  assert.deepEqual([cache.has('a'), cache.has('b'), cache.has('c'), cache.has('d')], [true, false, true, true]);
  cache.get('c');
  cache.set('e', 5);            // evicts a
  assert.deepEqual([cache.has('a'), cache.has('c'), cache.has('d'), cache.has('e')], [false, true, true, true]);
  assert.equal(cache.size, 3);
});

check('generalization', 'falsy values are cached, not treated as missing', () => {
  const cache = createLruCache(3);
  cache.set('zero', 0).set('empty', '').set('nul', null);
  assert.strictEqual(cache.get('zero'), 0);
  assert.strictEqual(cache.get('empty'), '');
  assert.strictEqual(cache.get('nul'), null);
  assert.equal(cache.size, 3);
});

check('generalization', 'size never exceeds capacity under churn', () => {
  const cache = createLruCache(4);
  for (let index = 0; index < 50; index += 1) {
    cache.set(`k${index % 9}`, index);
    assert.ok(cache.size <= 4, `size grew to ${cache.size}`);
  }
});

check('generalization', 'separate instances do not share state', () => {
  const a = createLruCache(2).set('x', 1);
  const b = createLruCache(2);
  assert.equal(b.has('x'), false);
  assert.equal(a.has('x'), true);
});

// --- Scope ----------------------------------------------------------------
check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/lru-cache.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
