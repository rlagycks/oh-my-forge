# OMF Harness Benchmark

Measures what loading the `oh-my-forge` **plugin** does to task outcome quality
and at what context, latency, and cost overhead.

Registered protocol: [`docs/research/harness-evidence-protocol-2026-08.md`](../docs/research/harness-evidence-protocol-2026-08.md).
Read it before running anything — it fixes the hypotheses and decision margins,
and results produced outside it are not publishable as OMF claims.

## Why the isolation flags are not optional

OMF loads as a Claude Code plugin, so the manipulated variable is
`--plugin-dir`. Everything else must be pinned identically in both conditions.

Measured 2026-08-01 with `claude -p "hi" --model sonnet` in an empty repository
(context = `input + cache_read + cache_creation`):

| Configuration | Context tokens |
|---|---|
| `--safe-mode` | 20,362 |
| `--setting-sources "" --strict-mcp-config` (control) | 24,371 |
| control + `--plugin-dir <omf>` (treatment) | **38,518** |
| default invocation on the author's machine | 59,719 |

On that machine the **other installed plugins and MCP servers cost more context
(21,201) than OMF itself (14,147)**. Drop the isolation flags and you attribute
other vendors' context to OMF. `benchmarks/lib/conditions.js` enforces
them in both conditions and a unit test asserts that plugin dirs are the only
argv difference.

Context assembly is deterministic — three repetitions returned byte-identical
counts — so context size needs no repetition. Task outcome does.

## Layout

```
benchmarks/
  claude-cli-adapter.js       measurement-grade adapter for the Claude Code CLI
  fixtures/<task-id>/
    task.json                 metadata, merged into the generated suite
    workspace/                the seeded-defect project the agent sees
    reference/                overlay files that repair the defect (preflight only)
    verify.js                 verifier, kept out of workspace/
```

A prepared episode looks like:

```
<episodeRoot>/
  verify.js       <- materialized only AFTER the agent exits
  workspace/      <- the agent's cwd
  state/          <- OMF writes redirected here
```

Verification runs `node ../verify.js` with cwd set to the workspace.

## Threat model, stated plainly

**The agent under test is assumed non-adversarial.** It is solving a coding
task, not attacking the harness.

This matters because **Claude Code does not enforce a filesystem boundary at the
working directory.** Verified against the live CLI: with
`--permission-mode bypassPermissions` a write to `../` succeeds, and under
`--permission-mode acceptEdits` the agent declined by its own judgement with
`permission_denials: 0` — a behavioural choice, not an enforced block. Directory
placement is therefore **not** a sandbox and is never described as one here.

What is done instead is **contamination detection**:

1. **The verifier does not exist on disk while the agent runs.** It is
   materialized after the agent exits, so ordinary exploration cannot find it.
2. **Anything left in the episode root is a tamper signal.** Entries other than
   `workspace/` and `state/` fail the episode with `EPISODE_ROOT_TAMPER`,
   including a pre-planted `verify.js` — the authoritative fixture copy always
   overwrites it.
3. **The workspace is hashed before and after.** Changes to protected paths
   (`test/`, `package.json`) fail the episode with `OUT_OF_SCOPE_WRITE`. This is
   the runner-level version of the per-verifier scope checks, so deleting the
   shipped tests is caught even if a verifier forgets to look.

### What this does not stop

A determined search of the filesystem for the checked-in fixtures under
`benchmarks/fixtures/`. Nothing short of OS-level sandboxing would, and that
would require running the agent under an API key rather than the OAuth
subscription that actual OMF users have — a different product, measured under
different conditions. If an adversarial setting is ever needed, the adapter
contract is the place to plug in a sandboxed runner.

The load-bearing defence is therefore verifier *construction*, not secrecy: a
verifier that can be satisfied without solving the task is broken whether or not
it is hidden. Each verifier:

- **Ignores the workspace test files** and re-runs its own copy of the public
  cases, so deleting or weakening the shipped tests gains nothing.
- Adds **generalization cases absent from the shipped tests**, so a lookup table
  keyed on the visible cases fails.
- Adds **availability checks** where relevant, so an over-blocking "repair"
  (for example, rejecting every request path) fails.
- Asserts the module's **public contract**.

## Running

### 1. Preflight the corpus

Every task must fail on a clean checkout and pass with its reference fix. A task
that already passes measures nothing — this is the ceiling-effect defect that
bars `docs/evals/golden-tasks.json` from model-performance scoring.

```bash
node benchmarks/validate-fixtures.js
```

### 2. Regenerate the suite

`docs/evals/model-performance-tasks.json` is derived from the fixtures and must
never be hand-edited.

```bash
node benchmarks/build-suite.js
node benchmarks/build-suite.js --check   # CI
```

### 3. Run a paired benchmark

