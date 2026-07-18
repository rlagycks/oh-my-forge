# RCA History

One file per QA run. Naming: `YYYY-MM-DD-[project].md`

Each file contains the full Phase 5 report from that run.

## Index

| Date | Project | Failures | Critical | High | Resolved |
|------|---------|----------|----------|------|----------|
| — | — | — | — | — | — |

## How to add a new entry

After /qa-loop completes, save the Phase 5 report here:
```
docs/qa/rca-history/2026-04-05-thumbsup-frontend.md
```

Then update bug-topology.md with confirmed bugs.

## Promote a confirmed incident to the golden corpus

RCA history is the source record; `docs/evals/golden-tasks.json` is the
privacy-safe, deterministic replay projection. Promotion is appropriate only
after the developer has approved the finding and the report identifies a root
cause rather than a symptom.

1. Select the smallest replayable failure mode and keep this report as its
   provenance source.
2. Remove secrets, personal data, session identifiers, hostnames, usernames, and
   absolute paths. Use synthetic fixtures and repository-relative references.
3. Add a new task ID with `provenance`, `tags`, `difficulty`,
   `success_criteria`, and node-only `verification` metadata. Do not reuse an ID
   for a changed failure mode.
4. Point verification at an existing deterministic test or add a focused test in
   the owning domain. Do not add a shell command or a copied production log.
5. Run `node tests/evals/golden-tasks.test.js` and
   `node tests/lib/golden-task-runner.test.js`, then replay the task once with
   `scripts/run-golden-task.js`.

The golden-task runner treats the suite as trusted executable configuration. RCA
promotion adds descriptive metadata only; it must not broaden the runner's
node-only, shell-free verification boundary.
