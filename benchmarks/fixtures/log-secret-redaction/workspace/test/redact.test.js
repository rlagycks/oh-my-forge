'use strict';

const assert = require('node:assert/strict');
const { redactSecrets } = require('../src/redact.js');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const cases = [
  ['redacts a Bearer header', 'Authorization: Bearer abc123xyz', 'Authorization: Bearer [REDACTED]'],
  ['redacts a Basic header', 'Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic [REDACTED]'],
  ['redacts a JWT', `token=${JWT} done`, 'token=[REDACTED] done'],
  ['redacts an AWS key id', 'key AKIAIOSFODNN7EXAMPLE used', 'key [REDACTED] used'],
  ['redacts a URL password', 'db postgres://admin:s3cr3t@host/db', 'db postgres://admin:[REDACTED]@host/db'],
  ['leaves ordinary lines alone', 'GET /health 200 in 4ms', 'GET /health 200 in 4ms'],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  try {
    assert.equal(redactSecrets(input), expected);
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