```bash
OMF_BENCH_MODEL=claude-sonnet-4-6 \
OMF_BENCH_MAX_BUDGET_USD=3 \
node scripts/run-paired-benchmark.js \
  --adapter ./benchmarks/claude-cli-adapter.js \
  --suite docs/evals/model-performance-tasks.json \
  --snapshot-id corpus-2026-08-01 \
  --snapshot-hash "$(node -e "console.log(require('./benchmarks/lib/fixtures').computeCorpusHash())")" \
  --repetitions 3 --seed 42 \
  --timeout-ms 420000 --max-cost-usd 40 \
  --require-isolation --require-comparable --require-failing-baseline \
  --log /tmp/omf-paired-events.jsonl --json
```

The three `--require-*` flags are mandatory for any result used in a claim.
Without `--require-isolation` the report is `environmentIntegrity: "unverified"`.

Add `--checkpoint` to any run you care about. A pilot is 90 provider episodes
and tens of dollars, and a run that hits its cost ceiling — or any adapter
error under `--require-comparable`, which the runner turns into a thrown
`COMPARISON_CONFIG_MISMATCH` — aborts before a report is written. Without a
ledger every pair that already completed is lost.

```bash
node scripts/run-paired-benchmark.js ... --checkpoint /tmp/pilot.jsonl
# aborted part-way? continue without paying for finished pairs again:
node scripts/run-paired-benchmark.js ... --checkpoint /tmp/pilot.jsonl --resume /tmp/pilot.jsonl
```

Each pair is appended as it lands, so an abort leaves the finished ones on
disk, and the CLI prints the resume command on failure. A resume refuses
outright if the seed, repetitions, suite, snapshot, comparison fingerprint or
guard flags differ, because merging pairs across different configurations
would pool incomparable data. Only complete pairs are reused; incomplete and
skipped ones are re-run. The report carries a `resume` block with how many
pairs were reused versus executed, and resumed pairs do not count against the
new run's cost ceiling — they were paid for already.

### 4. Analyze it

The runner emits raw pair counts. A bare `successRateDelta` is not a result:
turn it into intervals and a verdict before quoting anything.

```bash
node benchmarks/analyze.js --report run.json
node benchmarks/analyze.js --report run.json --json > analysis.json
```

The analysis exits non-zero only on a `degradation` verdict, so CI can gate on
it. `inconclusive` is a legitimate outcome and exits zero.

Key properties, all enforced by tests:

