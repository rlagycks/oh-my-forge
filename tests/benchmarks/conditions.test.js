'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CONDITIONS,
  buildAdapterConfig,
  buildInvocation,
  buildStateEnv,
  computeComparisonFingerprint,
  getCondition,
  getProfile,
  normalizeRuntime,
} = require('../../benchmarks/lib/conditions');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

const OMF_ROOT = path.resolve(__dirname, '../..');
const RUNTIME = { model: 'claude-sonnet-4-6', effort: 'medium', maxBudgetUsd: 3 };

console.log('benchmark-conditions');

test('rejects an unknown profile or condition', () => {
  assert.throws(() => getProfile('nope'), /Unknown environment profile/);
  assert.throws(() => getCondition('nope'), /Unknown condition/);
});

test('rejects a model alias so the pinned-revision guarantee holds', () => {
  assert.throws(() => normalizeRuntime({ model: 'sonnet' }), /pinned full model name/);
  assert.throws(() => normalizeRuntime({ model: 'opus' }), /pinned full model name/);
  assert.doesNotThrow(() => normalizeRuntime({ model: 'claude-sonnet-4-6' }));
});

test('rejects invalid budget and timeout', () => {
  assert.throws(() => normalizeRuntime({ ...RUNTIME, maxBudgetUsd: 0 }), /maxBudgetUsd/);
  assert.throws(() => normalizeRuntime({ ...RUNTIME, timeoutMs: 0 }), /timeoutMs/);
});

test('fingerprint is identical across on and off conditions', () => {
  // The fingerprint must cover only what is held constant; the runner uses it
  // to prove both members of a pair ran the same configuration.
  const a = computeComparisonFingerprint({ runtime: RUNTIME, cliVersion: '1.2.3' });
  const b = computeComparisonFingerprint({ runtime: RUNTIME, cliVersion: '1.2.3' });
  assert.strictEqual(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
});

test('fingerprint changes when a pinned runtime input changes', () => {
  const base = computeComparisonFingerprint({ runtime: RUNTIME, cliVersion: '1.2.3' });
  assert.notStrictEqual(base, computeComparisonFingerprint({ runtime: { ...RUNTIME, effort: 'high' }, cliVersion: '1.2.3' }));
  assert.notStrictEqual(base, computeComparisonFingerprint({ runtime: RUNTIME, cliVersion: '1.2.4' }));
  assert.notStrictEqual(base, computeComparisonFingerprint({ runtime: { ...RUNTIME, model: 'claude-opus-4-6' }, cliVersion: '1.2.3' }));
});

test('fingerprint requires a CLI version', () => {
  assert.throws(() => computeComparisonFingerprint({ runtime: RUNTIME }), /cliVersion/);
});

test('off condition loads no plugin; on condition loads exactly OMF', () => {
  const off = buildInvocation({ conditionId: 'off', prompt: 'x', runtime: RUNTIME });
  const on = buildInvocation({ conditionId: 'on', prompt: 'x', runtime: RUNTIME, omfRoot: OMF_ROOT });

  assert.ok(!off.argv.includes('--plugin-dir'), 'control must not load a plugin');
  assert.deepStrictEqual(off.descriptor.pluginDirs, []);
  assert.deepStrictEqual(on.descriptor.pluginDirs, [OMF_ROOT]);
  assert.strictEqual(on.argv.filter(arg => arg === '--plugin-dir').length, 1);
});

test('both conditions pin isolation flags identically', () => {
  // Profile A: without these, other installed plugins and MCP servers leak in
  // and their context is misattributed to OMF.
  for (const conditionId of ['off', 'on']) {
    const { argv } = buildInvocation({ conditionId, prompt: 'x', runtime: RUNTIME, omfRoot: OMF_ROOT });
    assert.ok(argv.includes('--strict-mcp-config'), `${conditionId} must pin --strict-mcp-config`);
    const index = argv.indexOf('--setting-sources');
    assert.notStrictEqual(index, -1, `${conditionId} must pin --setting-sources`);
    assert.strictEqual(argv[index + 1], '', `${conditionId} must pass empty setting sources`);
  }
});

test('plugin dirs are the only argv difference between on and off', () => {
  const strip = argv => {
    const result = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--plugin-dir') { i += 1; continue; }
      result.push(argv[i]);
    }
    return result;
  };
  const off = buildInvocation({ conditionId: 'off', prompt: 'x', runtime: RUNTIME });
  const on = buildInvocation({ conditionId: 'on', prompt: 'x', runtime: RUNTIME, omfRoot: OMF_ROOT });
  assert.deepStrictEqual(strip(on.argv), strip(off.argv));
});

