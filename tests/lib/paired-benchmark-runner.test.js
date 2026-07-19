'use strict';

const assert = require('assert');
const Ajv = require('ajv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildComparison,
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
              apiKey: 'private api key in adapter output',
              token: 'private token in adapter output',
              password: 'private password in adapter output',
              headers: 'private headers in adapter output',
              auth: 'private auth in adapter output',
              key: 'private key in adapter output',
              jwt: 'private jwt in adapter output',
              bearer: 'private bearer in adapter output',
              endpoint: 'https://example.test/run?api_key=private-url-key',
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
      assert.ok(!eventText.includes('private api key'));
      assert.ok(!eventText.includes('private token'));
      assert.ok(!eventText.includes('private password'));
      assert.ok(!eventText.includes('private headers'));
      assert.ok(!eventText.includes('private auth'));
      assert.ok(!eventText.includes('private key'));
      assert.ok(!eventText.includes('private jwt'));
      assert.ok(!eventText.includes('private bearer'));
      assert.ok(!eventText.includes('private-url-key'));
      const { events } = readEvents(fixture.logPath);
      assert.strictEqual(events.length, 8);
      assert.ok(events.every(event => event.event_type === 'task_outcome'));
      assert.ok(events.every(event => event.payload.seed === 12345));
      assert.strictEqual(events[0].payload.provider, 'test-provider');
      assert.strictEqual(events[0].payload.input_tokens, 10);
      assert.strictEqual(events[0].payload.cost_usd, 0.01);
      assert.strictEqual(report.suitePath, 'suite.json');
      assert.ok(!report.suitePath.includes('/'));
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
        auth: 'do not keep',
        endpoint: 'https://example.test/run?api_key=do-not-keep',
        top_p: 0.9,
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
      config: { temperature: 0.2, seed: 7, top_p: 0.9 },
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
      assert.ok(costReport.comparison.pairs < costReport.pairs.length);
      assert.strictEqual(costReport.comparison.on.attempted, costReport.comparison.pairs);
      assert.strictEqual(costReport.comparison.off.attempted, costReport.comparison.pairs);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('rejects timeoutMs zero before adapter execution', async () => {
    const fixture = makeFixture();
    try {
      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        adapter: async () => ({ provider: 'unused' }),
        timeoutMs: 0,
      }), /timeoutMs must be from 1/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('requires adapter-proven clean snapshots when isolation is enabled', async () => {
    const fixture = makeFixture();
    const prepared = [];
    const verified = [];
    const executed = [];
    try {
      const adapter = {
        measurementMetadata: {
          provider: 'isolated', model: 'stable', config: { temperature: 0 },
          comparisonFingerprint: `sha256:${'a'.repeat(64)}`,
        },
        async prepareRun(request) {
          prepared.push(request.episodeId);
          const episodeDir = path.join(fixture.dir, request.episodeId);
          fs.mkdirSync(episodeDir, { recursive: true });
          return {
            cwd: episodeDir,
            stateRoot: path.join(fixture.dir, request.episodeId),
            restoredSnapshotHash: request.snapshot.hash,
          };
        },
        async verifySnapshot(request) {
          verified.push(request.episodeId);
          return request.snapshot.hash;
        },
        async run(request) {
          executed.push(request.cwd);
          return {
            provider: 'isolated', model: 'stable', config: { temperature: 0 }, costUsd: 0.01,
            comparisonFingerprint: `sha256:${'a'.repeat(64)}`,
          };
        },
      };
      const report = await runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        snapshot: { id: 'isolated', hash: 'sha256:clean' },
        requireIsolation: true,
        adapter,
      });
      assert.strictEqual(report.environmentIntegrity, 'adapter_attested');
      assert.strictEqual(prepared.length, 4);
      assert.strictEqual(verified.length, 4);
      assert.strictEqual(new Set(executed).size, 4);
      assert.ok(report.results.every(result => result.isolation?.attested === true));

      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        snapshot: { id: 'missing-contract', hash: 'sha256:clean' },
        requireIsolation: true,
        adapter: async () => ({ provider: 'missing' }),
      }), /prepareRun/);

      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        snapshot: { id: 'reused-cwd', hash: 'sha256:clean' },
        requireIsolation: true,
        adapter: {
          async prepareRun(request) {
            return {
              cwd: fixture.dir,
              stateRoot: path.join(fixture.dir, request.episodeId),
              restoredSnapshotHash: request.snapshot.hash,
            };
          },
          async verifySnapshot(request) { return request.snapshot.hash; },
          async run() { return { provider: 'isolated', model: 'stable', config: { temperature: 0 } }; },
        },
      }), /distinct cwd/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('rejects clean baselines and records a deterministic failing baseline before provider execution', async () => {
    const fixture = makeFixture();
    try {
      const isolatedAdapter = {
        measurementMetadata: {
          provider: 'baseline', model: 'model', config: { temperature: 0 },
          comparisonFingerprint: `sha256:${'d'.repeat(64)}`,
        },
        async prepareRun(request) {
          const episodeDir = path.join(
            fixture.dir,
            `${request.episodeId}-${request.baselineAttempt || 'provider'}`
          );
          fs.mkdirSync(episodeDir, { recursive: true });
          fs.rmSync(path.join(episodeDir, 'repaired'), { force: true });
          return {
            cwd: episodeDir,
            stateRoot: path.join(
              fixture.dir,
              `${request.episodeId}-${request.baselineAttempt || 'provider'}-state`
            ),
            restoredSnapshotHash: request.snapshot.hash,
          };
        },
        async verifySnapshot(request) {
          return request.snapshot.hash;
        },
        async run() {
          return {
            provider: 'baseline', model: 'model', config: { temperature: 0 },
            comparisonFingerprint: `sha256:${'d'.repeat(64)}`,
          };
        },
      };
      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        snapshot: { id: 'clean-baseline', hash: 'sha256:clean' },
        requireIsolation: true,
        requireFailingBaseline: true,
        requireComparable: true,
        adapter: isolatedAdapter,
      }), /baseline verification must fail/);

      const failingSuitePath = path.join(fixture.dir, 'failing-baseline-suite.json');
      fs.writeFileSync(failingSuitePath, JSON.stringify({
        suite: 'failing-baseline-suite',
        tasks: [{
          id: 'repair-required',
          prompt: 'repair fixture',
          provenance: { source: 'fixture', incident: 'repair baseline' },
          tags: ['paired'],
          difficulty: 'easy',
          success_criteria: ['verification starts failing and ends passing'],
          verification: {
            argv: ['node', '-e', "process.exit(require('fs').existsSync('repaired') ? 0 : 1)"],
            expected_exit_code: 0,
          },
        }],
      }), 'utf8');
      const repairedAdapter = {
        ...isolatedAdapter,
        async run(request) {
          fs.writeFileSync(path.join(request.cwd, 'repaired'), 'ok');
          return {
            provider: 'baseline', model: 'model', config: { temperature: 0 },
            comparisonFingerprint: `sha256:${'d'.repeat(64)}`,
          };
        },
      };
      const report = await runPairedBenchmark({
        suitePath: failingSuitePath,
        logPath: fixture.logPath,
        snapshot: { id: 'failing-baseline', hash: 'sha256:repair' },
        requireIsolation: true,
        requireFailingBaseline: true,
        requireComparable: true,
        adapter: repairedAdapter,
      });
      assert.ok(report.results.every(result => result.baseline?.outcome === 'failure'));
      assert.ok(report.results.every(result => result.baseline?.attempts.length === 2));
      assert.ok(report.results.every(result => result.outcome === 'success'));
      assert.deepStrictEqual(report.guards, {
        isolation: true,
        comparable: true,
        failingBaseline: true,
      });
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('reports paired wins and success-adjusted cost instead of raw cost alone', async () => {
    const comparison = buildComparison([
      { complete: true, conditions: {
        on: { outcome: 'success', costUsd: 0.30 },
        off: { outcome: 'failure', costUsd: 0.10 },
      } },
      { complete: true, conditions: {
        on: { outcome: 'failure', costUsd: 0.10 },
        off: { outcome: 'success', costUsd: 0.20 },
      } },
      { complete: true, conditions: {
        on: { outcome: 'success', costUsd: 0.10 },
        off: { outcome: 'success', costUsd: 0.40 },
      } },
    ]);
    assert.deepStrictEqual(comparison.pairedOutcomes, { onWins: 1, offWins: 1, ties: 1 });
    assert.strictEqual(comparison.on.costPerSuccessfulTaskUsd, 0.25);
    assert.strictEqual(comparison.off.costPerSuccessfulTaskUsd, 0.35);
  });

  await test('rejects a comparison when provider, model, or generation config drift', async () => {
    const fixture = makeFixture();
    try {
      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        logPath: fixture.logPath,
        snapshot: { id: 'comparison-config' },
        requireComparable: true,
        adapter: {
          measurementMetadata: {
            provider: 'same-provider', model: 'same-model', config: { temperature: 0 },
            comparisonFingerprint: `sha256:${'b'.repeat(64)}`,
          },
          async run({ condition }) {
            return {
              provider: 'same-provider', model: 'same-model',
              config: { temperature: condition === 'on' ? 0 : 1 },
              comparisonFingerprint: `sha256:${'b'.repeat(64)}`,
            };
          },
        },
      }), /metadata differs from its measurementMetadata preflight|configuration differs from the first condition/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await test('rejects unallowlisted settings and requires comparison metadata before execution', async () => {
    const fixture = makeFixture();
    try {
      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        snapshot: { id: 'comparison-metadata' },
        requireComparable: true,
        adapter: async () => ({ provider: 'provider' }),
      }), /measurementMetadata/);

      await assert.rejects(() => runPairedBenchmark({
        suitePath: fixture.suitePath,
        snapshot: { id: 'comparison-unknown-key' },
        requireComparable: true,
        adapter: {
          measurementMetadata: {
            provider: 'provider', model: 'model', config: { tool_choice: 'auto' },
            comparisonFingerprint: `sha256:${'c'.repeat(64)}`,
          },
          async run() { throw new Error('must not run'); },
        },
      }), /unsupported comparison key: tool_choice/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
}

run().finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
