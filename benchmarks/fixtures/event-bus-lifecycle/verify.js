'use strict';

/**
 * Hidden verifier for the `event-bus-lifecycle` fixture.
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

const modulePath = path.resolve(process.cwd(), 'src/event-bus.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/event-bus.js is missing or is not a regular file');
  process.exit(1);
}

let createEventBus;
try {
  ({ createEventBus } = require(modulePath));
} catch (error) {
  console.error(`src/event-bus.js failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof createEventBus !== 'function') {
  console.error('src/event-bus.js must export a createEventBus function');
  process.exit(1);
}

// --- Contract -------------------------------------------------------------
check('contract', 'rejects a non-function handler', () => {
  assert.throws(() => createEventBus().on('x', 'nope'), TypeError);
  assert.throws(() => createEventBus().once('x', null), TypeError);
});

check('contract', 'on/once return a callable handle', () => {
  const bus = createEventBus();
  assert.equal(typeof bus.on('x', () => {}), 'function');
  assert.equal(typeof bus.once('x', () => {}), 'function');
});

check('contract', 'off and emit stay chainable', () => {
  const bus = createEventBus();
  const handler = () => {};
  bus.on('x', handler);
  assert.strictEqual(bus.off('x', handler), bus);
  assert.strictEqual(bus.emit('x'), bus);
});

check('contract', 'listenerCount is zero for an unknown event', () => {
  assert.equal(createEventBus().listenerCount('never'), 0);
});

// --- Regression: the shipped public cases ---------------------------------
check('regression', 'delivers to all handlers in order', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('x', () => seen.push('a'));
  bus.on('x', () => seen.push('b'));
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});

check('regression', 'unsubscribing during emit does not skip the next handler', () => {
  const bus = createEventBus();
  const seen = [];
  const off = bus.on('x', () => { seen.push('a'); off(); });
  bus.on('x', () => seen.push('b'));
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});

check('regression', 'handlers added during emit do not run in that emit', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('x', () => { seen.push('a'); bus.on('x', () => seen.push('late')); });
  bus.emit('x');
  assert.deepEqual(seen, ['a']);
});

check('regression', 'once runs exactly once under re-entrant emit', () => {
  const bus = createEventBus();
  let count = 0;
  bus.once('x', () => { count += 1; if (count < 3) bus.emit('x'); });
  bus.emit('x');
  assert.equal(count, 1);
});

check('regression', 'a throwing handler does not stop the rest', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => seen.push('b'));
  assert.throws(() => bus.emit('x'), /boom/);
  assert.deepEqual(seen, ['b']);
});

check('regression', 'unsubscribe is idempotent', () => {
  const bus = createEventBus();
  const off = bus.on('x', () => {});
  off();
  off();
  bus.on('x', () => {});
  assert.equal(bus.listenerCount('x'), 1);
});

// --- Generalization -------------------------------------------------------
check('generalization', 'a later handler removed mid-dispatch still receives the in-flight emit', () => {
  const bus = createEventBus();
  const seen = [];
  let offB;
  bus.on('x', () => { seen.push('a'); offB(); });
  offB = bus.on('x', () => seen.push('b'));
  bus.emit('x');
  // Snapshot semantics: 'b' was in the snapshot, so this emit still reaches it.
  assert.deepEqual(seen, ['a', 'b']);
  // But it is gone for the next emit.
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b', 'a']);
});

check('generalization', 'the first of several errors is rethrown', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('x', () => { throw new Error('first'); });
  bus.on('x', () => { throw new Error('second'); });
  bus.on('x', () => seen.push('c'));
  assert.throws(() => bus.emit('x'), /first/);
  assert.deepEqual(seen, ['c'], 'all handlers must still run');
});

check('generalization', 'a throwing once handler is still removed', () => {
  const bus = createEventBus();
  bus.once('x', () => { throw new Error('boom'); });
  assert.throws(() => bus.emit('x'), /boom/);
  assert.equal(bus.listenerCount('x'), 0);
  assert.doesNotThrow(() => bus.emit('x'));
});

check('generalization', 'once is removed before its handler runs', () => {
  const bus = createEventBus();
  let observed = null;
  bus.once('x', () => { observed = bus.listenerCount('x'); });
  bus.emit('x');
  assert.equal(observed, 0, 'the once entry must be detached before invocation');
});

check('generalization', 'payload reaches every handler', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('x', value => seen.push(value));
  bus.once('x', value => seen.push(value));
  bus.emit('x', { id: 7 });
  assert.deepEqual(seen, [{ id: 7 }, { id: 7 }]);
});

check('generalization', 'events are isolated from each other', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('a', () => seen.push('a'));
  bus.on('b', () => seen.push('b'));
  bus.emit('a');
  assert.deepEqual(seen, ['a']);
  assert.equal(bus.listenerCount('b'), 1);
});

check('generalization', 'off removes only one registration of a repeated handler', () => {
  const bus = createEventBus();
  const handler = () => {};
  bus.on('x', handler);
  bus.on('x', handler);
  bus.off('x', handler);
  assert.equal(bus.listenerCount('x'), 1);
});

check('generalization', 'unsubscribing all during emit still dispatches the snapshot', () => {
  const bus = createEventBus();
  const seen = [];
  const handles = [];
  handles.push(bus.on('x', () => { seen.push('a'); handles.forEach(off => off()); }));
  handles.push(bus.on('x', () => seen.push('b')));
  bus.emit('x');
  // The snapshot completes, then the bus is empty.
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(bus.listenerCount('x'), 0);
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});

check('generalization', 'separate buses do not share listeners', () => {
  const a = createEventBus();
  const b = createEventBus();
  a.on('x', () => {});
  assert.equal(b.listenerCount('x'), 0);
});

check('generalization', 'nested once handlers for different events each fire once', () => {
  const bus = createEventBus();
  const seen = [];
  bus.once('outer', () => { seen.push('outer'); bus.emit('inner'); });
  bus.once('inner', () => seen.push('inner'));
  bus.emit('outer');
  bus.emit('outer');
  bus.emit('inner');
  assert.deepEqual(seen, ['outer', 'inner']);
});

// --- Scope ----------------------------------------------------------------
check('scope', 'subscription module still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'src/subscription.js')), 'src/subscription.js was removed');
});

check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/event-bus.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
