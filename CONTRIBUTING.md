# Contributing to Grounded Knowledge Engine

Thanks for your interest in improving GKE. This guide keeps contributions fast
to review and safe to merge.

## Ground rules

- **Security reports do not go in public issues.** Use
  [private vulnerability reporting](https://github.com/dimosgit/grounded-knowledge-engine/security/advisories/new)
  as described in [SECURITY.md](SECURITY.md).
- Bug reports and feature requests go through the
  [issue templates](https://github.com/dimosgit/grounded-knowledge-engine/issues/new/choose).
- For anything larger than a small fix, open an issue first so the approach can
  be agreed before you invest time in a pull request.

## Development setup

Requires **Node ≥ 22.5** (Node 24 recommended) for the built-in `node:sqlite`.

```bash
npm install

# Cockpit (only if you touch apps/cockpit)
cd apps/cockpit && npm install
```

## Before you open a pull request

All of these run in CI and are required to pass:

```bash
# Engine (repo root)
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:gke
npm run scrub          # sanitization gate; requires gitleaks installed

# Cockpit (apps/cockpit), when changed
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

Use `npm run format` to fix formatting instead of hand-aligning.

## Pull request expectations

- Keep the diff focused on one change; avoid drive-by refactors.
- Update documentation (README, `docs/`, tool READMEs) when behavior changes.
- New MCP tools or schema changes must stay within the catalog budgets enforced
  by `npm run test:mcp:catalog`.
- The demo knowledge base (`demo-kb/`, `examples/`) must remain sanitized:
  nothing that identifies real customers, private endpoints, or secrets.
  `npm run scrub` enforces this and CI fails closed if it cannot run.

## Commit style

Short imperative subject lines, in the spirit of the existing history
(`feat(mcp): …`, `fix(scrub): …`, `docs: …`). Conventional-commit prefixes are
appreciated but not enforced.
