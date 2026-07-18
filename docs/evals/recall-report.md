# Recall recurrence and usefulness report

The report is metadata-only. It uses event timestamps, domains, optional constraint IDs, optional memory IDs, episode IDs, and outcome metadata. Prompts, generated source, and injected context are never required.

## Recurrence

For the selected `--since` window, recurrence is reported for domains, constraint IDs, and memory IDs. The first observation of each key is the baseline; later observations are repeats:

```text
recurrenceRate = repeatOccurrences / occurrences * 100
```

Each row and dimension summary exposes `occurrences`, `repeatOccurrences`, `uniqueEpisodes`, `firstSeen`, `lastSeen`, `sampleSize`, `minimumSampleSize`, and `insufficientSample`. Rates are `null` when fewer than two observations exist. Legacy records still contribute to domain totals, but records without `constraint_ids` or `memory_ids` cannot contribute to those breakdowns.

The JSON report fields are `recurrence.byDomain`, `recurrence.byConstraint`, and `recurrence.byMemoryId`, plus dimension-level summaries under `recurrence.summary`.

## Recall usefulness

Usefulness is episode-level. The latest valid task outcome timestamp is the final outcome for an episode. Duplicate outcome episode IDs are reported, but intermediate outcomes do not inflate categories.

- `noInjection`: final task outcome has no episode-linked injection.
- `injectedButUnused`: injection has no final outcome, an `unknown` final outcome, or explicit `recall_used: false`.
- `injectedAndSuccessful`: final outcome is `success` and `recall_used` is not explicitly false.
- `injectedAndFailed`: final outcome is `failure` and `recall_used` is not explicitly false.

When `recall_used` is absent, success/failure are linkage proxies, not causal claims. Add explicit evidence with the recording CLI:

```bash
node scripts/record-harness-event.js --type task_outcome --episode episode-123 --outcome success --recall-used true
```

Usefulness percentages are `null` below three classified episodes and the report marks `insufficientSample: true`; counts remain available. Unattributed injections are counted separately because they cannot be assigned to an episode outcome. The text table prints the same categories and marks insufficient samples.

The existing `recall-hits.jsonl` path and legacy record parsing remain unchanged.

`outcomes.total` and `outcomes.rawTotal` count recorded task-outcome events for
backward compatibility. `outcomes.finalTotal` counts the latest outcome per
episode; success/failure/unknown counts and rates use that final-outcome view.
