'use strict';

/**
 * Hidden verifier for the `cursor-pagination` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
 *
 * The `stability` group is the point of the task: it inserts rows between page
 * reads, which offset pagination cannot survive.
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

function loadModule(relative, names) {
  const modulePath = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    console.error(`${relative} is missing or is not a regular file`);
    process.exit(1);
  }
  let exported;
  try {
    exported = require(modulePath);
  } catch (error) {
    console.error(`${relative} failed to load: ${error.message}`);
    process.exit(1);
  }
  for (const name of names) {
    if (typeof exported[name] !== 'function') {
      console.error(`${relative} must export a ${name} function`);
      process.exit(1);
    }
  }
  return exported;
}

const { createRepository } = loadModule('src/repository.js', ['createRepository']);
const { encodeCursor, decodeCursor } = loadModule('src/cursor.js', ['encodeCursor', 'decodeCursor']);
const { paginate } = loadModule('src/paginate.js', ['paginate']);

const BASE_ROWS = [
  { id: 'a', createdAt: 300, title: 'A' },
  { id: 'b', createdAt: 200, title: 'B' },
  { id: 'c', createdAt: 200, title: 'C' },
  { id: 'd', createdAt: 100, title: 'D' },
];

const ids = page => page.items.map(item => item.id);

function walkAll(repository, limit) {
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = paginate(repository, { limit, cursor });
    seen.push(...ids(page));
    if (!page.hasMore) {
      assert.equal(page.nextCursor, null, 'nextCursor must be null on the last page');
      return seen;
    }
    assert.notEqual(page.nextCursor, null, 'nextCursor must be set when hasMore is true');
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not terminate');
}

// --- Cursor contract ------------------------------------------------------
check('cursor', 'round-trips position keys', () => {
  assert.deepEqual(decodeCursor(encodeCursor({ id: 'b', createdAt: 200 })), { createdAt: 200, id: 'b' });
});

check('cursor', 'is opaque rather than the bare id', () => {
  const cursor = encodeCursor({ id: 'b', createdAt: 200 });
  assert.notEqual(cursor, 'b', 'cursor must not be the raw id');
  assert.ok(!cursor.includes('"'), 'cursor must be encoded, not raw JSON');
});

check('cursor', 'is base64url safe for query strings', () => {
  const cursor = encodeCursor({ id: 'a/b+c=', createdAt: 1 });
  assert.match(cursor, /^[A-Za-z0-9_-]+$/, 'cursor must be base64url');
  assert.deepEqual(decodeCursor(cursor), { createdAt: 1, id: 'a/b+c=' });
});

for (const [name, value] of [
  ['garbage', '!!!'],
  ['empty string', ''],
  ['non-string', 42],
  ['valid base64 of non-JSON', Buffer.from('not json', 'utf8').toString('base64url')],
  ['JSON missing id', Buffer.from(JSON.stringify({ createdAt: 1 }), 'utf8').toString('base64url')],
  ['JSON missing createdAt', Buffer.from(JSON.stringify({ id: 'a' }), 'utf8').toString('base64url')],
  ['JSON array', Buffer.from(JSON.stringify([1, 2]), 'utf8').toString('base64url')],
]) {
  check('cursor', `rejects ${name}`, () => {
    assert.throws(() => decodeCursor(value), error => error instanceof Error && error.message === 'invalid cursor');
  });
}

// --- Ordering -------------------------------------------------------------
check('ordering', 'createdAt desc then id desc', () => {
  assert.deepEqual(ids(paginate(createRepository(BASE_ROWS), { limit: 10 })), ['a', 'c', 'b', 'd']);
});

check('ordering', 'tie-break is stable across page sizes', () => {
  const repository = createRepository(BASE_ROWS);
  for (const limit of [1, 2, 3, 4, 10]) {
    assert.deepEqual(walkAll(repository, limit), ['a', 'c', 'b', 'd'], `limit ${limit}`);
  }
});

check('ordering', 'many equal timestamps still order by id desc', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, createdAt: 500, title: id }));
  assert.deepEqual(walkAll(createRepository(rows), 2), ['e', 'd', 'c', 'b', 'a']);
});

// --- Paging -------------------------------------------------------------
check('paging', 'first page has no cursor', () => {
  const page = paginate(createRepository(BASE_ROWS), { limit: 2 });
  assert.deepEqual(ids(page), ['a', 'c']);
  assert.equal(page.hasMore, true);
});

check('paging', 'pages start strictly after the cursor', () => {
  const repository = createRepository(BASE_ROWS);
  const first = paginate(repository, { limit: 2 });
  const second = paginate(repository, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ['b', 'd']);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

check('paging', 'an exact-multiple page size reports hasMore correctly', () => {
  const repository = createRepository(BASE_ROWS);
  const first = paginate(repository, { limit: 4 });
  assert.deepEqual(ids(first), ['a', 'c', 'b', 'd']);
  assert.equal(first.hasMore, false, 'a full page that exhausts the set must report hasMore false');
  assert.equal(first.nextCursor, null);
});

check('paging', 'an empty repository yields an empty page', () => {
  const page = paginate(createRepository([]), { limit: 5 });
  assert.deepEqual(page.items, []);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

check('paging', 'a cursor past the end yields an empty page', () => {
  const page = paginate(createRepository(BASE_ROWS), {
    limit: 5,
    cursor: encodeCursor({ id: 'd', createdAt: 100 }),
  });
  assert.deepEqual(page.items, []);
  assert.equal(page.hasMore, false);
});

// --- Stability: the reason keyset pagination exists -----------------------
check('stability', 'inserting a newer row does not repeat or skip rows', () => {
  const rows = [...BASE_ROWS];
  const repository = createRepository(rows);
  const first = paginate(repository, { limit: 2 });
  assert.deepEqual(ids(first), ['a', 'c']);

  // A newer row arrives between requests. Under offset pagination this shifts
  // every later page and repeats a row.
  const shifted = createRepository([...rows, { id: 'z', createdAt: 999, title: 'Z' }]);
  const second = paginate(shifted, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ['b', 'd'], 'later pages must not shift');
});

check('stability', 'deleting an earlier row does not skip rows', () => {
  const repository = createRepository(BASE_ROWS);
  const first = paginate(repository, { limit: 2 });
  const reduced = createRepository(BASE_ROWS.filter(row => row.id !== 'a'));
  const second = paginate(reduced, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ['b', 'd']);
});

// --- Limits ---------------------------------------------------------------
check('limits', 'defaults to 20', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `id${String(index).padStart(3, '0')}`, createdAt: 1000 - index, title: 't',
  }));
  assert.equal(paginate(createRepository(rows)).items.length, 20);
});

check('limits', 'clamps below 1', () => {
  assert.equal(paginate(createRepository(BASE_ROWS), { limit: 0 }).items.length, 1);
  assert.equal(paginate(createRepository(BASE_ROWS), { limit: -5 }).items.length, 1);
});

check('limits', 'clamps above 100', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    id: `id${String(index).padStart(3, '0')}`, createdAt: 10000 - index, title: 't',
  }));
  const page = paginate(createRepository(rows), { limit: 1000 });
  assert.equal(page.items.length, 100);
  assert.equal(page.hasMore, true);
});

check('limits', 'a non-numeric limit falls back to the default', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `id${String(index).padStart(3, '0')}`, createdAt: 1000 - index, title: 't',
  }));
  assert.equal(paginate(createRepository(rows), { limit: undefined }).items.length, 20);
});

// --- Scope ----------------------------------------------------------------
check('scope', 'repository findPage signature is unchanged', () => {
  const repository = createRepository(BASE_ROWS);
  const result = repository.findPage({ offset: 1, limit: 2 });
  assert.ok(Array.isArray(result.rows), 'findPage must still return { rows, total }');
  assert.equal(result.total, 4);
  assert.deepEqual(result.rows.map(row => row.id), ['c', 'b']);
});

check('scope', 'all three modules still present', () => {
  for (const relative of ['src/repository.js', 'src/cursor.js', 'src/paginate.js']) {
    assert.ok(fs.existsSync(path.resolve(process.cwd(), relative)), `${relative} was removed`);
  }
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/paginate.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
