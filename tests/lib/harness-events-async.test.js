'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EVENT_TYPES,
  appendEventAsync,
  createEvent,
  readEvents,
} = require('../../scripts/lib/harness-events');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

function event(index) {
  return createEvent({
    eventType: EVENT_TYPES.TASK_OUTCOME,
    source: 'async-test',
    episodeId: `async-${index}`,
    payload: { outcome: 'success', taskId: `task-${index}` },
  });
}

(async () => {
  await test('concurrent async appends preserve every complete JSONL record', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-async-append-'));
    const logPath = path.join(dir, 'events.jsonl');
    try {
      const results = await Promise.all(
        Array.from({ length: 24 }, (_, index) => appendEventAsync(event(index), logPath))
      );
      assert.strictEqual(results.filter(Boolean).length, 24);
      const report = readEvents(logPath);
      assert.strictEqual(report.events.length, 24);
      assert.strictEqual(report.malformedRecords, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('async rotation enforces retention', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-async-rotation-'));
    const logPath = path.join(dir, 'events.jsonl');
    try {
      const options = { maxBytes: 200, retention: 2 };
      for (let index = 0; index < 5; index += 1) {
        await appendEventAsync(createEvent({
          eventType: EVENT_TYPES.TASK_OUTCOME,
          source: 'async-test',
          episodeId: `async-${index}`,
          payload: { outcome: 'success', taskId: `task-${index}`, padding: 'x'.repeat(80) },
        }), logPath, options);
      }
      assert.strictEqual(fs.existsSync(`${logPath}.1`), true);
      assert.strictEqual(fs.existsSync(`${logPath}.2`), true);
      assert.strictEqual(fs.existsSync(`${logPath}.3`), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('async append skips rotation while another process owns a fresh lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-async-lock-'));
    const logPath = path.join(dir, 'events.jsonl');
    try {
      fs.writeFileSync(logPath, `${JSON.stringify(event(0))}\n`, 'utf8');
      fs.writeFileSync(`${logPath}.lock`, 'fresh-owner', 'utf8');
      const result = await appendEventAsync(event(1), logPath, { maxBytes: 1, retention: 1 });
      assert.strictEqual(result.rotationSkipped, true);
      assert.strictEqual(readEvents(logPath).events.length, 2);
      fs.unlinkSync(`${logPath}.lock`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('async append recovers a stale lock without deleting the replacement lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-async-stale-'));
    const logPath = path.join(dir, 'events.jsonl');
    try {
      fs.writeFileSync(logPath, `${JSON.stringify(event(0))}\n`, 'utf8');
      const lockPath = `${logPath}.lock`;
      fs.writeFileSync(lockPath, 'stale-owner', 'utf8');
      const old = new Date(Date.now() - 60 * 1000);
      fs.utimesSync(lockPath, old, old);
      const result = await appendEventAsync(event(1), logPath, { maxBytes: 1, retention: 1 });
      assert.strictEqual(result.rotated, true);
      assert.strictEqual(fs.existsSync(lockPath), false);
      assert.strictEqual(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 1);
      assert.strictEqual(fs.readFileSync(`${logPath}.1`, 'utf8').trim().split('\n').length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
