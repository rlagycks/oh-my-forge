## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Related issue(s)

<!-- Closes #, Fixes #, Relates to # -->

-

## Type of change

- [ ] Bug fix
- [ ] New feature (agent / command / skill / hook / rule)
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] CI / tooling

## Changes

<!-- List the key files added or modified. -->

-
-

## Impact

- [ ] Adds or changes a hook (registered in `hooks/hooks.json`, routed through `run-with-flags.js`)
- [ ] Adds or changes an ontology domain / constraint
- [ ] Changes existing command, skill, or agent behavior (may affect current users)
- [ ] Breaking change (existing workflows would need to adapt)
- [ ] Needs a version bump / release after merge (`scripts/release.sh`)

## Testing

### Commands run

```bash
node tests/run-all.js
```

### What was verified

<!-- Which scenarios did you check? If only manually verified, describe the repro steps. -->

-

## Ontology (if applicable)

- [ ] Added / updated domain entry in `.claude/ontology/index.json`
- [ ] `node scripts/ci/validate-ontology.js` passes
- [ ] Feature spec exists in `docs/features/`

## Review focus

<!-- Anything you want a reviewer to pay particular attention to. -->

-

## Checklist

- [ ] Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- [ ] No `Co-Authored-By: Claude` in commit messages
- [ ] Hook scripts exit 0 on non-critical errors
- [ ] New scripts in `scripts/lib/` have a matching test in `tests/lib/`
- [ ] New hooks have at least one integration test in `tests/hooks/`
- [ ] No secrets, credentials, or other sensitive data included
- [ ] I reviewed my own diff before requesting review
