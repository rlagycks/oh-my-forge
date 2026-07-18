'use strict';

const assert = require('assert');
const Ajv = require('ajv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runPairedBenchmark,
  sanitizeAdapterMetadata,
} = require('../../scripts/lib/paired-benchmark-runner');
const { readEvents } = require('../../scripts/lib/harness-events');
const reportSchema = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../schemas/paired-benchmark-report.schema.json'),
  'utf8'
));

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

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-benchmark-runner-'));
  const suitePath = path.join(dir, 'suite.json');
  const logPath = path.join(dir, 'events.jsonl');
  fs.writeFileSync(suitePath, JSON.stringify({
    version: 1,
    suite: 'paired-test-suite',
    tasks: [
      {
        id: 'task-a',
        prompt: 'private prompt must never be persisted',
        provenance: { source: 'fixture', incident: 'test' },
        tags: ['paired'],
        difficulty: 'easy',
        success_criteria: ['verification passes'],
        verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
      },
      {
        id: 'task-b',
        prompt: 'private prompt for task b',
        provenance: { source: 'fixture', incident: 'test' },
        tags: ['paired-b'],
        difficulty: 'easy',
        success_criteria: ['verification passes'],
        verification: { argv: ['node', '-e', 'process.exit(0)'], expected_exit_code: 0 },
      },
    ],
  }), 'utf8');
  return { dir, suitePath, logPath };
}

async function run() {
  await test('runs randomized, repeated on/off pairs with shared snapshot metadata', async () => {
    const fixture = makeFixture();
    const calls = [];
    try {
      const report = await runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        repetitions: 2,
        seed: 12345,
        snapshot: {
          id: 'snapshot-1',
          hash: 'sha256:abc123',
          source: 'private source must not be persisted',
        },
        adapter: async (request) => {
          calls.push(request);
          return {
            provider: 'test-provider',
            model: 'test-model',
            config: {
              temperature: 0,
              maxTokens: 100,
              prompt: 'private prompt in adapter output',
              contextPayload: 'private context in adapter output',
            },
            inputTokens: 10,
            outputTokens: 5,
            toolCalls: 2,
            durationMs: 3,
            costUsd: 0.01,
            rawOutput: 'private output must not be persisted',
          };
        },
      });

      assert.strictEqual(report.repetitions, 2);
      assert.strictEqual(report.seed, 12345);
      assert.strictEqual(report.pairs.length, 4);
      assert.strictEqual(report.comparison.pairs, 4);
      assert.strictEqual(report.comparison.on.passed, 4);
      assert.strictEqual(report.comparison.off.passed, 4);
      assert.strictEqual(new Set(report.results.map(result => result.episodeId)).size, 8);
      assert.strictEqual(calls.length, 8);
      assert.ok(calls.every(call => call.snapshot.id === 'snapshot-1'));
      assert.ok(calls.every(call => call.snapshot.hash === 'sha256:abc123'));
      assert.ok(calls.every(call => call.task.id === 'task-a' || call.task.id === 'task-b'));
      const validateReport = new Ajv({ allErrors: true, strict: false }).compile(reportSchema);
      assert.strictEqual(validateReport(report), true, JSON.stringify(validateReport.errors));
      assert.deepStrictEqual(
        report.executionOrder,
        (await runPairedBenchmark({
          suitePath: fixture.suitePath,
          logPath: path.join(fixture.dir, 'events-2.jsonl'),
          repetitions: 2,
          seed: 12345,
          snapshot: { id: 'snapshot-1', hash: 'sha256:abc123' },
          adapter: async () => ({ provider: 'test-provider' }),
        })).executionOrder
      );

      const eventText = fs.readFileSync(fixture.logPath, 'utf8');
      assert.ok(!eventText.includes('private prompt'));
      assert.ok(!eventText.includes('private source'));
      assert.ok(!eventText.includes('private context'));
      assert.ok(!eventText.includes('private output'));
      const { events } = readEvents(fixture.logPath);
      assert.strictEqual(events.length, 8);
      assert.ok(events.every(event => event.event_type === 'task_outcome'));
      assert.ok(events.every(event => event.payload.seed === 12345));
      assert.strictEqual(events[0].payload.provider, 'test-provider');
      assert.strictEqual(events[0].payload.input_tokens, 10);
      assert.strictEqual(events[0].payload.cost_usd, 0.01);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('sanitizes adapter metadata and rejects invalid configuration values', async () => {
    const metadata = sanitizeAdapterMetadata({
      provider: 'provider',
      model: 'model',
      config: {
        temperature: 0.2,
        seed: 7,
        prompt: 'do not keep',
        nested: { context: 'do not keep' },
      },
      inputTokens: 1,
      outputTokens: 2,
      toolCalls: 3,
      durationMs: 4,
      costUsd: 0.5,
      source: 'do not keep',
      output: 'do not keep',
    });
    assert.deepStrictEqual(metadata, {
      provider: 'provider',
      model: 'model',
      config: { temperature: 0.2, seed: 7 },
      inputTokens: 1,
      outputTokens: 2,
      toolCalls: 3,
      durationMs: 4,
      costUsd: 0.5,
    });
    assert.throws(() => sanitizeAdapterMetadata({ inputTokens: -1 }), /inputTokens/);
    assert.throws(() => sanitizeAdapterMetadata({ costUsd: -1 }), /costUsd/);
  });

  await test('records adapter timeouts and stops before the next pair when cost limit is exhausted', async () => {
    const fixture = makeFixture();
    try {
      let calls = 0;
      const timeoutReport = await runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        repetitions: 1,
        seed: 1,
        timeoutMs: 10,
        snapshot: { id: 'snapshot-timeout' },
        adapter: ({ signal }) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ provider: 'slow' }), 100);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        }),
      });
      assert.strictEqual(timeoutReport.comparison.on.passed, 0);
      assert.strictEqual(timeoutReport.results[0].timedOut, true);
      assert.strictEqual(timeoutReport.results[0].outcome, 'failure');

      const costReport = await runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: path.join(fixture.dir, 'cost-events.jsonl'),
        repetitions: 2,
        seed: 2,
        maxCostUsd: 0.5,
        snapshot: { id: 'snapshot-cost' },
        adapter: async () => {
          calls += 1;
          return { provider: 'costly', costUsd: 0.4 };
        },
      });
      assert.strictEqual(costReport.limits.costExceeded, true);
      assert.ok(costReport.results.length < 8);
      assert.strictEqual(calls, 2);
      assert.ok(costReport.pairs.some(pair => pair.complete === false));
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
}

run().finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
