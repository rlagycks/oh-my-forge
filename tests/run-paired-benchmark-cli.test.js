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
  console.log('  ✓ CLI emits JSON and human-readable paired comparison output');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
