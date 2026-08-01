'use strict';

const assert = require('node:assert/strict');
const { loadConfig } = require('../src/load-config.js');

const cases = [
  ['defaults with no input', () => {
    const config = loadConfig();
    assert.equal(config.port, 8080);
    assert.equal(config.cache.ttl, 300);
  }],
  ['file overrides defaults', () => {
    assert.equal(loadConfig({ port: 3000 }).port, 3000);
  }],
  ['file merges nested objects', () => {
    const config = loadConfig({ cache: { ttl: 60 } });
    assert.equal(config.cache.ttl, 60);
    assert.equal(config.cache.enabled, true, 'sibling keys must survive the merge');
  }],
  ['env overrides file with coercion', () => {
    const config = loadConfig({ port: 3000 }, { APP_PORT: '9000' });
    assert.strictEqual(config.port, 9000);
  }],
  ['empty env value falls back to the file', () => {
    assert.strictEqual(loadConfig({ port: 3000 }, { APP_PORT: '' }).port, 3000);
  }],
  ['nested env key', () => {
    assert.strictEqual(loadConfig({}, { APP_CACHE__TTL: '45' }).cache.ttl, 45);
  }],
  ['arrays replace', () => {
    assert.deepEqual(loadConfig({ origins: ['https://a.test'] }).origins, ['https://a.test']);
  }],
  ['unknown env vars are ignored', () => {
    assert.equal(loadConfig({}, { APP_NOT_A_KEY: 'x' }).not_a_key, undefined);
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
