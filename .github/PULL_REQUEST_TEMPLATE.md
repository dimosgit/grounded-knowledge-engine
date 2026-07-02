## What does this change?

<!-- One or two sentences: what and why. Link the issue if one exists. -->

## Checklist

- [ ] `npm run typecheck && npm run lint && npm run format:check` pass (repo root)
- [ ] `npm run test:gke` passes
- [ ] `npm run scrub` passes (sanitization gate)
- [ ] Cockpit checks pass if `apps/cockpit` changed (`typecheck`, `lint`, `test`, `build`)
- [ ] Documentation updated where behavior changed
- [ ] No private content: demo/example data stays sanitized
