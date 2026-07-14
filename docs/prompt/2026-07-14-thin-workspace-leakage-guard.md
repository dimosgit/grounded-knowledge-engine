# Feature Prompt Template

## 1. Feature Title

`Thin Workspace Leakage Guard`

## 2. Objective

Enforce one immutable filesystem trust boundary per GKE process. Prevent an
incorrect configured root, traversal segment, or symlink from causing the
active process to index, read, cite, or write content outside its workspace.

## 3. Context

- Product area: `Runtime workspace configuration, retrieval roots, canonical writes, MCP resources, and local Cockpit identity`
- Current behavior: `repoRoot and scan roots come from environment variables; scan roots are path-resolved but not realpath-authorized against repoRoot; individual write services implement separate confinement checks; workspace-info exists but exposes only a partial identity.`
- Problem to solve: `GKE documents workspace isolation as a non-negotiable invariant, but a locally misconfigured root or symlink can cross the intended boundary before indexing.`

## 4. Scope

- In scope:
  1. One immutable `WorkspaceContext` loaded at process startup.
  2. Realpath authorization for configured scan roots, indexed files, and write targets.
  3. Backward-compatible environment mapping for the default workspace.
  4. Workspace identity and read/write state in `gke://workspace/info`.
  5. Adversarial cross-workspace and symlink tests.
- Out of scope:
  1. Cross-workspace search or an in-process workspace switcher.
  2. Enterprise identity, document ACLs, or hosted multi-tenancy.
  3. Mandatory audit logging or a sensitivity-specific visual system.
  4. Remote write enablement.

## 5. Requirements

1. Add a browser-independent workspace policy module under `tools/workspaces/`.
2. Define an immutable context containing at least `id`, `label`, `repoRoot`,
   logical and real scan roots, logical and real write roots, `readOnly`, and
   `sensitivity`.
3. Support optional `.gke/workspace.json`. When absent, derive a `default`
   context from existing environment variables so current setup continues to work.
4. Resolve `repoRoot` and every existing configured root with `realpath` once at
   startup. Reject empty, outside-workspace, traversal, and symlink-escaping roots.
5. For an existing read target, authorize its real path against an allowed real
   scan root before reading or indexing it.
6. For a new write target, authorize the nearest existing real parent and the
   normalized relative destination against an allowed write root.
7. A write is allowed only when the workspace is not read-only, the target is
   under a write root, and the existing global write gate also allows it.
8. Apply the policy before candidate files enter BM25 or SQLite indexing.
9. Apply the same policy to capture, project, open-question, and ingestion write
   boundaries. Reuse existing atomic-write and hash-conflict behavior.
10. Freeze the context at process startup. No MCP argument may select another workspace.
11. Extend `gke://workspace/info` with label, sensitivity, read-only state, and
    logical allowed roots. Never expose absolute host paths.
12. Keep the loopback HTTP bridge read-only and make it reuse the same context.
13. Add two isolated fixtures containing identical filenames and terms plus a
    distinct marker. Prove that neither process returns the other marker.

## 6. Technical Constraints

1. Markdown remains canonical and indexes remain disposable.
2. Authorization must happen before retrieval/ranking, not as response filtering.
3. Do not add a new MCP tool; use the existing workspace resource.
4. Keep `tools/projects` browser-safe. Node filesystem policy must remain outside
   browser-imported project parser code.
5. Preserve the current four-tool core profile and catalog budgets.
6. Do not log document bodies, prompts, secrets, or absolute paths in safe errors.

## 7. Implementation Notes

1. Suggested files: `tools/workspaces/types.ts`, `tools/workspaces/config.ts`,
   `tools/workspaces/path-policy.ts`, and focused tests beside them.
2. Inject the context into retrieval and repositories. Avoid adding more direct
   `process.env` reads in leaf services.
3. Refactor incrementally: wrap existing capture/project confinement functions
   rather than rewriting their atomic mutation logic.
4. Explicitly test absolute outside roots, `../`, a root-level symlink, a nested
   symlink, a removed target parent, and read-only plus globally enabled writes.
5. If a legacy configuration currently points outside `repoRoot`, fail with a
   migration message; do not silently widen the workspace.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm run lint && npm --prefix apps/cockpit run lint`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build`
   - Formatting: `npm run format:check && npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. An outside configured scan or write root fails before the MCP server accepts requests.
2. Root-level and nested symlink escapes are rejected before indexing or mutation.
3. Workspace A never retrieves, cites, reads, or writes Workspace B's marker.
4. A read-only workspace rejects writes even when the global write flag is true.
5. Existing default `demo-kb,kb` setup remains functional.
6. Workspace information contains no absolute host path.

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
  1. One process represents exactly one workspace.
  2. Separate MCP configuration entries are acceptable for separate workspaces.
- Open questions:
  1. If current tests reveal an intentional outside-root scan use case, stop and
     request an explicit architecture decision rather than preserving it silently.