test('ablation conditions differ only by hook environment', () => {
  const on = buildInvocation({ conditionId: 'on', prompt: 'x', runtime: RUNTIME, omfRoot: OMF_ROOT });
  const minimal = buildInvocation({ conditionId: 'ablation-hooks-minimal', prompt: 'x', runtime: RUNTIME, omfRoot: OMF_ROOT });
  assert.deepStrictEqual([...minimal.argv], [...on.argv]);
  assert.strictEqual(on.env.ECC_HOOK_PROFILE, 'standard');
  assert.strictEqual(minimal.env.ECC_HOOK_PROFILE, 'minimal');
  assert.strictEqual(CONDITIONS['ablation-hooks-off'].hookEnv.ECC_DISABLED_HOOKS, '*');
});

test('pinned runtime values reach the CLI arguments', () => {
  const { argv } = buildInvocation({ conditionId: 'off', prompt: 'do the thing', runtime: { ...RUNTIME, maxBudgetUsd: 2.5 } });
  assert.strictEqual(argv[argv.indexOf('--model') + 1], 'claude-sonnet-4-6');
  assert.strictEqual(argv[argv.indexOf('--effort') + 1], 'medium');
  assert.strictEqual(argv[argv.indexOf('--max-budget-usd') + 1], '2.5');
  assert.strictEqual(argv[argv.indexOf('--output-format') + 1], 'json');
  assert.strictEqual(argv[argv.indexOf('-p') + 1], 'do the thing');
});

test('rejects an empty prompt and a non-plugin omfRoot', () => {
  assert.throws(() => buildInvocation({ conditionId: 'off', prompt: '  ', runtime: RUNTIME }), /prompt/);
  assert.throws(
    () => buildInvocation({ conditionId: 'on', prompt: 'x', runtime: RUNTIME, omfRoot: os.tmpdir() }),
    /not a Claude Code plugin/
  );
  assert.throws(() => buildInvocation({ conditionId: 'on', prompt: 'x', runtime: RUNTIME }), /requires omfRoot/);
});

test('state env redirects OMF writes under the episode state root', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-cond-state-'));
  try {
    const env = buildStateEnv(stateRoot);
    for (const value of Object.values(env)) {
      assert.ok(value.startsWith(fs.realpathSync(stateRoot)) || value.startsWith(stateRoot), `${value} must live under stateRoot`);
    }
    assert.ok(fs.existsSync(env.OMF_EVIDENCE_STORE), 'directory-valued state paths must exist');
    assert.ok(env.OMF_HARNESS_EVENT_LOG.endsWith('harness-events.jsonl'));
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('adapter config exposes only runner-allowlisted keys', () => {
  const config = buildAdapterConfig(RUNTIME, 42);
  assert.deepStrictEqual(Object.keys(config).sort(), ['reasoningEffort', 'seed']);
  assert.strictEqual(config.seed, 42);
  // A non-integer seed must not silently appear.
  assert.ok(!('seed' in buildAdapterConfig(RUNTIME, undefined)));
});

test('adapter config omits timeoutMs so preflight and result cannot diverge', () => {
  // The runner enforces its own per-episode timeout; declaring one here would
  // differ from what was applied and trip its equality check.
  assert.ok(!('timeoutMs' in buildAdapterConfig(RUNTIME)));
  assert.deepStrictEqual(
    buildAdapterConfig(RUNTIME),
    buildAdapterConfig({ ...RUNTIME, timeoutMs: 60000 })
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
