'use strict';

/**
 * Measurement-grade paired-benchmark adapter for the Claude Code CLI.
 *
 * Registered protocol: docs/research/harness-evidence-protocol-2026-08.md
 *
 * OMF ships as a Claude Code plugin, so the manipulated variable here is
 * `--plugin-dir`. Every other input — model, effort, permission mode, budget,
 * timeout, setting sources, MCP configuration — is pinned identically across
 * conditions and hashed into `comparisonFingerprint`, which
 * scripts/lib/paired-benchmark-runner.js requires to match within a pair.
 *
 * Environment profile A (attribution) passes `--setting-sources ""` and
 * `--strict-mcp-config` in BOTH conditions. Without them, other plugins and MCP
 * servers installed on the host leak into the treatment and their context is
 * misattributed to OMF.
 *
 * Usage:
 *   node scripts/run-paired-benchmark.js \
 *     --adapter ./benchmarks/claude-cli-adapter.js \
 *     --suite docs/evals/model-performance-tasks.json \
 *     --require-isolation --require-comparable --require-failing-baseline
 *
 * Configuration (environment variables):
 *   OMF_BENCH_MODEL          pinned full model name (no aliases)
 *   OMF_BENCH_EFFORT         low|medium|high|xhigh|max
 *   OMF_BENCH_ON_CONDITION   on | ablation-hooks-minimal | ablation-hooks-off
 *   OMF_BENCH_PROFILE        attribution
 *   OMF_BENCH_MAX_BUDGET_USD per-episode ceiling
 *   OMF_BENCH_WORK_ROOT      where episode worktrees are materialized
 *   OMF_BENCH_OMF_ROOT       plugin root under test
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildAdapterConfig,
  buildInvocation,
  computeComparisonFingerprint,
  normalizeRuntime,
} = require('./lib/conditions');
const {
  DEFAULT_FIXTURE_ROOT,
  classifyChanges,
  computeCorpusHash,
  computeTreeManifest,
  diffManifest,
  materializeVerifier,
  prepareEpisode,
} = require('./lib/fixtures');

const PROVIDER = 'claude-code-cli';
const REPO_ROOT = path.resolve(__dirname, '..');

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

const PROFILE_ID = env('OMF_BENCH_PROFILE', 'attribution');
const ON_CONDITION = env('OMF_BENCH_ON_CONDITION', 'on');
const OMF_ROOT = path.resolve(env('OMF_BENCH_OMF_ROOT', REPO_ROOT));
const FIXTURE_ROOT = path.resolve(env('OMF_BENCH_FIXTURE_ROOT', DEFAULT_FIXTURE_ROOT));
const WORK_ROOT = path.resolve(env('OMF_BENCH_WORK_ROOT', path.join(os.tmpdir(), 'omf-benchmark')));

const RUNTIME = normalizeRuntime({
  model: env('OMF_BENCH_MODEL', 'claude-sonnet-4-6'),
  effort: env('OMF_BENCH_EFFORT', 'medium'),
  maxBudgetUsd: Number(env('OMF_BENCH_MAX_BUDGET_USD', '5')),
});

/**
 * The CLI version is part of the comparison contract: a mid-run upgrade would
 * silently change the system prompt and tool surface.
 */
