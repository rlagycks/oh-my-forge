'use strict';

const assert = require('node:assert/strict');
const { createEventBus } = require('../src/event-bus.js');

const cases = [
  ['delivers to all handlers', () => {
    const bus = createEventBus();
    const seen = [];
    bus.on('x', () => seen.push('a'));
    bus.on('x', () => seen.push('b'));
    bus.emit('x');
    assert.deepEqual(seen, ['a', 'b']);
  }],
  ['unsubscribing during emit does not skip the next handler', () => {
    const bus = createEventBus();
    const seen = [];
    const off = bus.on('x', () => { seen.push('a'); off(); });
    bus.on('x', () => seen.push('b'));
    bus.emit('x');
    assert.deepEqual(seen, ['a', 'b']);
  }],
  ['handlers added during emit do not run in that emit', () => {
    const bus = createEventBus();
    const seen = [];
    bus.on('x', () => { seen.push('a'); bus.on('x', () => seen.push('late')); });
    bus.emit('x');
    assert.deepEqual(seen, ['a']);
  }],
  ['once runs exactly once under re-entrant emit', () => {
    const bus = createEventBus();
    let count = 0;
    bus.once('x', () => { count += 1; if (count < 3) bus.emit('x'); });
    bus.emit('x');
    assert.equal(count, 1);
  }],
  ['a throwing handler does not stop the rest', () => {
    const bus = createEventBus();
    const seen = [];
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', () => seen.push('b'));
    assert.throws(() => bus.emit('x'), /boom/);
    assert.deepEqual(seen, ['b']);
  }],
  ['unsubscribe is idempotent', () => {
    const bus = createEventBus();
    const off = bus.on('x', () => {});
    off();
    off();
    bus.on('x', () => {});
    assert.equal(bus.listenerCount('x'), 1);
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