- **Clusters are tasks, not repetitions.** Three runs of one task are not three
  independent observations; treating them as such understates the standard error
  by up to ~3x ([Miller, arXiv 2411.00640](https://arxiv.org/abs/2411.00640)).
  Every interval resamples whole tasks and each task carries equal weight.
- **No verdict below 15 tasks.** With one task the bootstrap collapses to a
  zero-width interval that reads as certainty; the analysis reports
  `insufficient_data` instead.
- **Analysis parameters are registered.** `--margin-pp`, `--min-clusters`,
  `--samples` and `--seed` all change the verdict, so overriding any of them
  sets `protocolCompliant: false`, drops the protocol citation, prints a
  `NOT A PRE-REGISTERED RESULT` banner and forces exit 0. Sample counts below
  1000 are rejected outright — at `samples: 1` the interval degenerates to a
  point and can flip `inconclusive` to `improvement`.
- **A pair is funded before it starts.** The full cost of both members is
  reserved up front, so a run that cannot afford the pair stops without having
  paid for half of it. Clamping the second member instead would produce a
  "complete" pair whose halves ran on different budgets.
- **Directional claims are corroborated.** If the interval says
  improvement/degradation but the task-level sign test does not reach p < 0.05,
  the output says so explicitly.
- **Efficiency is gated on quality.** Token, cost and latency ratios are marked
  uninterpretable unless quality is non-inferior — a condition that fails fast
  otherwise looks efficient. Cost is reported as **cost-of-pass** (cost per
  successful task), undefined when a condition never succeeds.
- **Incomplete pairs are excluded, never imputed.**
- **Deterministic.** Same report plus same seed reproduces the same interval.

Also reported: exact McNemar over pairs (labelled anti-conservative, for
comparability with the literature), pass@k and pass^k via the unbiased Chen et
al. estimator, and breakdowns by stratum, difficulty, and OMF-neutrality.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `OMF_BENCH_MODEL` | `claude-sonnet-4-6` | Must be a pinned full name; aliases are rejected |
| `OMF_BENCH_EFFORT` | `medium` | Identical in both conditions |
| `OMF_BENCH_ON_CONDITION` | `on` | Or `ablation-hooks-minimal` / `ablation-hooks-off` |
| `OMF_BENCH_PROFILE` | `attribution` | Only profile A exists today |
| `OMF_BENCH_MAX_BUDGET_USD` | `5` | Per-episode ceiling |
| `OMF_BENCH_WORK_ROOT` | `$TMPDIR/omf-benchmark` | Episode worktrees |
| `OMF_BENCH_OMF_ROOT` | repository root | Plugin under test |

Budget note: the plugin condition pays ~14k extra context tokens before the
agent does any work. A per-episode ceiling tuned to the control condition will
abort the treatment with `budget_exhausted` and silently bias the comparison —
this happened during development at `--max-budget-usd 0.30`.

## Adding a fixture

1. Create `benchmarks/fixtures/<task-id>/` with `task.json`, `workspace/`,
   `reference/`, and `verify.js`.
2. Seed a defect the shipped public tests actually catch, so the task is fair.
3. Write the verifier to the properties above. Never place it inside
   `workspace/`.
4. Set `stratum` (`seeded-defect`, `long-horizon`, `brownfield-ambiguous`,
   `security-regression`, `failure-replay`) and `omf_neutral`.
   **The neutral stratum is mandatory** — without tasks unrelated to OMF's
   feature set, the corpus cannot rule out a corpus-favors-OMF bias.
5. No secrets, customer data, hostnames, usernames, or absolute paths.
6. Run the preflight and regenerate the suite.

## Current status

| Item | State |
|---|---|
| Protocol registered | yes |
| Corpus size | **15 tasks — meets the registered pilot minimum; release-grade needs ≥30** |
| Strata covered | all five |
| Adapter | implemented, measurement-grade, executed end-to-end |
| Statistical analysis (cluster bootstrap, exact tests, cost-of-pass) | implemented |
| Packaging | source-checkout tooling; excluded from the published plugin |
| Process/trajectory scoring | **not implemented — Phase 4** |
| Pilot run | **not started** |

**No harness-effectiveness claim has been made from this directory yet** — no
pilot has been run. The machinery to make one honestly now exists.

### Corpus composition

15 tasks, every one verified baseline-failing and reference-passing.

| Stratum | Tasks |
|---|---|
| `seeded-defect` | csv-quoted-fields, semver-compare, lru-cache-eviction, iso-duration-parse |
| `security-regression` | static-path-traversal, prototype-pollution-merge, log-secret-redaction |
| `long-horizon` | event-bus-lifecycle, retry-backoff-policy, cursor-pagination |
| `brownfield-ambiguous` | config-precedence, interval-overlap-convention, money-rounding-consistency |
| `failure-replay` | pipeline-skipped-step-status, event-log-legacy-compat |

Difficulty: 8 medium, 7 hard. **13 of 15 are OMF-neutral** — unrelated to
anything OMF does — which is what lets the corpus rule out a
corpus-favours-OMF bias. The two non-neutral tasks are the `failure-replay`
pair, which model failure modes OMF instruments (false-normal completion,
event-log backward compatibility); they are marked `omf_neutral: false` so
results can be reported with and without them.

Four tasks span multiple source modules, so a repair cannot be a single-file
edit. Three tasks are brownfield: the specification lives in the workspace — a
`docs/CONFIG.md`, a sibling helper's convention — not in the prompt.

### Plumbing verification (2026-08-01)

One paired episode was executed to prove the pipeline, not to measure anything.
`csv-quoted-fields`, 1 repetition, seed 42, `claude-sonnet-4-6`, profile A:

- `guards: {isolation: true, comparable: true, failingBaseline: true}`
- `environmentIntegrity: "adapter_attested"`
- Both conditions attested the same corpus snapshot hash; execution order was
  randomized from the seed; both baseline preflights failed deterministically
  before the provider started.
- Context: `on` 110,577 vs `off` 89,536 input tokens (+23.5%) on a task where
  the agent actually did work.

**This is n=1 and is not a result.** A single pair cannot distinguish a harness
effect from provider sampling noise, and neither condition's outcome should be
cited. It is recorded only as evidence that the guards, isolation, snapshot
attestation, and metadata contract execute correctly against a live provider.

An earlier attempt was **rejected by the runner** with `adapter result metadata
differs from its measurementMetadata preflight` — the adapter declared a config
at load time that did not match what it returned. The guard worked as designed;
the fix was to drop `timeoutMs` and the per-run seed from the declared config.

## Known limitations

- `environmentIntegrity: "adapter_attested"` is an adapter attestation, not an
  independent isolation proof.
- Profile A loads OMF as a plugin only. `CLAUDE.md`, `.claude/rules/`, and
  `.claude/ontology/` are absent from the neutral fixtures, so the
  project-configuration layer is **not** measured.
- Tool-call counts are not collected; `--output-format json` reports turns but
  not tool invocations. Per-episode diagnostics land in `<stateRoot>/episode.json`.
- Cost comes from the provider's own `total_cost_usd` and inherits its
  accounting, including subscription-versus-API differences.
- Absolute context size is model-dependent; never compare it across models.
