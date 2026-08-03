'use strict';

/**
 * Hidden verifier for the `config-precedence` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
 *
 * Every expectation here is stated in the workspace's own docs/CONFIG.md. The
 * task is brownfield: the specification is in the repository, not the prompt.
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

const modulePath = path.resolve(process.cwd(), 'src/load-config.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/load-config.js is missing or is not a regular file');
  process.exit(1);
}

let loadConfig;
let DEFAULTS;
try {
  ({ loadConfig } = require(modulePath));
  ({ DEFAULTS } = require(path.resolve(process.cwd(), 'src/defaults.js')));
} catch (error) {
  console.error(`config modules failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof loadConfig !== 'function') {
  console.error('src/load-config.js must export a loadConfig function');
  process.exit(1);
}

// --- Precedence -----------------------------------------------------------
check('precedence', 'defaults apply with no input', () => {
  const config = loadConfig();
  assert.equal(config.port, 8080);
  assert.equal(config.host, 'localhost');
  assert.equal(config.cache.ttl, 300);
});

check('precedence', 'file beats defaults', () => {
  assert.equal(loadConfig({ port: 3000 }).port, 3000);
});

check('precedence', 'env beats file', () => {
  assert.strictEqual(loadConfig({ port: 3000 }, { APP_PORT: '9000' }).port, 9000);
});

check('precedence', 'env beats defaults with no file', () => {
  assert.strictEqual(loadConfig({}, { APP_HOST: '0.0.0.0' }).host, '0.0.0.0');
});

// --- Unset and empty ------------------------------------------------------
check('fallback', 'empty env value falls back to the file', () => {
  assert.strictEqual(loadConfig({ port: 3000 }, { APP_PORT: '' }).port, 3000);
});

check('fallback', 'empty env value falls back to the default', () => {
  assert.strictEqual(loadConfig({}, { APP_PORT: '' }).port, 8080);
});

check('fallback', 'undefined env value falls back', () => {
  assert.strictEqual(loadConfig({ port: 3000 }, { APP_PORT: undefined }).port, 3000);
});

// --- Coercion -------------------------------------------------------------
check('coercion', 'numeric keys coerce to number', () => {
  const config = loadConfig({}, { APP_PORT: '9000' });
  assert.strictEqual(config.port, 9000);
  assert.equal(typeof config.port, 'number');
});

check('coercion', 'non-numeric value for a numeric key is ignored', () => {
  assert.strictEqual(loadConfig({}, { APP_PORT: 'not-a-port' }).port, 8080);
});

check('coercion', 'boolean true forms', () => {
  assert.strictEqual(loadConfig({}, { APP_CACHE__ENABLED: 'false' }).cache.enabled, false);
  assert.strictEqual(loadConfig({}, { APP_CACHE__ENABLED: '0' }).cache.enabled, false);
  assert.strictEqual(loadConfig({ cache: { enabled: false } }, { APP_CACHE__ENABLED: 'true' }).cache.enabled, true);
  assert.strictEqual(loadConfig({ cache: { enabled: false } }, { APP_CACHE__ENABLED: '1' }).cache.enabled, true);
});

check('coercion', 'unrecognized boolean value is ignored', () => {
  assert.strictEqual(loadConfig({}, { APP_CACHE__ENABLED: 'yes' }).cache.enabled, true);
});

check('coercion', 'string keys pass through unchanged', () => {
  assert.strictEqual(loadConfig({}, { APP_HOST: '127.0.0.1' }).host, '127.0.0.1');
});

// --- Nesting --------------------------------------------------------------
check('nesting', 'double underscore addresses a nested key', () => {
  assert.strictEqual(loadConfig({}, { APP_CACHE__TTL: '45' }).cache.ttl, 45);
});

check('nesting', 'a nested env override leaves siblings intact', () => {
  const config = loadConfig({}, { APP_CACHE__TTL: '45' });
  assert.strictEqual(config.cache.enabled, true);
});

// --- Unknown keys ---------------------------------------------------------
check('unknown', 'unknown env key is ignored', () => {
  const config = loadConfig({}, { APP_NOT_A_KEY: 'x' });
  assert.equal(config.not_a_key, undefined);
});

check('unknown', 'unknown nested env key is ignored', () => {
  const config = loadConfig({}, { APP_CACHE__NOPE: 'x' });
  assert.equal(config.cache.nope, undefined);
});

check('unknown', 'variables without the prefix are ignored', () => {
  const config = loadConfig({}, { PORT: '1', HOST: 'evil' });
  assert.strictEqual(config.port, 8080);
  assert.strictEqual(config.host, 'localhost');
});

// --- Merging --------------------------------------------------------------
check('merge', 'nested objects merge key by key', () => {
  const config = loadConfig({ cache: { ttl: 60 } });
  assert.equal(config.cache.ttl, 60);
  assert.equal(config.cache.enabled, true);
});

check('merge', 'arrays replace rather than concatenate', () => {
  assert.deepEqual(loadConfig({ origins: ['https://a.test'] }).origins, ['https://a.test']);
});

check('merge', 'an empty array replaces the default', () => {
  assert.deepEqual(loadConfig({ origins: [] }).origins, []);
});

check('merge', 'a file value of undefined does not override', () => {
  assert.strictEqual(loadConfig({ port: undefined }).port, 8080);
});

check('merge', 'a file value of null does override', () => {
  assert.strictEqual(loadConfig({ host: null }).host, null);
});

// --- Immutability ---------------------------------------------------------
check('immutability', 'the exported defaults are not mutated', () => {
  loadConfig({ port: 1, cache: { ttl: 1 }, origins: ['x'] }, { APP_HOST: 'z' });
  assert.equal(DEFAULTS.port, 8080);
  assert.equal(DEFAULTS.cache.ttl, 300);
  assert.deepEqual(DEFAULTS.origins, ['https://example.com']);
});

check('immutability', 'the file config is not mutated', () => {
  const fileConfig = { cache: { ttl: 60 } };
  loadConfig(fileConfig, { APP_CACHE__TTL: '99' });
  assert.deepEqual(fileConfig, { cache: { ttl: 60 } });
});

check('immutability', 'the env object is not mutated', () => {
  const env = { APP_PORT: '9000' };
  loadConfig({}, env);
  assert.deepEqual(env, { APP_PORT: '9000' });
});

check('immutability', 'the result does not alias defaults', () => {
  const config = loadConfig();
  config.cache.ttl = 1;
  assert.equal(DEFAULTS.cache.ttl, 300, 'writing to the result mutated the defaults');
});

// --- Scope ----------------------------------------------------------------
check('scope', 'documentation and defaults still present', () => {
  for (const relative of ['docs/CONFIG.md', 'src/defaults.js']) {
    assert.ok(fs.existsSync(path.resolve(process.cwd(), relative)), `${relative} was removed`);
  }
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/load-config.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
