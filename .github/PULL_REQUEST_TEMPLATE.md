## Summary

<!-- What does this PR do? One or two sentences. -->

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

## Testing

- [ ] `node tests/run-all.js` — all tests pass
- [ ] New scripts in `scripts/lib/` have a matching test in `tests/lib/`
- [ ] New hooks have at least one integration test in `tests/hooks/`

## Ontology (if applicable)

- [ ] Added / updated domain entry in `.claude/ontology/index.json`
- [ ] `node scripts/ci/validate-ontology.js` passes
- [ ] Feature spec exists in `docs/features/`

## Checklist

- [ ] Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- [ ] No `Co-Authored-By: Claude` in commit messages
- [ ] Hook scripts exit 0 on non-critical errors
- [ ] New hook registered in `hooks/hooks.json` and routed through `run-with-flags.js`