function resolveCliVersion() {
  const result = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to resolve claude CLI version: ${result.error?.message || result.stderr || 'unknown error'}`);
  }
  return result.stdout.trim();
}

const CLI_VERSION = resolveCliVersion();
const COMPARISON_FINGERPRINT = computeComparisonFingerprint({
  profileId: PROFILE_ID,
  runtime: RUNTIME,
  cliVersion: CLI_VERSION,
});

/**
 * Pre-run workspace manifests, keyed by prepared cwd, so the post-run scope
 * diff can tell what the agent actually changed.
 */
const preparedManifests = new Map();

/**
 * Directory name for one prepared workspace. Baseline preflight attempts and
 * the provider run must never share a directory; the runner rejects duplicates.
 */
function episodeSlug(episodeId, baselineAttempt) {
  const suffix = baselineAttempt ? `baseline-${baselineAttempt}` : 'provider';
  return `${episodeId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${suffix}`;
}

function readContextTokens(usage = {}) {
  const input = Number(usage.input_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
  // The billed context the model actually saw. Reporting only `input_tokens`
  // would show ~2 tokens for every run and hide the entire harness cost.
  return { input, cacheRead, cacheCreation, total: input + cacheRead + cacheCreation };
}

/**
 * Non-secret per-episode diagnostics, written beside the episode state rather
 * than returned to the runner. The runner's metadata allowlist deliberately
 * excludes free-form fields; this keeps the extra signal without widening it.
 */
function writeEpisodeArtifact(stateRoot, artifact) {
  try {
    fs.mkdirSync(stateRoot, { recursive: true });
    fs.writeFileSync(path.join(stateRoot, 'episode.json'), JSON.stringify(artifact, null, 2));
  } catch {
    // Diagnostics must never fail a measurement run.
  }
}

module.exports = {
  measurementMetadata: {
    provider: PROVIDER,
    model: RUNTIME.model,
    config: buildAdapterConfig(RUNTIME),
    comparisonFingerprint: COMPARISON_FINGERPRINT,
  },

  /**
   * Materialize an isolated workspace and state root for one condition.
   *
   * Called once per baseline preflight attempt and once for the provider run,
   * so every one of them starts from the pristine fixture.
   */
  async prepareRun({ task, snapshot, episodeId, baselineAttempt }) {
    if (!task?.id) throw new Error('prepareRun requires task.id');

    const episodeRoot = path.join(WORK_ROOT, episodeSlug(episodeId, baselineAttempt));
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    fs.rmSync(episodeRoot, { recursive: true, force: true });

    const prepared = prepareEpisode({
      taskId: task.id,
      episodeRoot,
      fixtureRoot: FIXTURE_ROOT,
      // Baseline preflight episodes run no agent, so the verifier can be
      // placed now. Provider episodes get it only after the agent exits.
      includeVerifier: Boolean(baselineAttempt),
    });

    const stateRoot = path.join(episodeRoot, 'state');
    fs.mkdirSync(stateRoot, { recursive: true });

    if (!baselineAttempt) preparedManifests.set(prepared.cwd, prepared.manifest);

    return {
      cwd: prepared.cwd,
      stateRoot,
      // The runner compares this against the requested run-level snapshot.
      restoredSnapshotHash: snapshot.hash,
    };
  },

  /**
   * Independently attest the immutable source snapshot.
   *
   * Recomputed from the checked-in fixture corpus — never echoed from the
   * request, and never derived from a post-run working tree (which is expected
   * to contain the agent's repair).
   */
  async verifySnapshot() {
    return computeCorpusHash(FIXTURE_ROOT);
  },

  async run(request) {
    const {
      task, condition, episodeId, cwd, stateRoot, timeoutMs, remainingCostUsd, seed,
    } = request;

    const conditionId = condition === 'on' ? ON_CONDITION : 'off';

    // Both members of a pair must run under the SAME budget, or the second
    // condition is silently handicapped by whatever the first spent and the
    // pair is still marked complete. The runner's remaining budget shrinks
    // monotonically, so rather than clamping, refuse the episode when the
    // remaining budget can no longer cover a full-price run.
    if (typeof remainingCostUsd === 'number' && Number.isFinite(remainingCostUsd)
        && remainingCostUsd < RUNTIME.maxBudgetUsd) {
      const error = new Error(
        `${episodeId} skipped: remaining run budget $${remainingCostUsd.toFixed(4)} cannot cover the `
        + `per-episode budget $${RUNTIME.maxBudgetUsd.toFixed(4)}; a reduced budget would confound the pair`
      );
      error.code = 'INSUFFICIENT_PAIR_BUDGET';
      throw error;
    }
    const budget = RUNTIME.maxBudgetUsd;

    const invocation = buildInvocation({
      conditionId,
      profileId: PROFILE_ID,
      omfRoot: OMF_ROOT,
      prompt: task.prompt,
      runtime: { ...RUNTIME, maxBudgetUsd: budget, timeoutMs },
      stateRoot,
      seed,
    });

    const startedAt = Date.now();
    const child = spawnSync('claude', invocation.argv, {
      cwd,
      env: {
        ...process.env,
        ...invocation.env,
        OMF_EPISODE_ID: episodeId,
        // Prevent an outer Claude Code session from leaking its identity into
        // the measured child session.
        CLAUDE_CODE_ENTRYPOINT: 'omf-benchmark',
      },
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const durationMs = Date.now() - startedAt;

    if (child.error) {
      const error = new Error(`claude CLI failed for ${episodeId}: ${child.error.message}`);
      error.code = child.error.code;
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(child.stdout);
    } catch {
      throw new Error(`claude CLI did not return parseable JSON for ${episodeId} (exit ${child.status})`);
    }

    const context = readContextTokens(parsed.usage);

    // Contamination control, in this order:
    //   1. diff the workspace against its prepared state
    //   2. record anything the agent left in the episode root
    //   3. only then place the verifier, which did not exist during the run
    const before = preparedManifests.get(cwd) || {};
    const changes = classifyChanges(diffManifest(before, computeTreeManifest(cwd)));
    preparedManifests.delete(cwd);

    const verifier = materializeVerifier({
      taskId: task.id,
      episodeRoot: path.dirname(cwd),
      fixtureRoot: FIXTURE_ROOT,
    });

    if (!changes.clean) {
      // Writing to protected paths means the run cannot be scored: the shipped
      // tests or manifest were altered, so a pass proves nothing.
      const error = new Error(
        `${episodeId} wrote outside the editable scope: ${changes.outOfScope.join(', ')}`
      );
      error.code = 'OUT_OF_SCOPE_WRITE';
      throw error;
    }
    if (verifier.unexpectedEntries.length > 0) {
      const error = new Error(
        `${episodeId} left unexpected entries in the episode root: ${verifier.unexpectedEntries.join(', ')}`
      );
      error.code = 'EPISODE_ROOT_TAMPER';
      throw error;
    }

    writeEpisodeArtifact(stateRoot, {
      filesChanged: changes.changed,
      outOfScopeWrites: changes.outOfScope,
      verifierHash: verifier.verifierHash,
      episodeId,
      taskId: task.id,
      condition: conditionId,
      descriptor: invocation.descriptor,
      cliVersion: CLI_VERSION,
      contextTokens: context,
      outputTokens: Number(parsed.usage?.output_tokens) || 0,
      numTurns: Number(parsed.num_turns) || 0,
      costUsd: Number(parsed.total_cost_usd) || 0,
      durationMs,
      durationApiMs: Number(parsed.duration_api_ms) || 0,
      terminalReason: parsed.terminal_reason || null,
      isError: parsed.is_error === true,
      permissionDenials: Array.isArray(parsed.permission_denials) ? parsed.permission_denials.length : 0,
    });

    return {
      provider: PROVIDER,
      model: RUNTIME.model,
      // Must be byte-identical to measurementMetadata.config: the runner
      // rejects any drift between the preflight declaration and the result.
      config: buildAdapterConfig(RUNTIME),
      comparisonFingerprint: COMPARISON_FINGERPRINT,
      // Full billed context, not the ~2 uncached input tokens.
      inputTokens: context.total,
      outputTokens: Number(parsed.usage?.output_tokens) || 0,
      durationMs,
      costUsd: Number(parsed.total_cost_usd) || 0,
      humanIntervention: false,
    };
  },
};
