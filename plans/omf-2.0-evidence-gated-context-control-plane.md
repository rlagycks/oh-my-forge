# OMF 2.0 — Evidence-Gated Context Control Plane

Status: proposed
Source decision: `docs/research/context-control-plane-major-update-2026-07.md`
Target: post-1.20 major release
Mode: direct repository workflow; each step should land as a reviewable PR-sized change

## Objective

Turn the existing OMF continuity, ontology, handoff, event, state-store, and evaluation pieces into one evidence-gated control loop:

```text
observe → classify boundary → select minimal context → act → verify → persist evidence → learn
```

The release must reduce false-normal continuation and rediscovery cost without creating a new general-purpose memory or orchestration platform.

## Non-negotiable invariants

- An observation is not a verified claim.
- A successful process exit without task-linked verification is `unknown`, not `success`.
- Context injection is bounded, provenance-bearing, and allowed to be refused.
- Existing event logs and handoff consumers remain backward compatible.
- Public benchmark results require failing-baseline preflight, isolated snapshots, comparable provider metadata, and a reproducible report.
- Prompts, source, credentials, model output, and machine-specific paths never enter the public event log.

## Dependency graph

```text
S1 Evidence contract + state boundary
 ├── S2 Boundary Switchboard + planner
 ├── S3 Compaction integrity + re-ground
 └── S4 Measurement-grade evaluation
       └── S5 Portable adapters + release evidence
```

S2, S3, and S4 can proceed in parallel after S1, but S5 is serial after all of them.

## Step 1 — Establish the evidence contract and state ownership

Dependency: none
Suggested PR: `feat: add evidence-gated harness contracts`

### Context brief

OMF currently records context injection and task outcomes, but durable decisions, event logs, sessions, instincts, and state-store data do not share a single semantic distinction between observed, inferred, verified, stale, and unknown state. The first step must define that meaning before adding more automation.

### Tasks

- Add a versioned internal schema for `Observation`, `Claim`, `VerificationReceipt`, and `BoundaryDecision`.
- Extend `harness-event` additively for tool observations, compaction, receipts, and boundary decisions.
- Preserve legacy `recall-hits.jsonl` parsing and existing event names.
- Decide and document the authoritative runtime state path; correct the state-store documentation/code drift.
- Add privacy rules for hashes, paths, prompts, model output, credentials, and redaction.

### Verification

```bash
node tests/lib/harness-events.test.js
node tests/ci/audit-source-docs.test.js
npm test
```

### Exit criteria

- Old event fixtures validate unchanged.
- A receipt without deterministic evidence cannot validate as `verified`.
- Schema versioning and migration behavior are tested.
- State ownership is documented with one writer/recovery rule.

## Step 2 — Add the Task Boundary Switchboard and deterministic planner

Dependency: Step 1
Suggested PR: `feat: classify task boundaries and plan bounded context`

### Context brief

Session-start currently selects a recent matching session and OMF injects domain context. It does not explicitly distinguish continuation from a related reset, fresh task, fork, or ambiguous request. ContextBench and long-context research make unbounded recall unsafe; the planner must be deterministic first.

### Tasks

- Define the five boundary outcomes: `continue`, `related-reset`, `fresh`, `fork`, `ask-user`.
- Implement explainable signals: branch/worktree, task hash, file overlap, diff relation, open objective, explicit user wording, and snapshot drift.
- Produce a preview containing selected items, rejected items, reason codes, and token/character budget.
- Add deterministic priority and eviction rules based on evidence state, freshness, dependency, and recoverability.
- Keep `ask-user` as the default when signals conflict; do not auto-switch providers.

### Verification

```bash
node tests/lib/continuity-packet.test.js
node tests/lib/ontology-packet.test.js
node tests/lib/ontology-routing.test.js
node tests/hooks/session-start.test.js
```

### Exit criteria

- The planner can return no injection safely.
- Every selected item has a reason and provenance.
- A budget overflow produces deterministic eviction, not silent truncation.
- Existing context injection snapshots remain compatible.

## Step 3 — Make compaction a re-grounding boundary

Dependency: Step 1
Suggested PR: `feat: verify continuity after compaction`

### Context brief

PreCompact already saves a continuity packet and clears injection deduplication. The missing contract is a post-compact check that prevents narrative summaries, killed commands, stale file states, or unverified test claims from becoming durable truth.

### Tasks

