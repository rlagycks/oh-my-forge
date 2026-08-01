'use strict';

const assert = require('node:assert/strict');
const { createRepository } = require('../src/repository.js');
const { encodeCursor, decodeCursor } = require('../src/cursor.js');
const { paginate } = require('../src/paginate.js');

const rows = [
  { id: 'a', createdAt: 300, title: 'A' },
  { id: 'b', createdAt: 200, title: 'B' },
  { id: 'c', createdAt: 200, title: 'C' },
  { id: 'd', createdAt: 100, title: 'D' },
];

const ids = page => page.items.map(item => item.id);

const cases = [
  ['orders by createdAt desc then id desc', () => {
    const page = paginate(createRepository(rows), { limit: 10 });
    assert.deepEqual(ids(page), ['a', 'c', 'b', 'd']);
  }],
  ['cursor round-trips', () => {
    const cursor = encodeCursor({ id: 'b', createdAt: 200 });
    assert.deepEqual(decodeCursor(cursor), { createdAt: 200, id: 'b' });
  }],
  ['rejects a malformed cursor', () => {
    assert.throws(() => decodeCursor('!!!'), error => error.message === 'invalid cursor');
  }],
  ['walks pages without repeating or skipping', () => {
    const repository = createRepository(rows);
    const seen = [];
    let cursor = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = paginate(repository, { limit: 2, cursor });
      seen.push(...ids(page));
      if (!page.hasMore) { assert.equal(page.nextCursor, null); break; }
      cursor = page.nextCursor;
    }
    assert.deepEqual(seen, ['a', 'c', 'b', 'd']);
  }],
  ['clamps the limit', () => {
    const repository = createRepository(rows);
    assert.equal(paginate(repository, { limit: 0 }).items.length, 1);
    assert.equal(paginate(repository, { limit: 1000 }).items.length, 4);
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
