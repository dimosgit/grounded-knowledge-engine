# Feature Prompt Template

## 1. Feature Title
`Workspace Vaults and Leakage Guard — Hard Boundaries Between Client and Personal Context`

## 2. Objective
Make GKE safe for a consultant who works across sensitive client and personal projects on the same machine. Introduce explicit workspace profiles, process-level isolation, read/write policy, sensitivity labels, and an audit trail so an agent cannot accidentally retrieve or capture information into the wrong workspace. The product should make the active trust boundary visible at all times.

## 3. Context
- Product area: `Runtime configuration, retrieval roots, MCP setup, write policy, and Cockpit shell`
- Current behavior: `One server process uses environment-configured scan roots and one repository root. Search supports track/module filters, but there is no first-class workspace identity, no hard guarantee against cross-client retrieval, and no user-facing indication of which workspace an agent is using.`
- Problem to solve: `For consultants, accidental cross-client disclosure is a product-ending failure. Soft tags and search filters are insufficient because the model or caller can omit them, and a single broad server process may index unrelated material.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Add local workspace profiles with explicit root, scan roots, write roots, sensitivity, and operating mode.
  2. Run one isolated MCP server process per workspace profile.
  3. Add allow/deny path enforcement for reads and writes.
  4. Add workspace identity to every MCP response and captured note.
  5. Add an append-only local audit log for tool access and writes.
  6. Add visible active-workspace branding and warnings in the Cockpit.
  7. Add adversarial tests proving that one workspace cannot retrieve or write another workspace’s data.
- Out of scope:
  1. Enterprise multi-tenant SaaS hosting.
  2. Cloud key management in the first local release.
  3. Fine-grained per-document ACLs inherited from SharePoint or another external system.
  4. Automatic classification of all sensitive information.
  5. A global cross-workspace search mode.

## 5. Requirements
1. Define a local, gitignored workspace configuration format, for example `.gke/workspaces.json`, with:
   - `id`
   - `label`
   - `repoRoot`
   - `scanRoots`
   - `writeRoots`
   - `readOnly`
   - `sensitivity` (`personal`, `internal`, `sensitive`, `restricted`)
   - `auditLogPath`
2. Add a setup command such as:
   - `npm run setup:mcp -- --workspace personal`
   - `npm run setup:mcp -- --workspace client-alpha`
3. Generate a separately named MCP entry for each workspace, such as `kb-personal` and `kb-client-alpha`.
4. Do not expose a runtime tool argument that switches an already running server to another workspace.
5. Resolve and freeze the workspace profile at process startup. Every path operation must be checked against that profile.
6. Add a `kb.workspace_info` read-only tool returning workspace ID, label, sensitivity, write mode, and allowed roots.
7. Include workspace metadata in every tool’s structured response.
8. Add a Leakage Guard that blocks:
   - Path traversal
   - Symlink escape
   - Reads outside allowed roots
   - Writes outside write roots
   - Writes in read-only mode
   - Explicit paths belonging to another configured workspace
9. Mutating tools must require both `KB_MCP_ENABLE_WRITES=true` and workspace write permission.
10. Add an audit event for each tool invocation containing timestamp, workspace ID, tool, operation type, allowed/blocked result, target paths, and a privacy-safe query fingerprint.
11. Do not log full document contents, secrets, or complete user questions by default.
12. Add a Cockpit workspace banner showing the workspace label, sensitivity, and read/write state.
13. Use strong visual differentiation for `sensitive` and `restricted` workspaces.
14. Add a confirmation step before exporting or copying a handoff from a sensitive workspace.
15. Add `npm run workspace:doctor -- <id>` to validate roots, symlinks, overlapping workspaces, permissions, and MCP configuration.
16. Refuse startup when two sensitive workspaces have overlapping writable roots.
17. Document a recommended model: one process and one agent connection per workspace.

## 6. Technical Constraints
1. Implement the workspace, runtime-data, path-authorization, and MCP-mapping contracts from `docs/workspace-data-architecture.md`.
2. Apply workspace policy below the shared MCP catalog so profiles, resources, and every future semantic tool inherit the same authorization.
3. Isolation must be enforced in filesystem and retrieval code, not only in prompts or UI.
4. Canonical Markdown remains inside each workspace root; no central database may silently merge content across workspaces.
5. Normalize paths with `realpath` before authorization checks to prevent symlink and `..` escapes.
6. Default every new workspace to read-only until the user explicitly enables writes.
7. Treat workspace configuration and audit logs as local operational data; gitignore them by default.
8. Audit logging must fail safely. If a restricted workspace requires audit and the log cannot be written, mutating operations must fail.
9. Keep query fingerprints one-way and salted per installation if implemented.
10. Do not add a “search all clients” convenience feature.
11. The remote MCP plan must reuse this workspace policy layer rather than create a second authorization model.
12. Existing single-workspace setups must continue to work through an explicit `default` profile or backward-compatible environment mapping.

## 7. Implementation Notes
1. Suggested files:
   - `tools/workspaces/types.ts`
   - `tools/workspaces/config.ts`
   - `tools/workspaces/path-policy.ts`
   - `tools/workspaces/audit.ts`
   - `tools/workspaces/doctor.ts`
2. Refactor server startup so `repoRoot`, scan roots, write roots, and identity come from one immutable workspace context object.
3. Inject the workspace context into retriever and write functions instead of reading broad process globals throughout the code.
4. Extend `scripts/configure-mcp.mjs` to generate multiple named entries without overwriting existing profiles.
5. Add overlap detection using normalized real paths.
6. Add fixtures with identical filenames and keywords in two sandbox workspaces. Include a secret marker in each and assert it never appears in the other workspace.
7. Add blocked-attempt tests for traversal, absolute external paths, symlinks, and write-root mismatch.
8. Add Cockpit configuration via build-time workspace metadata for v1. A runtime multi-workspace switcher is deliberately excluded because it weakens the visible boundary.
9. Consider a small shell command that launches the Cockpit for one selected workspace and prints its sensitivity banner.
10. Update `SECURITY.md`, `docs/architecture.md`, and the MCP setup documentation after implementation.

## 8. Test Requirements
1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `No dedicated lint script exists today; record lint as N/A unless the implementation adds one.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria
1. Starting `kb-client-alpha` indexes only Client Alpha roots and returns its workspace identity in every response.
2. Queries for known Client Beta-only markers return no evidence from Client Alpha.
3. Direct path, traversal, and symlink attempts outside the workspace are blocked and audited.
4. A read-only workspace cannot write even when the global write environment variable is enabled.
5. The Cockpit visibly identifies the active workspace and sensitivity level on every view.
6. `workspace:doctor` detects overlapping writable roots and exits nonzero.
7. Existing default local setup remains functional and all prior tests remain green.

## 10. Deliverables
1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules
1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.

## 12. Assumptions and Open Questions
- Assumptions:
  1. Strong isolation is more valuable than seamless global search for the target consultant persona.
  2. Separate MCP entries are acceptable in Claude, Codex, Gemini, and GitHub Copilot clients.
  3. The first release is single-user and local.
- Open questions:
  1. Should audit logs be JSON Lines, SQLite, or both?
  2. Should restricted workspaces require an explicit per-session write unlock?
  3. Should workspace configuration support environment-variable interpolation for portable team templates?
