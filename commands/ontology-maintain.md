---
description: Create a read-only, provider-explicit ontology maintenance proposal. Requires a pending review package and never applies files.
---

# Ontology Maintain

Create one guarded ontology maintenance proposal from a `pending_review` candidate.

## Usage

```
/ontology-maintain --candidate <ontology-candidate-id> --provider <claude_code|codex_cli>
```

Foreground CLI equivalent (the provider binary must be an explicitly supplied, trusted absolute path):

```
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-$(cat "$HOME/.claude/.omf-root" 2>/dev/null || echo "$HOME/.claude")}}"
node "$PLUGIN_ROOT/scripts/ontology-maintain.js" propose --candidate <ontology-candidate-id> \
  --provider <claude_code|codex_cli> --binary /absolute/mock-or-provider \
  --db /absolute/state.db --repo /absolute/repository --idempotency-key <key>
```

## Contract

- `--provider` is mandatory. Only `claude_code` and `codex_cli` are accepted; never select a fallback provider or call one provider from the other.
- Create the metadata-only review package first. Bind the job to its hash, the candidate fingerprint, and the current repository HEAD before dispatch.
- The provider receives a read-only process contract. It may return only a semantic target and intent; patches, diffs, commands, source text, and raw output are rejected and never written to the state store.
- A provider process is permitted only when its configured absolute binary resolves to a regular executable with trusted ownership and safe permissions. The process never searches caller `PATH`; it uses a fixed argument vector, `shell: false`, a trusted minimal environment, timeout, stdin, and output size.
- The foreground CLI is a local-operator workflow: its explicit binary is trusted with the invoking user's authority and is not an OS sandbox. Do not expose `--binary` to untrusted automation or users with greater privileges than the caller.
- This command records a proposal and an attested receipt when an external artifact store is configured. It never applies the proposal, changes project files, or enables a hook.

## Procedure

1. Run the maintainer dry-run to materialize a review package for the candidate.
2. Require one explicit provider and verify only that provider is available.
3. Claim the provider-neutral job using its idempotency key. A duplicate claim must return the prior job without a second provider invocation.
4. Run the selected adapter in read-only mode and normalize its response to the protocol proposal schema.
5. Record only the normalized semantic proposal. If an externally persisted, attested artifact is available, record its receipt; otherwise stop at `proposal_recorded` for review.
6. Send the proposal to the separate approval/apply workflow. Do not invoke that workflow here.

The release gate exercises this foreground path using a temporary isolated Git worktree and mock executable only; it never contacts a live provider or network service.

## Failure handling

- Missing capability, invalid bindings, unavailable state store, and absent mock/process runner fail closed before dispatch.
- Timeout and non-zero provider exits terminate the provider process group and become retryable operational failures only after the job ledger records that transition. Invalid or oversized output is rejected without retaining its contents.
- Do not add this command to PostToolUse, Stop, or SessionEnd hooks. It is a user-initiated deferred workflow only.
