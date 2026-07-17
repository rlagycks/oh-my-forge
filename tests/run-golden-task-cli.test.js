'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../scripts/run-golden-task.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-golden-task-cli-'));
const suitePath = path.join(dir, 'suite.json');
const logPath = path.join(dir, 'events.jsonl');

fs.writeFileSync(suitePath, `${JSON.stringify({
  version: 1,
  suite: 'cli-suite',
  tasks: [
    {
      id: 'cli-pass',
      prompt: 'not persisted',
      verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
    },
    {
      id: 'cli-fail',
      verification: { argv: ['node', '-e', 'process.exit(1)'], expected_exit_code: 0 },
    },
  ],
})}\n`, 'utf8');

try {
  const success = spawnSync(process.execPath, [
    cliPath,
    '--task', 'cli-pass',
    '--suite', suitePath,
    '--episode', 'cli-episode',
    '--log', logPath,
    '--json',
  ], { encoding: 'utf8' });
  assert.strictEqual(success.status, 0, success.stderr);
  const report = JSON.parse(success.stdout);
  assert.strictEqual(report.passed, 1);
  assert.strictEqual(report.results[0].episodeId, 'cli-episode');

  const failure = spawnSync(process.execPath, [
    cliPath,
    '--task', 'cli-fail',
    '--suite', suitePath,
    '--episode', 'cli-failure-episode',
    '--log', logPath,
    '--json',
  ], { encoding: 'utf8' });
  assert.strictEqual(failure.status, 1);
  const failureReport = JSON.parse(failure.stdout);
  assert.strictEqual(failureReport.failed, 1);
  console.log('  ✓ CLI records success and exits non-zero for failed verification');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
