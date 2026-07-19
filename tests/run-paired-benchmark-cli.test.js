'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../scripts/run-paired-benchmark.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-benchmark-cli-'));
const suitePath = path.join(dir, 'suite.json');
const adapterPath = path.join(dir, 'adapter.js');
const logPath = path.join(dir, 'events.jsonl');

fs.writeFileSync(suitePath, JSON.stringify({
  suite: 'cli-paired-suite',
  tasks: [{
    id: 'cli-task',
    prompt: 'private CLI prompt',
    provenance: { source: 'fixture', incident: 'test' },
    tags: ['paired'],
    difficulty: 'easy',
    success_criteria: ['verification passes'],
    verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
  }],
}), 'utf8');
fs.writeFileSync(adapterPath, `'use strict';
module.exports = async function adapter() {
  return { provider: 'fixture-provider', model: 'fixture-model', config: { temperature: 0 }, inputTokens: 4, outputTokens: 2, toolCalls: 1, costUsd: 0.01 };
};
`, 'utf8');

try {
  const helpResult = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
  assert.strictEqual(helpResult.status, 0, helpResult.stderr);
  assert.ok(helpResult.stdout.includes('--require-isolation'));
  assert.ok(helpResult.stdout.includes('--require-comparable'));
  assert.ok(helpResult.stdout.includes('--require-failing-baseline'));

  const jsonResult = spawnSync(process.execPath, [
    cliPath,
    '--suite', suitePath,
    '--adapter', adapterPath,
    '--snapshot-id', 'cli-snapshot',
    '--snapshot-hash', 'sha256:cli',
    '--repetitions', '2',
    '--seed', '99',
    '--log', logPath,
    '--json',
  ], { encoding: 'utf8' });
  assert.strictEqual(jsonResult.status, 0, jsonResult.stderr);
  const report = JSON.parse(jsonResult.stdout);
  assert.strictEqual(report.seed, 99);
  assert.strictEqual(report.comparison.pairs, 2);
  assert.ok(!jsonResult.stdout.includes('private CLI prompt'));

  const textResult = spawnSync(process.execPath, [
    cliPath,
    '--suite', suitePath,
    '--adapter', adapterPath,
    '--snapshot-id', 'cli-snapshot',
    '--log', logPath,
  ], { encoding: 'utf8' });
  assert.strictEqual(textResult.status, 0, textResult.stderr);
  assert.ok(textResult.stdout.includes('Paired benchmark comparison'));
  assert.ok(textResult.stdout.includes('fixture-provider'));
  assert.ok(textResult.stdout.includes('on'));
  assert.ok(textResult.stdout.includes('off'));

  const taskFailureSuitePath = path.join(dir, 'task-failure-suite.json');
  fs.writeFileSync(taskFailureSuitePath, JSON.stringify({
    suite: 'cli-task-failure-suite',
    tasks: [{
      id: 'cli-task-fails-verification',
      prompt: 'deterministic task failure is benchmark data',
      provenance: { source: 'fixture', incident: 'expected verification failure' },
      tags: ['paired'],
      difficulty: 'easy',
      success_criteria: ['the failure is reported without a process error'],
      verification: { argv: ['node', '-e', 'process.exit(1)'], expected_exit_code: 0 },
    }],
  }), 'utf8');
  const taskFailureResult = spawnSync(process.execPath, [
    cliPath,
    '--suite', taskFailureSuitePath,
    '--adapter', adapterPath,
    '--snapshot-id', 'task-failure-snapshot',
    '--log', path.join(dir, 'task-failure-events.jsonl'),
    '--json',
  ], { encoding: 'utf8' });
  assert.strictEqual(taskFailureResult.status, 0, taskFailureResult.stderr);
  assert.strictEqual(JSON.parse(taskFailureResult.stdout).results[0].outcome, 'failure');
  console.log('  ✓ CLI emits JSON and human-readable paired comparison output');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
