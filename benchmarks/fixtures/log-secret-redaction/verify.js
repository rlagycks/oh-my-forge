'use strict';

/**
 * Hidden verifier for the `log-secret-redaction` fixture.
 *
 * Runs with cwd set to the prepared workspace and lives one directory ABOVE it,
 * so the agent under test cannot read or modify it. The workspace's own test
 * file is ignored; this verifier re-runs its own copy of the public cases plus
 * hidden cases the shipped tests do not cover.
 *
 * A repair that redacts aggressively would pass every security case while
 * destroying ordinary logs, so the `precision` group fails it.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REDACTED = '[REDACTED]';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const failures = [];

function check(group, name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`[${group}] ${name}: ${error.message.split('\n')[0]}`);
  }
}

const modulePath = path.resolve(process.cwd(), 'src/redact.js');

if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
  console.error('src/redact.js is missing or is not a regular file');
  process.exit(1);
}

let redactSecrets;
try {
  ({ redactSecrets } = require(modulePath));
} catch (error) {
  console.error(`src/redact.js failed to load: ${error.message}`);
  process.exit(1);
}

if (typeof redactSecrets !== 'function') {
  console.error('src/redact.js must export a redactSecrets function');
  process.exit(1);
}

const expect = (input, output) => assert.equal(redactSecrets(input), output);
const unchanged = input => assert.equal(redactSecrets(input), input);

// --- Contract -------------------------------------------------------------
check('contract', 'rejects non-string input', () => {
  assert.throws(() => redactSecrets(null), TypeError);
  assert.throws(() => redactSecrets(42), TypeError);
});

check('contract', 'returns a string', () => {
  assert.equal(typeof redactSecrets('plain'), 'string');
});

// --- Regression: the shipped public cases ---------------------------------
check('regression', 'Bearer header', () => expect('Authorization: Bearer abc123xyz', `Authorization: Bearer ${REDACTED}`));
check('regression', 'Basic header', () => expect('Authorization: Basic dXNlcjpwYXNz', `Authorization: Basic ${REDACTED}`));
check('regression', 'JWT', () => expect(`token=${JWT} done`, `token=${REDACTED} done`));
check('regression', 'AWS key id', () => expect('key AKIAIOSFODNN7EXAMPLE used', `key ${REDACTED} used`));
check('regression', 'URL password', () => expect('db postgres://admin:s3cr3t@host/db', `db postgres://admin:${REDACTED}@host/db`));
check('regression', 'ordinary line', () => unchanged('GET /health 200 in 4ms'));

// --- Coverage: secrets the shipped tests do not exercise ------------------
check('coverage', 'two Authorization headers on one line', () => {
  expect(
    'a Authorization: Bearer aaa b Authorization: Basic bbb',
    `a Authorization: Bearer ${REDACTED} b Authorization: Basic ${REDACTED}`
  );
});

check('coverage', 'mixed secret types on one line', () => {
  expect(
    `k AKIAIOSFODNN7EXAMPLE t ${JWT} u https://bob:hunter2@db.internal/x`,
    `k ${REDACTED} t ${REDACTED} u https://bob:${REDACTED}@db.internal/x`
  );
});

check('coverage', 'two JWTs on one line', () => {
  expect(`${JWT} and ${JWT}`, `${REDACTED} and ${REDACTED}`);
});

check('coverage', 'JWT embedded in a query string', () => {
  expect(`GET /cb?id_token=${JWT}&state=1`, `GET /cb?id_token=${REDACTED}&state=1`);
});

check('coverage', 'AWS key id at end of line', () => {
  expect('id=AKIAIOSFODNN7EXAMPLE', `id=${REDACTED}`);
});

check('coverage', 'userinfo on other URL schemes', () => {
  expect('amqp://svc:pa55word@broker:5672', `amqp://svc:${REDACTED}@broker:5672`);
});

check('coverage', 'username with dots and dashes is preserved', () => {
  expect('mongodb://read-only.user:abc@h/db', `mongodb://read-only.user:${REDACTED}@h/db`);
});

// --- Precision: an over-redacting repair must fail ------------------------
check('precision', 'plain URLs without credentials are untouched', () => {
  unchanged('fetching https://api.example.com/v1/users?page=2');
});

check('precision', 'a colon in a path is not userinfo', () => {
  unchanged('see https://example.com/a:b/c for details');
});

check('precision', 'host:port is not userinfo', () => {
  unchanged('connecting to http://localhost:8080/health');
});

check('precision', 'the word Authorization alone is untouched', () => {
  unchanged('Authorization check failed for user 12');
});

check('precision', 'AKIA-like strings that are too short are untouched', () => {
  unchanged('marker AKIASHORT and AKIAIOSFODNN7EXAMPLE2X');
});

check('precision', 'ordinary dotted identifiers are not JWTs', () => {
  unchanged('module a.b.c loaded; version 1.2.3; ratio 0.5.1');
});

check('precision', 'an empty line round-trips', () => unchanged(''));

check('precision', 'a line of ordinary prose round-trips byte for byte', () => {
  unchanged('User bob logged in from 10.0.0.4 at 12:03:04 with session sess-9182');
});

// --- Idempotence ----------------------------------------------------------
check('idempotence', 'redacting twice changes nothing further', () => {
  const once = redactSecrets(`Authorization: Bearer abc ${JWT} https://u:p@h/x`);
  assert.equal(redactSecrets(once), once);
});

// --- Scope ----------------------------------------------------------------
check('scope', 'test directory still present', () => {
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'test')), 'test/ was removed');
});

check('scope', 'package.json still declares the test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node test/redact.test.js');
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
