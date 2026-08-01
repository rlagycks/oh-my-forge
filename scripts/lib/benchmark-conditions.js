'use strict';

/**
 * Condition matrix for OMF harness benchmarking.
 *
 * OMF ships as a Claude Code plugin, so the manipulated variable is plugin
 * loading (`--plugin-dir`), not a file copy into a config directory.
 *
 * Registered protocol: docs/research/harness-evidence-protocol-2026-08.md
 *
 * Profile A (attribution) pins every other environment input so exactly one
 * variable separates control from treatment. Without `--setting-sources ""`
 * and `--strict-mcp-config`, other installed plugins and MCP servers leak into
 * the measurement and their context is misattributed to OMF.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENVIRONMENT_PROFILES = Object.freeze({
  // Isolate OMF: no user/project/local settings, no MCP servers from any
  // other source. The only customization that can load is an explicit
  // --plugin-dir.
  attribution: Object.freeze({
    id: 'attribution',
    settingSources: '',
    strictMcpConfig: true,
    // Third-party plugins are never loaded under this profile.
    baselinePluginDirs: Object.freeze([]),
  }),
});

const DEFAULT_PROFILE = 'attribution';

/**
 * Hook-control env vars are the manipulated variable for ablation conditions
 * and are therefore excluded from the comparison fingerprint.
 */
const CONDITIONS = Object.freeze({
  off: Object.freeze({
    id: 'off',
    harnessEnabled: false,
    loadOmfPlugin: false,
    hookEnv: Object.freeze({}),
    role: 'control',
  }),
  on: Object.freeze({
    id: 'on',
    harnessEnabled: true,
    loadOmfPlugin: true,
    hookEnv: Object.freeze({ ECC_HOOK_PROFILE: 'standard' }),
    role: 'treatment',
  }),
  'ablation-hooks-minimal': Object.freeze({
    id: 'ablation-hooks-minimal',
    harnessEnabled: true,
    loadOmfPlugin: true,
    hookEnv: Object.freeze({ ECC_HOOK_PROFILE: 'minimal' }),
    role: 'diagnostic',
  }),
  'ablation-hooks-off': Object.freeze({
    id: 'ablation-hooks-off',
    harnessEnabled: true,
    loadOmfPlugin: true,
    hookEnv: Object.freeze({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: '*' }),
    role: 'diagnostic',
  }),
});

/**
 * Runtime settings that MUST be identical across every condition in a
 * comparison. These are exactly the fields hashed into the fingerprint.
 */
const RUNTIME_FIELDS = Object.freeze([
  'model',
  'effort',
  'permissionMode',
  'outputFormat',
  'timeoutMs',
  'maxBudgetUsd',
  'allowedTools',
]);

const DEFAULT_RUNTIME = Object.freeze({
  // Never an alias: aliases silently re-point across releases.
  model: 'claude-sonnet-4-6',
  effort: 'medium',
  permissionMode: 'bypassPermissions',
  outputFormat: 'json',
  timeoutMs: 900000,
  maxBudgetUsd: 5,
  allowedTools: null,
});

/**
 * OMF state that must be redirected per episode so one run cannot observe or
 * corrupt another. Values are file or directory paths under the episode's
 * stateRoot.
 */
