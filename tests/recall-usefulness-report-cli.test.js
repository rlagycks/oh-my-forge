'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../scripts/recall-report.js');
function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-usefulness-cli-'));
const logPath = path.join(dir, 'events.jsonl');
const event = (eventType, episodeId, ts, payload) => JSON.stringify({
  schema_version: 1, event_type: eventType, ts, source: 'test', episode_id: episodeId, payload,
});

try {
  fs.writeFileSync(logPath, [
    event('context_injection', 'episode-success', '2026-07-17T00:00:00.000Z', {
      domain: 'domain_hooks', item_counts: {}, constraint_ids: ['c1'], memory_ids: ['m1'],
    }),
    event('task_outcome', 'episode-success', '2026-07-17T00:00:01.000Z', { outcome: 'success', recall_used: true }),
    event('task_outcome', 'episode-no-injection', '2026-07-17T00:00:02.000Z', { outcome: 'success' }),
  ].join('\n') + '\n', 'utf8');

  const jsonResult = run(['--log', logPath, '--json']);
  assert.strictEqual(jsonResult.status, 0, jsonResult.stderr);
  const report = JSON.parse(jsonResult.stdout);
  assert.strictEqual(report.recallUsefulness.categories.injectedAndSuccessful, 1);
  assert.strictEqual(report.recallUsefulness.categories.noInjection, 1);
  assert.ok(Array.isArray(report.recurrence.byMemoryId));

  const textResult = run(['--log', logPath]);
  assert.strictEqual(textResult.status, 0, textResult.stderr);
  assert.ok(textResult.stdout.includes('Recall usefulness'));
  assert.ok(textResult.stdout.includes('injected-and-successful=1'));
  console.log('  ✓ reports recurrence and usefulness in JSON and human-readable output');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
