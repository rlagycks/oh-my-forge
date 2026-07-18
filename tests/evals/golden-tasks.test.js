'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fixturePath = path.resolve(__dirname, '../../docs/evals/golden-tasks.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const ids = new Set();

assert.strictEqual(fixture.version, 1);
assert.ok(Array.isArray(fixture.tasks));
assert.ok(fixture.tasks.length >= 10);

const difficulties = new Set(['easy', 'medium', 'hard']);

for (const task of fixture.tasks) {
  assert.ok(typeof task.id === 'string' && task.id.length > 0);
  assert.strictEqual(ids.has(task.id), false, `duplicate golden task id: ${task.id}`);
  ids.add(task.id);
  assert.ok(typeof task.prompt === 'string' && task.prompt.length > 0);
  assert.ok(task.provenance && typeof task.provenance === 'object');
  assert.ok(typeof task.provenance.source === 'string' && task.provenance.source.length > 0);
  assert.ok(typeof task.provenance.incident === 'string' && task.provenance.incident.length > 0);
  assert.ok(Array.isArray(task.tags) && task.tags.length > 0);
  assert.ok(task.tags.every(tag => typeof tag === 'string' && tag.length > 0));
  assert.ok(difficulties.has(task.difficulty));
  assert.ok(Array.isArray(task.success_criteria) && task.success_criteria.length > 0);
  assert.ok(Array.isArray(task.verification.argv) && task.verification.argv.length > 0);
  assert.strictEqual(Number.isInteger(task.verification.expected_exit_code), true);
}

console.log(`  ✓ validates ${fixture.tasks.length} golden task definitions`);
