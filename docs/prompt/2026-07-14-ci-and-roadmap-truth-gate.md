# Feature Prompt Template

## 1. Feature Title

`CI and Roadmap Truth Gate`

## 2. Objective

Make the repository's green CI result mean that every implemented engine
contract was actually tested. Add a production-bundle boundary assertion and
repair active roadmap status labels so the next coding model starts from a
truthful baseline.

## 3. Context

- Product area: `GitHub Actions, root/Cockpit verification, and active planning documents`
- Current behavior: `package.json defines more engine suites than .github/workflows/ci.yml executes; test:gke also omits the HTTP integration suite; the Cockpit production build is not automatically checked for local mutation endpoint markers; active roadmaps contain delivered/planned contradictions.`
- Problem to solve: `A regression in a newly implemented service can merge under a green workflow, and a later agent can select work from stale status prose.`

## 4. Scope

- In scope:
  1. Make `npm run test:gke` the authoritative complete engine test command.
  2. Make root CI invoke that command instead of duplicating an incomplete suite list.
  3. Add an automated Cockpit production-boundary assertion after build.
  4. Correct implementation-status statements in currently active roadmaps.
- Out of scope:
  1. Changing engine, retrieval, capture, or Cockpit product behavior.
  2. Reorganizing all historical prompt documents.
  3. Adding a new CI provider or deployment workflow.

## 5. Requirements

1. Add `npm run test:mcp:http` to `npm run test:gke`.
2. In `.github/workflows/ci.yml`, preserve install, typecheck, lint, format,
   build, MCP setup, scrub, and the Node 22/24 matrix, but replace the duplicated
   engine test steps with one clearly named `npm run test:gke` step.
3. Preserve the rule that Cockpit test and build run sequentially.
4. Add a Cockpit script that runs after a production build and recursively
   inspects `dist/` for local-only endpoint markers, including `/__gke/ask`,
   `/__gke/capture`, and `/__board/lifecycle`.
5. The production-boundary script must fail when `dist/` is missing or when a
   forbidden marker is present. It must print only marker names and relative
   artifact paths, not artifact bodies.
6. Add the boundary script to Cockpit CI after `npm run build`.
7. Correct the opening status of the capture-integrity roadmap: daily attention
   is implemented in the engine/CLI/resource, while Cockpit attention remains
   planned.
8. Mark MCP Core Modernization as delivered in the consultant roadmap and mark
   the loopback HTTP bridge as implemented ahead of the still-required Leakage
   Guard. Do not describe the broader tunnel/adapters phase as complete.
9. Add a short link from the active roadmaps to
   `docs/planning/2026-07-14-current-hardening-and-operator-execution-plan.md`.

## 6. Technical Constraints

1. Do not remove any test suite from `package.json` or CI coverage.
2. Do not run root and Cockpit jobs against machine-local `kb/` content.
3. Keep the production-boundary marker list specific enough that sanitized
   documentation about environment variables does not fail the check.
4. Keep root and Cockpit npm trees independent.

## 7. Implementation Notes

1. Expected files include `package.json`, `.github/workflows/ci.yml`,
   `apps/cockpit/package.json`, a new script under `apps/cockpit/scripts/`, and
   the two active roadmap files.
2. Run MCP setup before `npm run test:gke` in CI because the authoritative suite
   includes the MCP smoke test.
3. Use Node filesystem APIs for the boundary assertion; do not add a dependency.
4. Preserve existing GitHub Action pinning and permissions.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm run lint && npm --prefix apps/cockpit run lint`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm --prefix apps/cockpit run test:production-boundary`
   - Formatting: `npm run format:check && npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. One root CI step executes every suite in `test:gke`, including HTTP integration.
2. A failing capture, project-review, answer-service, transport, or HTTP test makes CI fail.
3. A production bundle containing one forbidden local endpoint marker fails the boundary assertion.
4. The current production bundle passes the boundary assertion.
5. Active roadmap status prose no longer contradicts its feature-level status sections.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. If preparing a commit, stage only the intended files before the final
   npm run scrub because the tracked-file string scan does not inspect untracked
   additions. Do not stage unrelated user changes.

## 12. Assumptions and Open Questions

- Assumptions:
  1. `npm run test:gke` is the canonical engine verification entry point.
  2. Local endpoint strings are absent from the current production client bundle.
- Open questions:
  1. None. Do not broaden this task into CI optimization or workflow splitting.
