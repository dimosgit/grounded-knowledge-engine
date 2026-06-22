# Feature Prompt Template

## 1. Feature Title
`Workspace Vaults and Leakage Guard — Hard Boundaries Between Client and Personal Context`

## 2. Objective
Make GKE safe for a consultant who works across sensitive client and personal projects on the same machine. Introduce explicit workspace profiles, process-level isolation, read/write policy, and visible workspace identity so an agent cannot accidentally retrieve or capture information into the wrong workspace. Keep the first milestone focused on enforceable boundaries; audit and compliance features remain optional follow-up work.

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
  5. Add a minimal visible active-workspace label in the Cockpit.
  6. Add adversarial tests proving that one workspace cannot retrieve or write another workspace’s data.
- Out of scope:
  1. Enterprise multi-tenant SaaS hosting.
  2. Cloud key management in the first local release.
  3. Fine-grained per-document ACLs inherited from SharePoint or another external system.
  4. Automatic classification of all sensitive information.
  5. A global cross-workspace search mode.
  6. Mandatory audit logging, query fingerprints, and compliance-style reporting in the first local milestone.
  7. A full sensitivity-tier visual system or export-confirmation workflow.

## 5. Requirements
1. Define a local, gitignored workspace configuration format, for example `.gke/workspaces.json`, with:
   - `id`
   - `label`
   - `repoRoot`
   - `scanRoots`
   - `writeRoots`
   - `readOnly`
   - `sensitivity` (`personal`, `internal`, `sensitive`, `restricted`)
   - Optional `auditLogPath`
2. Add a setup command such as:
   - `npm run setup:mcp -- --workspace personal`
   - `npm run setup:mcp -- --workspace client-alpha`
3. Generate a separately named MCP entry for each workspace, such as `kb-personal` and `kb-client-alpha`.
4. Do not expose a runtime tool argument that switches an already running server to another workspace.
5. Resolve and freeze the workspace profile at process startup. Every path operation must be checked against that profile.
6. Extend the existing `gke://workspace/info` resource to return workspace ID, label, sensitivity, write mode, and allowed roots. Do not add a duplicate `kb.workspace_info` tool.
7. Include workspace metadata in every tool’s structured response.
8. Add a Leakage Guard that blocks:
   - Path traversal
   - Symlink escape
   - Reads outside allowed roots
   - Writes outside write roots
   - Writes in read-only mode
   - Explicit paths belonging to another configured workspace
9. Mutating tools must require both `KB_MCP_ENABLE_WRITES=true` and workspace write permission.
10. Add a minimal Cockpit workspace banner showing the workspace label and read/write state.
11. Validate workspace configuration at startup and fail when scan roots or write roots resolve outside the workspace root.
12. Document a recommended model: one process and one agent connection per workspace.
13. Treat audit logging, sensitivity-specific UI, overlap diagnostics, and export confirmations as follow-up capabilities driven by real operational need.

## 6. Technical Constraints
1. Implement the workspace, runtime-data, path-authorization, and MCP-mapping contracts from `docs/workspace-data-architecture.md`.
2. Apply workspace policy below the shared MCP catalog so profiles, resources, and every future semantic tool inherit the same authorization.
3. Isolation must be enforced in filesystem and retrieval code, not only in prompts or UI.
4. Canonical Markdown remains inside each workspace root; no central database may silently merge content across workspaces.
5. Normalize configured roots and filesystem targets with `realpath` before authorization checks to prevent symlink and `..` escapes. Apply this when roots enter the index and before writes, not only when a tool accepts a path argument.
6. Default every new workspace to read-only until the user explicitly enables writes.
7. Treat workspace configuration and audit logs as local operational data; gitignore them by default.
8. Do not make optional audit logging a dependency of the local write path. If audit is added later, it is best-effort by default; fail-closed behavior requires an explicit restricted-workspace policy.
9. Do not add a “search all clients” convenience feature.
10. The remote MCP plan must reuse this workspace policy layer rather than create a second authorization model.
11. Existing single-workspace setups must continue to work through an explicit `default` profile or backward-compatible environment mapping.

