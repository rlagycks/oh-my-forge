'use strict';

const assert = require('node:assert/strict');
const { runPipeline } = require('../src/run-pipeline.js');

const step = (name, options = {}) => ({ name, required: true, run: async () => {}, ...options });
const statuses = result => result.steps.map(entry => entry.status);

const cases = [
  ['all steps complete', async () => {
    const result = await runPipeline([step('a'), step('b')]);
    assert.equal(result.status, 'success');
    assert.deepEqual(statuses(result), ['completed', 'completed']);
  }],
  ['a skipped required step is not a success', async () => {
    const result = await runPipeline([step('a'), step('b', { precondition: () => false })]);
    assert.equal(result.status, 'incomplete');
    assert.deepEqual(statuses(result), ['completed', 'skipped']);
  }],
  ['a skipped step never runs', async () => {
    let ran = false;
    await runPipeline([step('a', { precondition: () => false, run: async () => { ran = true; } })]);
    assert.equal(ran, false);
  }],
  ['a skipped optional step still allows success', async () => {
    const result = await runPipeline([step('a'), step('b', { required: false, precondition: () => false })]);
    assert.equal(result.status, 'success');
  }],
  ['execution stops at the first failure', async () => {
    let ranLast = false;
    const result = await runPipeline([
      step('a'),
      step('b', { run: async () => { throw new Error('boom'); } }),
      step('c', { run: async () => { ranLast = true; } }),
    ]);
    assert.equal(result.status, 'failed');
    assert.deepEqual(statuses(result), ['completed', 'failed', 'not_run']);
    assert.equal(ranLast, false);
  }],
  ['non-completed steps carry a reason', async () => {
    const result = await runPipeline([step('a', { precondition: () => false })]);
    assert.equal(typeof result.steps[0].reason, 'string');
    assert.ok(result.steps[0].reason.length > 0);
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
