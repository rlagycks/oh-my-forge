# Model Route Command

Recommend the best model tier for the current task by complexity and budget.

## Usage

`/model-route [task-description] [--budget low|med|high]`

## Routing Heuristic

- `haiku`: deterministic, low-risk mechanical changes
- `sonnet`: default for implementation and refactors
- `opus`: architecture, deep review, ambiguous requirements

## Current Lineup (as of 2026-07 — examples only, tiers are what matter)

| Tier | Current model | When |
|------|---------------|------|
| `haiku` | Haiku 4.5 | Cheap/fast worker; frequent, low-risk mechanical calls |
| `sonnet` | Sonnet 5 | Default coding workhorse; main implementation and refactors |
| `opus` | Opus 4.8 | Deep reasoning; architecture, ambiguous requirements; supports fast mode |
| (above opus) | Fable 5 (Mythos-class) | Rare, genuinely frontier-hard problems only |

The tier→model mapping floats over time — the table above is a snapshot, not a pin.

**Rule: always output the alias (`haiku`/`sonnet`/`opus`), never a dated model ID.**

## Required Output

- recommended model
- confidence level
- why this model fits
- fallback model if first attempt fails

## Arguments

$ARGUMENTS:
- `[task-description]` optional free-text
- `--budget low|med|high` optional