const STATE_ENV_LAYOUT = Object.freeze({
  OMF_HARNESS_EVENT_LOG: 'harness-events.jsonl',
  OMF_ONTOLOGY_OBSERVATION_LOG: 'ontology-observations.jsonl',
  OMF_EVIDENCE_STORE: 'evidence',
  ECC_SESSION_RECORDING_DIR: 'sessions',
  ECC_MCP_HEALTH_STATE_PATH: 'mcp-health.json',
  CLAUDE_RCA_BUNDLE_DIR: 'rca',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getProfile(profileId = DEFAULT_PROFILE) {
  const profile = ENVIRONMENT_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown environment profile: ${profileId}. Known: ${Object.keys(ENVIRONMENT_PROFILES).join(', ')}`);
  }
  return profile;
}

function getCondition(conditionId) {
  const condition = CONDITIONS[conditionId];
  if (!condition) {
    throw new Error(`Unknown condition: ${conditionId}. Known: ${Object.keys(CONDITIONS).join(', ')}`);
  }
  return condition;
}

function normalizeRuntime(runtime = {}) {
  if (!isPlainObject(runtime)) throw new Error('runtime must be an object');

  const normalized = { ...DEFAULT_RUNTIME, ...runtime };

  if (typeof normalized.model !== 'string' || normalized.model.trim() === '') {
    throw new Error('runtime.model must be a non-empty string');
  }
  // Aliases resolve to different revisions over time, which silently breaks the
  // "same model in both conditions" guarantee the fingerprint is meant to hold.
  if (!/-\d/.test(normalized.model)) {
    throw new Error(`runtime.model must be a pinned full model name, not an alias: ${normalized.model}`);
  }
  if (!Number.isInteger(normalized.timeoutMs) || normalized.timeoutMs < 1) {
    throw new Error('runtime.timeoutMs must be a positive integer');
  }
  if (typeof normalized.maxBudgetUsd !== 'number' || !Number.isFinite(normalized.maxBudgetUsd) || normalized.maxBudgetUsd <= 0) {
    throw new Error('runtime.maxBudgetUsd must be a positive number');
  }
  if (normalized.allowedTools !== null && !Array.isArray(normalized.allowedTools)) {
    throw new Error('runtime.allowedTools must be null or an array');
  }

  return Object.freeze({
    ...normalized,
    allowedTools: normalized.allowedTools === null ? null : Object.freeze([...normalized.allowedTools]),
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The fingerprint covers everything that must be equal across conditions and
 * deliberately excludes plugin dirs and hook env — those ARE the treatment.
 */
function computeComparisonFingerprint({ profileId = DEFAULT_PROFILE, runtime, cliVersion } = {}) {
  const profile = getProfile(profileId);
  const normalizedRuntime = normalizeRuntime(runtime);
  if (typeof cliVersion !== 'string' || cliVersion.trim() === '') {
    throw new Error('cliVersion must be a non-empty string');
  }

  const payload = {
    profile: profile.id,
    settingSources: profile.settingSources,
    strictMcpConfig: profile.strictMcpConfig,
    baselinePluginDirs: [...profile.baselinePluginDirs],
    cliVersion,
    runtime: RUNTIME_FIELDS.reduce((acc, field) => ({ ...acc, [field]: normalizedRuntime[field] }), {}),
  };

  const digest = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
  return `sha256:${digest}`;
}

/**
 * Adapter `config` metadata is validated against the runner's allowlist
 * (SAFE_CONFIG_KEYS). Only scalar generation/runtime settings survive, so this
 * returns exactly the allowlisted subset.
 */
function buildAdapterConfig(runtime, seed) {
  const normalized = normalizeRuntime(runtime);
  // Deliberately excludes timeoutMs: the runner enforces its own per-episode
  // timeout, so declaring one here can diverge from what was actually applied
  // and trip the runner's preflight-vs-result equality check.
  const config = { reasoningEffort: normalized.effort };
  if (Number.isInteger(seed)) config.seed = seed;
  return Object.freeze(config);
}

function buildStateEnv(stateRoot, { create = true } = {}) {
  if (typeof stateRoot !== 'string' || stateRoot.trim() === '') {
    throw new Error('stateRoot must be a non-empty string');
  }
  const root = path.resolve(stateRoot);
  if (create) fs.mkdirSync(root, { recursive: true });

  return Object.entries(STATE_ENV_LAYOUT).reduce((env, [key, relative]) => {
    const target = path.join(root, relative);
    // Directory-valued entries must exist before a hook writes into them.
    if (create && !relative.includes('.')) fs.mkdirSync(target, { recursive: true });
    return { ...env, [key]: target };
  }, {});
}

/**
 * Build the exact `claude` invocation for one condition.
 *
 * @returns {{argv: string[], env: object, descriptor: object}}
 */
function buildInvocation({
  conditionId,
  profileId = DEFAULT_PROFILE,
  omfRoot,
  prompt,
  runtime,
  stateRoot,
  seed,
  createStateDirs = true,
} = {}) {
  const condition = getCondition(conditionId);
  const profile = getProfile(profileId);
  const normalizedRuntime = normalizeRuntime(runtime);

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('prompt must be a non-empty string');
  }
  if (condition.loadOmfPlugin && (typeof omfRoot !== 'string' || omfRoot.trim() === '')) {
    throw new Error(`condition ${condition.id} requires omfRoot`);
  }

  const resolvedOmfRoot = condition.loadOmfPlugin ? path.resolve(omfRoot) : null;
  if (resolvedOmfRoot && !fs.existsSync(path.join(resolvedOmfRoot, '.claude-plugin', 'plugin.json'))) {
    throw new Error(`omfRoot is not a Claude Code plugin (missing .claude-plugin/plugin.json): ${resolvedOmfRoot}`);
  }

  const pluginDirs = [
    ...profile.baselinePluginDirs,
    ...(resolvedOmfRoot ? [resolvedOmfRoot] : []),
  ];

  const argv = [
    '-p', prompt,
    '--model', normalizedRuntime.model,
    '--effort', normalizedRuntime.effort,
    '--permission-mode', normalizedRuntime.permissionMode,
    '--output-format', normalizedRuntime.outputFormat,
    '--max-budget-usd', String(normalizedRuntime.maxBudgetUsd),
    // Identical in both conditions: this is the isolation that makes the
    // comparison attributable to OMF rather than to the host machine.
    '--setting-sources', profile.settingSources,
    ...(profile.strictMcpConfig ? ['--strict-mcp-config'] : []),
    // Session transcripts are not an input to scoring and would otherwise
    // accumulate per episode.
    '--no-session-persistence',
    ...pluginDirs.flatMap(dir => ['--plugin-dir', dir]),
    ...(normalizedRuntime.allowedTools ? ['--allowedTools', ...normalizedRuntime.allowedTools] : []),
  ];

  const stateEnv = stateRoot ? buildStateEnv(stateRoot, { create: createStateDirs }) : {};

  const env = Object.freeze({
    ...stateEnv,
    ...condition.hookEnv,
  });

  return Object.freeze({
    argv: Object.freeze(argv),
    env,
    descriptor: Object.freeze({
      condition: condition.id,
      role: condition.role,
      profile: profile.id,
      harnessEnabled: condition.harnessEnabled,
      pluginDirs: Object.freeze(pluginDirs),
      model: normalizedRuntime.model,
      seed: Number.isInteger(seed) ? seed : null,
    }),
  });
}

module.exports = {
  CONDITIONS,
  DEFAULT_PROFILE,
  DEFAULT_RUNTIME,
  ENVIRONMENT_PROFILES,
  RUNTIME_FIELDS,
  STATE_ENV_LAYOUT,
  buildAdapterConfig,
  buildInvocation,
  buildStateEnv,
  computeComparisonFingerprint,
  getCondition,
  getProfile,
  normalizeRuntime,
};
