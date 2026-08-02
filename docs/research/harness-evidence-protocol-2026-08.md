# OMF Harness Evidence Protocol (pre-registered, 2026-08-01)

This document is **pre-registered**. It fixes the hypotheses, conditions, metrics,
and decision margins *before* any provider run is scored. Changing a decision
margin after seeing results overfits the protocol to the harness and voids the
claim. If a margin must change, record the change, the reason, and the date in
[Protocol amendments](#protocol-amendments), and re-run affected comparisons.

Status: Phase 0 complete. Phases 1–2 in progress. No provider result has been
scored under this protocol yet.

## 1. Question under test

OMF ships as a **Claude Code plugin**. The unit under test is therefore not a set
of files copied into `~/.claude`, but the plugin as a user would actually load
it. Everything below is defined in terms of plugin loading.

> Does loading the `oh-my-forge` plugin change task outcome quality, and at what
> context/latency/cost overhead, holding the model and every other environment
> variable fixed?

Following [Harness-Bench (arXiv 2605.27922)](https://arxiv.org/html/2605.27922v1),
capability is reported at the **model-harness configuration level**. No claim in
this protocol may be stated as a property of a base model, nor as a property of
OMF independent of the model it was measured with.

## 2. Environment profiles

A measured context delta is meaningless unless the rest of the environment is
pinned. Two different questions exist, and they must never be mixed in one
comparison.

| Profile | Question | Control | Treatment |
|---|---|---|---|
| **A — attribution** | What does OMF *alone* cost and contribute? | No customizations: `--setting-sources ""`, `--strict-mcp-config`, no plugin dirs | Control **+ `--plugin-dir <omf>`** and nothing else |
| **B — deployment** | What does *adding* OMF to a realistic installed environment do? | A fixed, declared set of other plugins/MCP servers | Same set **+ OMF** |

**Profile A is the registered profile for the first pilot.** Profile B is
deferred; it requires a declared and version-pinned third-party plugin set, which
does not exist yet.

### 2.1 Why isolation is mandatory (measured)

Measured 2026-08-01, `claude -p "hi" --model sonnet --output-format json`, in an
empty git repository with no `CLAUDE.md`. Context = `input + cache_read +
cache_creation` input tokens.

| Configuration | Context tokens | Delta |
|---|---|---|
| `--safe-mode` (all customization off) | 20,362 | reference floor |
| `--setting-sources "" --strict-mcp-config` (**profile A control**) | 24,371 | +4,009 |
| control + `--plugin-dir <omf>` (**profile A treatment**) | 38,518 | **+14,147 (+58.1%)** |
| default invocation on the author's machine | 59,719 | +21,201 over treatment |

Three repetitions of the control and treatment rows returned byte-identical token
counts (24,371 / 38,518 ×3). Context assembly is deterministic, so context size
requires no repetition — unlike task outcome, which does.

Two consequences are load-bearing:

1. On the author's machine the **other installed plugins and MCP servers account
   for more context (21,201) than OMF itself (14,147)**. A comparison that omits
   `--setting-sources ""` and `--strict-mcp-config` silently attributes other
   vendors' context to OMF. An earlier informal measurement in this repository
   did exactly that and reported a ~6.5× inflation; that figure was confounded
   and is withdrawn.
2. The `--safe-mode` floor differs substantially between models. **Absolute
   context is model-dependent; cross-model comparison of absolute context is
   invalid.** The model must be pinned within a comparison and reported with
   every number.

### 2.2 Scope limit of profile A

Profile A loads OMF **as a plugin only**. Project-level contributions —
`CLAUDE.md`, `.claude/rules/`, `.claude/ontology/`, project `settings.json` hooks
— are absent, because the benchmark fixtures are neutral repositories that do not
contain them.

Profile A therefore measures the **plugin-delivered** surface: skills, commands,
agents, and plugin hooks. It does **not** measure ontology-driven routing or
project rule injection. Any headline number produced under profile A must carry
this qualifier. Measuring the project layer requires a separate registered
profile with fixtures that ship a `.claude/` directory, and is out of scope here.

## 3. Conditions

Within profile A, one variable separates control from treatment.

| Condition | Plugin dirs | Hook control | Role |
|---|---|---|---|
| `off` | none | n/a | control |
| `on` | `<omf>` | `ECC_HOOK_PROFILE=standard` | treatment |
| `ablation-hooks-minimal` | `<omf>` | `ECC_HOOK_PROFILE=minimal` | diagnostic |
| `ablation-hooks-off` | `<omf>` | `ECC_DISABLED_HOOKS=<all>` | diagnostic |

`off` deliberately does **not** use `--safe-mode`. Safe mode changes more than
one variable at once; it is recorded as a reference floor only.

Every condition in a comparison must share, exactly:

- `claude` CLI version
- model (pinned full name, never an alias)
- effort level, permission mode, output format
- per-run timeout and budget ceiling
- allowed tool set
- environment profile
- fixture snapshot hash

These are hashed into the `comparisonFingerprint` that
`scripts/lib/paired-benchmark-runner.js` requires to be identical across the
members of a pair. Plugin dirs and hook-control env vars are **excluded** from
the fingerprint — they are the manipulated variable.

## 4. Hypotheses

- **H0 (registered null)** — loading OMF does not degrade task success beyond the
  non-inferiority margin.
- **H1-quality** — OMF reduces task success.
- **H1-efficiency** — OMF holds quality but increases tokens, latency, or cost.
- **H1-benefit** — OMF improves success or reduces retries on long-horizon and
  failure-replay tasks.

Quality degradation and operating overhead are reported **separately**. A result
where quality is non-inferior but input tokens rise 58% is reported as "no
quality change, measured context cost", never as a single blended verdict.

## 5. Task corpus

The existing `docs/evals/golden-tasks.json` (14 tasks) is a **harness regression
suite** and is barred from model-performance scoring: all 14 pass on a clean
checkout, so an agent that does nothing scores 14/14. This ceiling effect is the
single largest validity defect found in the repository.

Model-performance scoring uses a separate corpus, `docs/evals/model-performance-tasks.json`,
built on neutral fixtures under `benchmarks/fixtures/`. Every task must pass this
preflight before it may be scored:

1. **Baseline-failing** — the verifier fails on the untouched fixture, twice,
   with an identical failure signature. Enforced at runtime by
   `--require-failing-baseline`.
2. **Reference-passing** — the verifier passes when the checked-in reference fix
   is applied.
3. **Verifier absent during the run** — the verifier is materialized only after
   the agent exits. Note the threat model: the agent is assumed
   non-adversarial. Claude Code does not enforce a filesystem boundary at the
   working directory, so this detects contamination rather than preventing it.
   Anything left in the episode root, and any change to a protected path, fails
   the episode. See `benchmarks/README.md`.
4. **Anti-gaming checks** — the verifier asserts the original defect is fixed,
   re-runs its own copy of the public cases rather than the workspace's, and
   includes generalization cases absent from the shipped tests.
5. **Privacy** — no secrets, customer data, hostnames, usernames, or absolute
   paths in the prompt or fixture. The event log records a task hash, never the
   prompt.

Strata: seeded-defect repair, multi-file/long-horizon, ambiguous-but-bounded
brownfield, security/regression-sensitive, and **OMF-neutral tasks with no
relationship to OMF's feature set**. The neutral stratum is mandatory — without
it the corpus cannot rule out a corpus-favors-OMF bias.

Pilot: ≥15 tasks × 3 paired repetitions. Release-grade claims: ≥30 tasks × ≥5
repetitions, with the final n set by power analysis once pilot variance is known.

## 6. Metrics

### Quality (primary)

- Deterministic verifier success rate
- Paired win / loss / tie per task-repetition
- pass@1, pass@3, pass^3
- Success rate **without human intervention**

### Efficiency (secondary, only when quality is non-inferior)

- Input / output / cache-read / cache-creation tokens
- Tool calls, turns, retries
- Wall-clock and provider latency, reported separately
- **Cost per successful task** (cost-of-pass). Total cost alone is barred as a
  decision metric: it rewards a condition that fails cheaply. Cost-of-pass is
  undefined (reported as ∞) when success rate is 0.

### Process and safety

Outcome-only scoring misses reward hacking and accidental success
([arXiv 2605.08545](https://arxiv.org/pdf/2605.08545)). Harness-Bench's failure
taxonomy is adopted because OMF already instruments all three axes:

| Axis | Harness-Bench failure share | OMF instrument |
|---|---|---|
| Output-contract violation | 36.4% | `scripts/lib/false-normal-detector.js` |
| Unrecovered tool error | 24.6% | hook failure events |
| Incomplete evidence grounding | 14.6% | `scripts/lib/evidence-contract.js` |

Also recorded: out-of-scope file edits, weakened or deleted tests, attempts to
reach outside the working directory (a hidden-verifier tamper signal), timeouts,
forced stops, and `permission_denials`.

Process scoring (`TaskScore = Security × Completion × Process`) is defined here
but is **not** part of the Phase 2 deliverable; it lands in Phase 4.

## 7. Statistical analysis

Per [Miller, *Adding Error Bars to Evals*, arXiv 2411.00640](https://arxiv.org/abs/2411.00640),
analysis is on **paired per-task differences**, not on the difference of two
independent means — the paired form removes task-difficulty variance. Reporting a
bare `successRateDelta`, as the current runner does, is insufficient and is
superseded by:

- McNemar exact test on paired success/failure discordance
- Paired bootstrap 95% CI for the success-rate difference
- Paired bootstrap 95% CI for token, latency, and cost ratios
- Stratified results by difficulty and by task stratum
- Repetition-clustered standard errors (naive SEs understate by up to ~3×)

### Registered decision margins

Non-inferiority margin **δ = 3 percentage points** on success rate.

| Verdict | Rule |
|---|---|
| **Improvement** | Lower bound of the 95% CI for `success_on − success_off` > 0 |
| **Non-inferior** | Lower bound > −3 pp |
| **Degradation** | Upper bound < −3 pp, or a significant rise in safety failures |
| **Inconclusive** | CI spans both 0 and −3 pp |
| **Insufficient data** | Fewer than 15 tasks (see below) |

`Inconclusive` is a permitted and expected pilot outcome and must be reported as
such rather than resolved by adding repetitions until the sign flips.

### Cluster floor

**No verdict may be issued below 15 tasks.** A percentile cluster bootstrap
resamples whole tasks, so with *k* tasks it can only ever produce *k* distinct
values; at *k* = 1 every resample is the same task and the interval collapses to
a point, which reads as certainty when it is the opposite. A run below the floor
reports `insufficient_data` and its interval is labelled descriptive only. The
floor is the registered pilot size: below it a run is a smoke test, not an
experiment.

### Corroboration requirement

The bootstrap interval is the registered decision rule, but the task-level sign
test discards magnitude and is more conservative, so the two can disagree. When
a directional verdict (`improvement` or `degradation`) is **not** matched by the
sign test at p < 0.05, the analysis labels it *not corroborated* and the
direction must be reported as suggestive, not established.

### Implementation

`benchmarks/lib/paired-stats.js` and `benchmarks/analyze.js`. Analysis is
deterministic: the bootstrap uses a seeded PRNG, so the same report and seed
always reproduce the same interval.

### Registered analysis parameters

The margin, cluster floor, confidence level, **bootstrap sample count** and
**RNG seed** are all registered. Overriding any of them produces
`protocolCompliant: false`, drops the protocol citation, prints a
`NOT A PRE-REGISTERED RESULT` banner and forces exit 0, so a post-hoc choice
can neither be quoted as a protocol verdict nor gate a build. Sample counts
below 1000 are rejected outright: at very small counts the interval degenerates
to a point and can flip the verdict.

## 8. Reporting rules

- Every published number carries: model, CLI version, environment profile,
  fixture snapshot hash, n tasks, n repetitions, and CI.
- Raw report JSON and the exact re-run command are published alongside any claim.
  On SWE-bench Verified leaderboards only 1 of 100 entries was independently
  verified; self-reported numbers without a reproduction path carry no weight.
- Pairs where only one condition completed (budget or timeout) are **excluded**,
  never imputed.
- Runs without `--require-isolation` report `environmentIntegrity: "unverified"`
  and are barred from product claims.
- A negative or inconclusive result is published on the same terms as a positive
  one.

## 9. Known limitations

- `environmentIntegrity: "adapter_attested"` is an attestation by the adapter,
  not an independent isolation proof.
- Profile A does not measure the project-configuration layer (§2.2).
- Cost figures come from the provider's own `total_cost_usd` and inherit its
  accounting, including subscription-vs-API differences.
- Seed pinning does not guarantee determinism for the provider.
- The pilot measures one model. Harness-Bench found cross-harness variance shrinks
  as model strength rises, so single-model results do not generalize across tiers.

## Protocol amendments

| Date | Change | Reason |
|---|---|---|
| 2026-08-01 | Initial registration | — |
| 2026-08-02 | Added the 15-task cluster floor and the `insufficient_data` verdict | A one-task smoke run produced a zero-width interval and a `degradation` verdict. The floor makes the rule strictly harder to satisfy and was added before any result was scored. |
| 2026-08-02 | Added the corroboration requirement | The bootstrap interval and the task-level sign test can disagree; an uncorroborated directional claim must be labelled rather than reported as a finding. Strictly narrows what may be claimed. |
| 2026-08-02 | Corrected the verifier-isolation claim (§5.3) | Review found the claim false: the agent can read and write the episode root. Verified against the live CLI. Replaced with an explicit non-adversarial threat model plus contamination detection. This weakens a stated guarantee and is recorded as such. |
| 2026-08-02 | Analysis overrides void the pre-registered label | `--margin-pp` / `--min-clusters` produced output still citing this protocol and still driving a CI exit code. Overridden runs now report `protocolCompliant: false` and never gate. |
| 2026-08-02 | Bootstrap sample count and RNG seed registered; minimum 1000 draws | Follow-up review showed `samples: 1` turning an `inconclusive` result into `improvement` with a degenerate interval, still labelled protocol-compliant. Both are now registered parameters and sub-1000 counts are rejected. |

## References

- [Harness-Bench: Measuring Harness Effects across Models in Realistic Agent Workflows (arXiv 2605.27922)](https://arxiv.org/html/2605.27922v1)
- [Miller, Adding Error Bars to Evals (arXiv 2411.00640)](https://arxiv.org/abs/2411.00640)
- [Log analysis is necessary for credible evaluation of AI agents (arXiv 2605.08545)](https://arxiv.org/pdf/2605.08545)
- [SWE-bench Verified 2026: benchmarks vs scaffolding](https://www.digitalapplied.com/blog/swe-bench-verified-june-2026-benchmark-vs-scaffolding-analysis)
- [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) · [Terminal-Bench](https://github.com/laude-institute/terminal-bench)
- Repository: `docs/research/harness-model-performance-comparison-2026-07.md`, `docs/evals/harness-effectiveness.md`
