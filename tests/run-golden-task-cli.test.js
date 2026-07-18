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
      provenance: { source: 'tests/run-golden-task-cli.test.js', incident: 'CLI success fixture' },
      tags: ['test', 'cli'],
      difficulty: 'easy',
      success_criteria: ['The CLI records a successful verification'],
      verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
    },
    {
      id: 'cli-fail',
      prompt: 'deterministic failure fixture',
      provenance: { source: 'tests/run-golden-task-cli.test.js', incident: 'CLI failure fixture' },
      tags: ['test', 'cli'],
      difficulty: 'easy',
      success_criteria: ['The CLI records a failed verification'],
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

  const allSuitePath = path.join(dir, 'all-suite.json');
  fs.writeFileSync(allSuitePath, JSON.stringify({
    version: 1,
    suite: 'all-suite',
    tasks: [{
      id: 'cli-pass',
      prompt: 'deterministic all-mode fixture',
      provenance: { source: 'tests/run-golden-task-cli.test.js', incident: 'CLI all-mode fixture' },
      tags: ['test', 'cli'],
      difficulty: 'easy',
      success_criteria: ['The all-mode runner records success'],
      verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
    }],
  }), 'utf8');
  const firstAll = spawnSync(process.execPath, [
    cliPath, '--all', '--suite', allSuitePath, '--episode-prefix', 'repeat', '--log', logPath, '--json',
  ], { encoding: 'utf8' });
  const secondAll = spawnSync(process.execPath, [
    cliPath, '--all', '--suite', allSuitePath, '--episode-prefix', 'repeat', '--log', logPath, '--json',
  ], { encoding: 'utf8' });
  assert.strictEqual(firstAll.status, 0, firstAll.stderr);
  assert.strictEqual(secondAll.status, 0, secondAll.stderr);
  const firstEpisode = JSON.parse(firstAll.stdout).results[0].episodeId;
  const secondEpisode = JSON.parse(secondAll.stdout).results[0].episodeId;
  assert.match(firstEpisode, /^repeat-\d+:cli-pass$/);
  assert.notStrictEqual(firstEpisode, secondEpisode);

  const invalidTimeout = spawnSync(process.execPath, [
    cliPath, '--task', 'cli-pass', '--suite', suitePath, '--episode', 'timeout-zero', '--timeout-ms', '0', '--log', logPath,
  ], { encoding: 'utf8' });
  assert.strictEqual(invalidTimeout.status, 1);
  assert.ok(invalidTimeout.stderr.includes('timeoutMs'));

  const emptySuitePath = path.join(dir, 'empty-suite.json');
  fs.writeFileSync(emptySuitePath, JSON.stringify({ version: 1, tasks: [] }), 'utf8');
  const emptySuite = spawnSync(process.execPath, [
    cliPath, '--all', '--suite', emptySuitePath, '--log', logPath,
  ], { encoding: 'utf8' });
  assert.strictEqual(emptySuite.status, 1);
  assert.ok(emptySuite.stderr.includes('Golden task suite is empty'));
  console.log('  ✓ CLI records success and exits non-zero for failed verification');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