## 7. Implementation Notes
1. Suggested files:
   - `tools/workspaces/types.ts`
   - `tools/workspaces/config.ts`
   - `tools/workspaces/path-policy.ts`
2. Refactor server startup so `repoRoot`, scan roots, write roots, and identity come from one immutable workspace context object.
3. Inject the workspace context into retriever and write functions instead of reading broad process globals throughout the code.
4. Extend `scripts/configure-mcp.mjs` to generate multiple named entries without overwriting existing profiles.
5. Validate normalized real roots at startup. Explicitly cover configured roots outside `repoRoot`, root-level symlinks, nested symlink escapes, and write destinations whose existing parent resolves outside the workspace.
6. Add fixtures with identical filenames and keywords in two sandbox workspaces. Include a secret marker in each and assert it never appears in the other workspace.
7. Add blocked-attempt tests for traversal, external configured roots, symlinks, and write-root mismatch.
8. Add Cockpit configuration via build-time workspace metadata for v1. A runtime multi-workspace switcher is deliberately excluded because it weakens the visible boundary.
9. Update `SECURITY.md`, `docs/architecture.md`, and the MCP setup documentation after implementation.

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
3. External configured roots, traversal, and symlink attempts outside the workspace are blocked before indexing or writing.
4. A read-only workspace cannot write even when the global write environment variable is enabled.
5. The Cockpit visibly identifies the active workspace and read/write state on every view.
6. Existing default local setup remains functional and all prior tests remain green.

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
  1. Does real user testing justify an optional JSON Lines audit trail after the isolation milestone?
  2. Should restricted workspaces require an explicit per-session write unlock?
  3. Should workspace configuration support environment-variable interpolation for portable team templates?

## 13. Review
**Roast by Antigravity Reviewer:**
A physical trust boundary per process is a brilliant idea for paranoid consultants, but practically speaking, managing multiple MCP processes might be a nightmare UX-wise. Is it really better than strong access controls? It's highly secure but risks being too heavy and tedious. 4/5 feasibility but 2/5 for UX. A great portfolio signal for "enterprise security" but maybe a headache to actually use daily.

## 14. Claude Reviewer — Roast & Feasibility

**Verdict: BUILD A THIN SLICE. The core insight is right and cheap; 70% of this plan is enterprise theater bolted onto a 15–20h portfolio project.**

### Your headline security boundary already ships — you just haven't named it

The plan dresses "one immutable workspace per process" as a new architecture (scope 2, Req 4–5, Technical Constraint at the architecture doc). But the server *already* takes its entire identity from the environment at startup: `KB_MCP_REPO_ROOT`, `KB_MCP_SCAN_ROOTS`, and even `KB_MCP_WORKSPACE_ID` (`server.ts:671`). Run two configured MCP entries with different env and you already have two processes that each see only their own roots, with no runtime tool to switch. **The "hard boundary" is `separate process + separate scanRoots`, which the OS gives you for free.** The genuinely new, genuinely valuable 10% is the **Leakage Guard**: `realpath` normalization + traversal/symlink rejection on `kb.get_record` (which reads by path and is the one tool that can be coaxed outside the root). Build that. The rest is packaging.

### The plan gold-plates a single-user local tool into a compliance product

Assumption 3 says "single-user and local." Then the requirements ask for: per-installation salted one-way query fingerprints (Constraint 9), audit logging that **fails mutations closed** if the log can't be written (Constraint 8 / Req in §6.8), a `workspace:doctor` command that detects overlapping writable roots and exits nonzero (Req 15–16), sensitivity tiers with "strong visual differentiation" (Req 12–13), and confirmation gates before handoff export (Req 14). That is a SOC-2 evidence kit for an audience of one. For the portfolio artifact this is **scope poison**: it's weeks of work that a hiring manager cannot see in 60 seconds and that doesn't move any CV theme the Project Context API doesn't already cover better.

