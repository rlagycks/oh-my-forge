'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../scripts/record-harness-event.js');
const eventLib = require('../scripts/lib/harness-events');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-harness-event-'));
const logPath = path.join(dir, 'events.jsonl');

try {
  const result = spawnSync(process.execPath, [
    cliPath,
    '--type', 'task_outcome',
    '--episode', 'episode-cli',
    '--task', 'golden-001',
    '--outcome', 'success',
    '--input-tokens', '1200',
    '--output-tokens', '300',
    '--tool-calls', '5',
    '--tests-passed', 'true',
    '--recall-used', 'true',
    '--log', logPath,
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 0, result.stderr);
  const { events, skipped } = eventLib.readEvents(logPath);
  assert.strictEqual(skipped, 0);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'task_outcome');
  assert.strictEqual(events[0].episode_id, 'episode-cli');
  assert.strictEqual(events[0].payload.task_id, 'golden-001');
  assert.strictEqual(events[0].payload.input_tokens, 1200);
  assert.strictEqual(events[0].payload.tests_passed, true);
  assert.strictEqual(events[0].payload.recall_used, true);
  console.log('  ✓ records a valid task outcome event through the CLI');

  const receiptResult = spawnSync(process.execPath, [
    cliPath,
    '--type', 'verification_receipt',
    '--episode', 'receipt-cli',
    '--verifier', 'targeted-test',
    '--subject', 'tests/record-harness-event-cli.test.js',
    '--exit-code', '0',
    '--snapshot-hash', 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '--log', logPath,
  ], { encoding: 'utf8' });

  assert.strictEqual(receiptResult.status, 0, receiptResult.stderr);
  const afterReceipt = eventLib.readEvents(logPath);
  assert.strictEqual(afterReceipt.events.length, 2);
  assert.strictEqual(afterReceipt.events[1].event_type, 'verification_receipt');
  assert.strictEqual(afterReceipt.events[1].episode_id, 'receipt-cli');
  assert.strictEqual(afterReceipt.events[1].payload.receipt.state, 'verified');
  console.log('  ✓ records a verified receipt through the CLI');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
