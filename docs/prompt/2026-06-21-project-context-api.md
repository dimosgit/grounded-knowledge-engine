# Feature Prompt Template

## 1. Feature Title
`Project Context API — Promote Cockpit Project Intelligence Into the GKE Core`

## 2. Objective
Promote the project intelligence already visible in the Operator Cockpit into a stable, cited core-engine contract available to every MCP client. A consultant returning after days or weeks must receive the same project context—current focus, meaningful changes, decisions, blockers, open questions, next actions, and key documents—whether they use the Cockpit, Claude, Codex, Gemini, GitHub Copilot, or another client. Use that shared contract to produce reliable personal-resume and colleague/client handoff capsules.

## 3. Context
- Product area: `Project model, retrieval scoping, MCP tools, and Operator Cockpit project views`
- Current behavior: `The Cockpit already derives a project board, project dashboard, current focus, blockers, next actions, linked resources, and quick-recall views from Markdown. That intelligence lives mainly in frontend parsing and UI conventions. MCP clients have no equivalent structured Project Context API, no checkpoint history, and no exportable handoff artifact.`
- Problem to solve: `The product presents useful project intelligence in one interface but does not expose it as a reusable core capability. Users switching projects or agents must reconstruct the same context manually, and different clients can produce inconsistent project summaries.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Introduce a canonical project manifest and checkpoint format under `kb/projects/`.
  2. Add project-scoped retrieval that cannot silently include unrelated projects.
  3. Add MCP tools for project resume, checkpoint creation, and handoff export.
  4. Refactor the Cockpit project and quick-recall views to consume the shared Project Context model instead of maintaining a UI-only interpretation.
  5. Add Markdown export suitable for another human or agent.
  6. Prove that a fresh agent session can resume a project from the capsule and citations.
- Out of scope:
  1. Full task-management replacement for Jira, Planner, or Linear.
  2. Automatic time tracking.
  3. Sending handoff messages to external systems.
  4. Cross-workspace retrieval; that belongs to the Workspace Vaults feature.
  5. LLM-generated summaries inside the deterministic local server unless supplied by the calling agent.

## 5. Requirements
1. Define a project manifest with:
   - `project_id`
   - `title`
   - `workspace`
   - `status`
   - `owner`
   - `started_at`
   - `updated`
   - `review_after`
   - `source_roots`
   - `tags`
2. Define stable Markdown sections for:
   - Outcome / definition of done
   - Current focus
   - Last meaningful change
   - Active decisions
   - Blockers
   - Open questions
   - Next actions
   - Key documents
   - Checkpoint history
3. Add `kb.resume_project`. It must require `project_id`, retrieve only sources belonging to that project, and return:
   - A short “start here” brief
   - Current focus
   - Recent changes
   - Active decisions
   - Blockers and unresolved questions
   - The next three actions
   - Citations for every factual section
4. Add `kb.checkpoint_project`. It must append a dated checkpoint rather than overwrite history and support `dryRun`.
5. Add `kb.create_handoff`. It must produce a portable Markdown handoff with a configurable audience (`self`, `technical_peer`, `manager`, `client`) and detail level.
6. A handoff must include a generated-at timestamp and clearly separate facts, recommendations, risks, and unresolved questions.
7. Project capsules must identify stale sections when the project or linked evidence has not been updated within a configured threshold.
8. Add a Cockpit `Resume project` action that opens a capsule-first view before the full project dashboard, powered by the same Project Context model returned through MCP.
9. Add a `Copy handoff` / `Download Markdown` action without modifying the canonical project record.
10. Add a “last resumed” local UI marker, but do not write a canonical checkpoint merely because the project was viewed.
11. Retrieval must reject unknown project IDs and must not fall back to global search when a project scope returns no evidence.
12. Add a deterministic project-linking rule based on frontmatter `project_id`, explicit Markdown links, or configured source roots.
13. Add migration support for the current demo project-board note so existing project UI behavior remains intact.
14. Add a demo with at least two projects containing overlapping vocabulary and prove that each capsule cites only its own project.

## 6. Technical Constraints
1. Implement the project, checkpoint, identifier, relationship, and citation contracts from `docs/workspace-data-architecture.md`.
2. Extend the semantic MCP catalog established by MCP Core Modernization; do not add low-level project file CRUD tools.
3. Project scope must be enforced before ranking, not applied only after global retrieval.
4. The project manifest and checkpoints remain Markdown source data. Generated capsules are derived output unless explicitly saved by `kb.checkpoint_project`.
5. Do not infer project membership solely from semantic similarity. Require explicit metadata, path ownership, or links.
6. Reuse existing retrieval, citation, open-question, and decision capabilities rather than duplicating them.
7. Keep `kb.resume_project` read-only. Mutations require a separate explicit tool call.
8. Enforce a response size budget and default to a compact capsule suitable for agent context windows.
9. Preserve exact source paths and line references in structured content.
10. Handoff export must not include source files outside the active project boundary.
11. All mutating actions remain protected by `KB_MCP_ENABLE_WRITES` and support `dryRun`.
12. The feature must work over both BM25 and SQLite retrieval backends.

## 7. Implementation Notes
1. Suggested files:
   - `tools/projects/types.ts`
   - `tools/projects/project-manifest.ts`
   - `tools/projects/project-scope.ts`
   - `tools/projects/project-capsule.ts`
2. Extend the retriever API with an explicit allowed-path predicate or project filter that is applied during indexing/search.
3. Extend `tools/kb-mcp-server/server.ts` with `kb.get_project_context`, `kb.resume_project`, `kb.checkpoint_project`, and `kb.create_handoff`.
4. Move reusable project parsing from UI-only code into a shared deterministic project-domain layer; keep the Cockpit adapter thin.
5. Add project records to catalog classification in `apps/cockpit/src/domain/docs.ts` without breaking existing `type: project` topic notes.
6. Add a dedicated capsule component to `ProjectDetailView.tsx` or a new `ProjectResumeView.tsx`.
7. Keep audience-specific handoff templates deterministic. The calling agent may polish prose, but the server must provide the grounded facts and citations.
8. Checkpoint entries should carry a unique checkpoint ID, date, author, summary, next actions, and cited changes.
9. Add a `project_id` field to relevant future decision records so Decision Replay can feed the capsule.
10. Add fixtures such as `client-alpha` and `personal-ai-tutor` with intentionally overlapping terms like “pilot,” “deployment,” and “review.”
11. Update the README with a “Switch projects without losing the thread” workflow after implementation.

## 8. Test Requirements
1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `No dedicated lint script exists today; record lint as N/A unless the implementation adds one.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria
1. A fresh MCP client session can request one project and receive a cited capsule with focus, blockers, decisions, and next actions.
2. Two projects with overlapping vocabulary never cross-contaminate each other’s capsule.
3. A checkpoint appends to history and is visible in the next resume response.
4. A handoff Markdown file is useful without access to the prior chat and contains explicit unresolved items.
5. The Cockpit and MCP return equivalent project facts and citations from the shared Project Context model.
6. The Cockpit provides a one-click resume view and an exportable handoff.
7. Unknown or empty project scopes abstain clearly instead of falling back to global context.
8. Existing project board drag-and-drop and document views remain green.

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
  1. Every active project can be assigned a stable `project_id`.
  2. Users prefer an explicit checkpoint action over silent automatic writes.
  3. The initial handoff artifact is Markdown; PDF/DOCX export can reuse later document-generation tooling.
- Open questions:
  1. Should project checkpoints be one file per checkpoint or an append-only section in the project manifest?
  2. Should “recent changes” use Git history when available, note metadata only, or both?
  3. Which audience template should be demonstrated publicly: technical peer or manager?