### "Fail mutations closed when audit can't be written" is a self-inflicted footgun

Constraint 8 turns your audit log into a single point of failure for the write path. On a single-user laptop, a full disk or a permissions hiccup now silently breaks capture. That's the kind of "secure by default" that gets ripped out the first time it blocks the owner mid-session. If you must have audit in v1 (you mustn't), it should be best-effort with a warning, not a write-blocker.

### Where the plan is actually correct

- "Tags/path-prefixes are not a security boundary" (Context, architecture §Workspace boundary) — **yes**, and worth stating in `SECURITY.md`.
- No runtime workspace-switch tool argument (Req 4) — **yes**, this is the right invariant and it's nearly free given the env-at-startup design.
- realpath before authorization (Constraint 5) — **yes**, this is the one piece of real defensive engineering here.

### Scores (1–5; complexity/risk: 5 = worst)

| Dimension | Score | Why |
|---|---|---|
| User pain solved | 3 | Real for true multi-client consultants; the *demo* persona is single-user. |
| Differentiation | 3 | "Process = trust boundary" is a clean story, but it's mostly OS isolation you're narrating. |
| Portfolio/hiring signal | 3 | "Enterprise boundaries" reads well on CV-B/D, but only if it's a tight Leakage Guard, not an audit framework. |
| Architectural necessity | 2 | Project Context + separate processes already deliver isolation; the rest is optional hardening. |
| Demo clarity | 4 | "Attempt to read Client B's secret from Client A's process → blocked + audited" is a strong 15s beat. |
| Implementation complexity | 4 | Only because the plan as written is huge; the *valuable* slice is 2. |
| Security/operational risk | 3 | Mostly self-inflicted (fail-closed audit). The path guard itself lowers risk. |

### MVP / Follow-up / Cut

- **Essential MVP:** freeze workspace identity from one immutable context object at startup (Implementation Note 2); `kb.workspace_info`; **Leakage Guard** = realpath + traversal/symlink/out-of-root rejection on every path-taking tool; the adversarial isolation test (two workspaces, identical filenames, secret marker never crosses — Implementation Note 6, Acceptance #2–3). This *is* the differentiator.
- **Valuable follow-up:** read-only default + write-root enforcement (Req 6, Acceptance #4); a Cockpit banner showing active workspace + sensitivity.
- **Cut now:** the audit log entirely (or make it best-effort, never write-blocking); `workspace:doctor`; query-fingerprint salting; sensitivity-tier visual system; handoff-export confirmation; refuse-startup-on-overlap. None of these survive contact with "single-user, 15–20h, must read in 60s."

### Effort

Valuable slice: ~3–5 engineer-days. The full plan as written: ~10–15 (low confidence — the doctor command, audit semantics, and Cockpit theming each balloon). The gap between those two numbers is the roast.

**Bottom line:** Ship the Leakage Guard and the per-process identity, prove it with one adversarial test, and stop. Everything past the path guard is you cosplaying as a compliance vendor for an audience of yourself.

— *Claude Reviewer*

## 15. Accepted Decisions — 2026-06-22

1. Build only the security kernel in the near-term roadmap.
2. Preserve one immutable workspace per process and generate separately named MCP entries for each workspace.
3. Focus the Leakage Guard on canonical root validation, indexing boundaries, symlink escapes, write roots, and adversarial isolation tests.
4. Do not add `kb.workspace_info`; extend the existing workspace resource.
5. Defer audit infrastructure, fingerprints, `workspace:doctor`, rich sensitivity theming, overlap reporting, and export confirmations.
6. Correct the peer-review risk diagnosis: `kb.get_record` selects from indexed documents and is not itself an arbitrary filesystem reader. The primary current risks are unvalidated configured scan roots, symlink resolution during indexing, and canonical write-target enforcement.
7. Target effort: approximately 3–5 focused engineer-days.