- Record command exit code, signal, timeout, start/end time, target snapshot, and changed-file hashes where available.
- Emit a compact receipt that distinguishes persisted artifacts from terminal observations.
- Re-ground at session start: `git status --short`, `git diff --stat`, `git diff --check`, and a targeted verifier.
- Extend false-normal detection to reject unsupported `DONE`/`TESTS: PASS` claims.
- Include one next action, two or three files to read, and claims requiring re-verification in handoff output.
- Add regression coverage for the same session after multiple compactions.

### Verification

```bash
node tests/hooks/pre-compact-dedup-reset.test.js
node tests/hooks/session-start.test.js
node tests/lib/false-normal-detector.test.js
node tests/lib/continuity-packet.test.js
```

### Exit criteria

- A killed or timed-out command cannot produce a verified success receipt.
- Compaction never suppresses required domain injection because of stale dedup state.
- Unsupported claims are surfaced as `unknown` with a next verification action.

## Step 4 — Upgrade the benchmark from plumbing validation to decision evidence

Dependency: Step 1
Suggested PR: `feat: add measurement-grade harness release gate`

### Context brief

The repository now has golden tasks and a paired runner, but harness regression tasks must not be mistaken for model performance evidence. Product claims require failing baselines, isolated snapshots, identical provider configuration, and uncertainty-aware paired analysis.

### Tasks

- Split `harness-regression` and `model-performance` suites.
- Add baseline-failing and reference-patch preflight contracts.
- Enforce per-condition snapshot restoration/tree verification and fresh state roots.
- Validate provider/model/config/tool fingerprints across on/off conditions.
- Add task-level wins/losses/ties and confidence intervals or a clearly documented paired bootstrap/McNemar analysis.
- Add ablation conditions: context-only, hooks-only, and minimal harness.
- Keep incomplete or `environmentIntegrity=unverified` runs out of release claims.

### Verification

```bash
node tests/evals/golden-tasks.test.js
node tests/lib/golden-task-runner.test.js
node tests/lib/paired-benchmark-runner.test.js
node tests/run-paired-benchmark-cli.test.js
npm test
```

### Exit criteria

- A baseline-passing task is rejected from model-performance scoring.
- Contaminated or incomparable pairs fail closed.
- The report separates quality, efficiency, and safety/maintenance metrics.
- The report cannot claim causality from recall injection alone.

## Step 5 — Add standards-based portability and publish the first evidence report

Dependency: Steps 2–4
Suggested PR: `docs: publish OMF 2.0 portability and evaluation contract`

### Context brief

OMF already targets several agent hosts. Portability should be achieved through existing project instructions, tool/resource protocols, and telemetry conventions rather than a new OMF transport or cloud memory service.

### Tasks

- Document mapping to AGENTS.md, MCP resources/tools, and OpenTelemetry GenAI events.
- Define a minimal provider adapter contract around task boundary, packet, receipt, and verifier.
- Provide one offline fixture adapter; keep real provider credentials and network execution outside the repository.
- Run a small pilot across neutral, long-horizon, and failure-replay tasks.
- Publish a report with pre-registered margins, sample limitations, unknowns, and no unsupported “performance improvement” claim.
- Update README only after evidence meets the release gate.

### Verification

```bash
npm test
node scripts/run-paired-benchmark.js --help
node scripts/recall-report.js --help
```

### Exit criteria

- A new provider can integrate without copying a session format or memory database.
- Privacy review finds no raw prompts/source/model output in public artifacts.
- Pilot results identify whether the benefit is quality, efficiency, safety, or none.

## Adversarial review gate

Before implementation is called OMF 2.0-ready, review the design against these failure modes:

- Does the planner simply reintroduce a larger memory dump under a new name?
- Can stale ontology entries still be injected because “recent” outranks “verified”?
- Can an adapter attest to isolation without independently proving it?
- Can a timeout, partial stdout, or skipped verifier become `success`?
- Are on/off comparisons confounded by provider, tool, permission, or environment changes?
- Does state-store ownership create last-writer-wins data loss under concurrent hooks?
- Does telemetry leak source, secrets, or user prompts?
- Is an external standard being used where it fits, instead of creating a new OMF protocol?

Any critical finding blocks the release gate until a test or explicit limitation addresses it.

## Rollback strategy

- Keep all new event fields additive and preserve legacy readers.
- Gate new injection/planner behavior behind an opt-in feature flag until pilot evidence exists.
- Keep existing session summaries and handoff output readable during migration.
- If state-store migration is unsafe, stop at read-only receipts and rebuild from append-only logs rather than deleting old state.
- Do not remove old hooks or schemas in the same release as the first evidence contract.
