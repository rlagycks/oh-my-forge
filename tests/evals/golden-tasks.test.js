'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fixturePath = path.resolve(__dirname, '../../docs/evals/golden-tasks.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const ids = new Set();

assert.strictEqual(fixture.version, 1);
assert.ok(Array.isArray(fixture.tasks));
assert.ok(fixture.tasks.length >= 3);

for (const task of fixture.tasks) {
  assert.ok(typeof task.id === 'string' && task.id.length > 0);
  assert.strictEqual(ids.has(task.id), false, `duplicate golden task id: ${task.id}`);
  ids.add(task.id);
  assert.ok(typeof task.prompt === 'string' && task.prompt.length > 0);
  assert.ok(Array.isArray(task.success_criteria) && task.success_criteria.length > 0);
  assert.ok(Array.isArray(task.verification.argv) && task.verification.argv.length > 0);
  assert.strictEqual(Number.isInteger(task.verification.expected_exit_code), true);
}

console.log(`  ✓ validates ${fixture.tasks.length} golden task definitions`);
