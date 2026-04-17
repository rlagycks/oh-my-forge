---
description: Turn PRDs, API specs, or feature definition docs into an execution contract with verification points, non-goals, and handoff format.
argument-hint: <feature description | path/to/doc.md>
---

# Design Contract

Translate source design documents into a compact execution contract that implementers, reviewers, and handoff flows can actually enforce.

Use this when the source material is still too abstract to implement safely:
- PRD exists but does not yet define execution boundaries
- API spec exists but work can still sprawl beyond the intended slice
- 기능 정의서는 있는데 구현 단계의 검증 포인트와 handoff 기준이 비어 있음

Do **not** use this command to replace the source docs. The goal is to produce a lower-level contract, not to rewrite the original document set.

## Usage

```bash
/design-contract <feature description | path/to/doc.md>
```

**Examples**
```bash
/design-contract docs/prd/notifications.md
/design-contract docs/api/auth.md
/design-contract "Add retry-safe webhook delivery for failed notifications"
```

## Inputs

Accept either:
- a path to a PRD, API spec, or feature-definition markdown file
- a short free-form feature description

If the input is a path:
1. Read the document directly.
2. Pull only the clauses relevant to the requested implementation slice.
3. Ignore historical context, marketing text, and long rationale unless they change implementation constraints.

If the input is free-form:
1. Restate the feature in one line.
2. Search the local docs tree for the nearest matching PRD/API/feature docs.
3. If nothing relevant exists, continue with the user text only and clearly label assumptions.

## Phase 1 — Extract

Extract only the implementation-relevant clauses:
- goal and user-visible outcome
- hard scope boundaries
- data or API contracts
- invariants and forbidden behaviors
- rollout or migration constraints
- acceptance criteria already present in the source docs

Reject low-signal material:
- vision statements without implementation impact
- duplicated rationale
- speculative future roadmap
- unrelated edge cases outside the current slice

## Phase 2 — Translate

Convert the extracted design into a strict execution contract with these sections:

```markdown
# Design Contract: <feature name>

## Problem One Line
- <single sentence>

## Mission
- What this implementation slice is responsible for

## Success
- Concrete completion conditions

## Not Do
- Explicit non-goals
- Scope-expansion boundaries

## Inputs / Contracts
- Relevant API, data, and interface assumptions

## Verification Points
- Evidence required to claim progress
- Tests, checks, or proof expected before completion

## False-Normal Checks
- Signals that may look healthy but are not sufficient

## Expansion Forbidden
- No extra feature additions
- No opportunistic refactors
- No package/framework swaps unless the source docs require them

## Handoff Format
- Current State
- Evidence
- Open Risks
- Next Action
```

## Phase 3 — Enforceability Check

Before finalizing, verify the contract is enforceable:
- Could an implementer tell what files or subsystems are in-scope?
- Could a reviewer reject a fake completion using the listed verification points?
- Could a handoff reader choose the next action immediately?

If not, rewrite the contract until the answer is yes.

## Phase 4 — Output

Produce the final output in this order:

1. `Problem One Line`
2. `Execution Contract`
3. `Verification Points`
4. `False-Normal Checks`
5. `Expansion Forbidden`
6. `Handoff Format`
7. `Open Assumptions` (only if assumptions remain)

Keep it compact. This command is successful when it removes ambiguity, not when it produces a long document.

## Integration Notes

- Use `/plan` after this when you want phased implementation work.
- Use `/ontology-extract` when the source docs should become machine-readable ontology detail.
- To promote a saved design contract into ontology detail JSON, run:

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
node "$PLUGIN_ROOT/scripts/lib/ontology.js" promote-contract \
  --contract-file "<design-contract.md>" \
  --detail-file ".claude/ontology/domain_<name>.json" \
  --write
```

- Promotion records the contract as `sourceDocs.designContract`.
  Routing and handoff can point to the enforceable contract without loading
  the original PRD/API/spec by default.
- Use `/prp-plan` when you need a larger artifact-producing implementation plan rather than a compact execution contract.

## Output Quality Bar

Good output:
- can be copied directly into a handoff or implementation brief
- names real constraints and real non-goals
- makes fake progress easier to detect

Bad output:
- repeats the PRD in softer words
- has generic bullets like “ensure quality”
- omits how completion is verified
