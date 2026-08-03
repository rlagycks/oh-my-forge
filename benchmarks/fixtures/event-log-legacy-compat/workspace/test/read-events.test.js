'use strict';

const assert = require('node:assert/strict');
const { readEvents } = require('../src/read-events.js');

const line = value => JSON.stringify(value);

const cases = [
  ['reads structured records', () => {
    const { events } = readEvents(line({ schema_version: 1, event_type: 'outcome', id: 'a' }));
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'a');
  }],
  ['keeps a legacy injection record', () => {
    const { events } = readEvents(line({ episode_id: 'e1', injected_tokens: 40 }));
    assert.equal(events.length, 1);
    assert.equal(events[0].schema_version, 0);
    assert.equal(events[0].event_type, 'injection');
  }],
  ['keeps a legacy outcome record', () => {
    const { events } = readEvents(line({ episode_id: 'e1', outcome: 'success' }));
    assert.equal(events[0].event_type, 'outcome');
  }],
  ['counts an unrecognized legacy record', () => {
    const { events, skipped } = readEvents(line({ episode_id: 'e1' }));
    assert.equal(events.length, 0);
    assert.equal(skipped.unrecognized, 1);
  }],
  ['skips a corrupt line without throwing', () => {
    const text = [line({ schema_version: 1, event_type: 'outcome' }), 'not json', line({ schema_version: 1, event_type: 'outcome' })].join('\n');
    const { events, skipped } = readEvents(text);
    assert.equal(events.length, 2);
    assert.equal(skipped.corrupt, 1);
  }],
  ['ignores blank lines', () => {
    const { events, skipped } = readEvents(`\n  \n${line({ schema_version: 1 })}\n\n`);
    assert.equal(events.length, 1);
    assert.deepEqual(skipped, { corrupt: 0, unrecognized: 0 });
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
