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
  1. Introduce a canonical project manifest and checkpoint format under `kb/projects/`, with compatibility reads for existing project notes.
  2. Add project-scoped retrieval that cannot silently include unrelated projects.
  3. Add one compact MCP project-resume operation, an addressable project-context resource, and a deterministic technical-peer handoff.
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
3. Add `kb.resume_project` as the only new core project tool in the first milestone. It must require `project_id`, retrieve only sources belonging to that project, and return:
   - A short “start here” brief
   - Current focus
   - Recent changes
   - Active decisions
   - Blockers and unresolved questions
   - The next three actions
   - Citations for every factual section
4. Expose the same deterministic payload as an addressable resource such as `gke://project/<project-id>/context`; do not add a duplicate `kb.get_project_context` getter tool.
5. Produce one deterministic technical-peer Markdown handoff from the resume payload. Treat additional audiences as follow-up work rather than separate first-release templates.
6. A handoff must include a generated-at timestamp and clearly separate facts, recommendations, risks, and unresolved questions. It may initially be exposed as a Cockpit action, MCP prompt, or deterministic formatter rather than another advertised MCP tool.
7. Design the capsule contract so stale-section metadata can be added later, but do not block the first read-only milestone on configurable freshness UX.
8. Refactor the Cockpit to consume the same Project Context model. Add a dedicated capsule-first `Resume project` view only after MCP/Cockpit parity is proven.
9. Add a `Copy handoff` / `Download Markdown` action without modifying the canonical project record.
10. Do not add “last resumed” metadata in the first milestone and never create a canonical checkpoint merely because the project was viewed.
11. Retrieval must reject unknown project IDs and must not fall back to global search when a project scope returns no evidence.
12. Add a deterministic project-linking rule based on frontmatter `project_id`, explicit Markdown links, or configured source roots.
13. Add compatibility support for current project notes:
    - Resolve identity as `project_id`, then legacy `module`, then a stable title/path slug.
    - Accept canonical `Next actions` and legacy `Next 3 actions`.
    - Continue reading existing `lifecycle` values while new records adopt the canonical project schema.
    - Do not require a bulk rewrite before the shared parser can ship.
14. Add a demo with at least two projects containing overlapping vocabulary and prove that each capsule cites only its own project.

## 6. Technical Constraints
1. Implement the project, checkpoint, identifier, relationship, and citation contracts from `docs/workspace-data-architecture.md`.
2. Extend the semantic MCP catalog established by MCP Core Modernization without exceeding its tool-count or serialized-schema budgets. Prefer resources and prompts for addressable context and presentation workflows; do not add low-level project file CRUD tools.
3. Project scope must be enforced before ranking, not applied only after global retrieval.
4. The project manifest and any future checkpoints remain Markdown source data. Generated capsules are derived output; the first read-only milestone does not save them implicitly.
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
3. Extend `tools/kb-mcp-server/server.ts` with `kb.resume_project` and a project-context resource. Add checkpoint mutation only after the read-only resume milestone is proven.
4. Move reusable project parsing from UI-only code into a shared deterministic project-domain layer; keep the Cockpit adapter thin and preserve legacy aliases during migration.
5. Add project records to catalog classification in `apps/cockpit/src/domain/docs.ts` without breaking existing `type: project` topic notes.
6. Add a dedicated capsule component to `ProjectDetailView.tsx` or a new `ProjectResumeView.tsx`.
7. Keep the first technical-peer handoff deterministic. The calling agent may polish prose, but the server must provide the grounded facts and citations.
8. For the follow-up checkpoint milestone, entries should carry a unique checkpoint ID, date, author, summary, next actions, and cited changes.
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
1. A fresh MCP client session can request one project and receive a compact cited capsule with focus, blockers, decisions, and next actions without exceeding the MCP catalog budget.
2. Two projects with overlapping vocabulary never cross-contaminate each other’s capsule.
3. The same project context is addressable as a `gke://` resource without adding a duplicate getter tool.
4. A technical-peer handoff Markdown file is useful without access to the prior chat and contains explicit unresolved items.
5. The Cockpit and MCP return equivalent project facts and citations from the shared Project Context model.
6. The Cockpit consumes the same project facts and can export the technical-peer handoff; a dedicated resume route may follow after parity is proven.
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
  3. After the technical-peer handoff is proven, is a manager or client variant valuable enough to justify another deterministic template?

## 13. Review
**Roast by Antigravity Reviewer:**
The Feasibility is high but it risks duplicating state if not careful. The UI should really just be a thin view over the API, but building out a full schema right now is probably over-engineering unless you have actual clients needing this today. Focus on the core value first instead of making a bloated manifest. It solves a real problem, but MVP should be much smaller than proposed.

## 14. Claude Reviewer — Roast & Feasibility

**Verdict: BUILD — it's the only one of the three that earns its keep — but the plan undersells how much real engineering hides behind the word "promote."**

### The "it already exists in the Cockpit, just promote it" framing is a lie of convenience

The plan repeatedly says this is lifting Cockpit intelligence into the core (Objective, Context, scope item 4). The code disagrees:

- The Cockpit parser (`apps/cockpit/src/domain/projects.ts`) reads `## Next 3 actions` and `## Blockers`, derives `project_id` from the `module` frontmatter field (or a title slug), and drives lanes off a bespoke `lifecycle:` field.
- The normative contract (`docs/workspace-data-architecture.md`) invents a *different* schema: `project_id` frontmatter, `kb/projects/<id>/project.md`, and `## Next actions` (no "3").

These two disagree on section names, the identifier field, and the file layout. This is not "promote the existing model" — it's "design a new model, then rewrite both the Cockpit parser and every existing project note to match it." Requirement 13 quietly admits the migration; the effort framing throughout still pretends it's a refactor. **It's a re-modeling plus a migration. Price it that way.**

### You cannot add four tools without violating your own CI gate

Requirements 3–5 (plus `kb.get_project_context` from the roadmap) add four tools. But `catalog.ts:384-385` sets `core` = **4 tools max**, `full` = **10 max**; `core` holds 3 today and `full` is already at **exactly 10** with writes on, and `schema-budget-test.ts:21` fails CI the instant you exceed either. Four new tools blows both budgets on contact. The architecture's own invariant #11 ("addressable knowledge is exposed through **resources**, not more getter tools") gives the fix the plan ignores: **`get_project_context` should be a `gke://` resource, not a tool**, and `create_handoff` is closer to a `prompt` over the resume payload. Realistically only `resume_project` + one mutation belong on the tool surface. The plan adds tools as if they were free; you wrote the test that proves they aren't.

### "Scope before ranking" is the hard part, and it's hand-waved

Requirement 11 + Technical Constraint #3 + the architecture's retrieval lifecycle demand project filtering *before* ranking. The current retriever (`tools/grounding/retriever.ts`) has no such hook: `search()` ranks across the whole `scanRoots` index, cache-keyed by `repoRoot::scanRoots::cachePath`. A per-project predicate has to thread through ranking **and** the cache key, or you build a sub-index per project. Implementation Note 2 buries this in one line; it's ~40% of the real work. The abstain-don't-fall-back rule (11) is correct and is the single most demo-worthy behavior here — make it a first-class test, not an afterthought.

### Scores (1–5; complexity/risk: 5 = worst)

| Dimension | Score | Why |
|---|---|---|
| User pain solved | 4 | Project resumption is a frequent consultant pain. |
| Differentiation | 3 | "Resume with citations across any agent" is distinctive; checkpoints/handoffs are commodity. |
| Portfolio/hiring signal | 5 | *The* feature that proves "AI-assisted project memory." Strongest CV-A/C story. |
| Architectural necessity | 4 | The shared project-domain layer is a prerequisite the other two lean on. |
| Demo clarity | 5 | "Resume Client Alpha → cited context → export handoff" is a clean 30s story. |
| Implementation complexity | 4 | Re-model + migration + retriever scoping + Cockpit rewrite. Not the cheap lift it's dressed as. |
| Security/operational risk | 2 | Read-mostly; main risk is cross-project leakage, which the tests already target. |

### MVP / Follow-up / Cut

- **Essential MVP:** one shared deterministic project parser (delete the Cockpit-only one); `project_id`-scoped retrieval that **abstains** instead of falling back; `kb.resume_project` returning a cited capsule; `get_project_context` as a **resource**; the two-overlapping-projects isolation test (Acceptance #2). That's the whole demo.
- **Valuable follow-up:** `kb.checkpoint_project` (append-only history), stale-section detection (Req 7), the Cockpit "Resume" view.
- **Cut now:** four audience-specific handoff templates — ship **one** (technical peer); the "last resumed" UI marker (Req 10); migrating the *demo* board if rewriting the fixture is cheaper.

### Effort

~6–9 focused engineer-days (low–medium confidence). Retriever scoping and the single-parser refactor dominate; MCP wiring is trivial by comparison. Any "2–3 day" quote hasn't read `retriever.ts`.

**Bottom line:** the keeper. Build it first, build it small, and let abstain-on-wrong-project carry the demo. Your own catalog test will reject the four-tool, four-template sprawl anyway.

— *Claude Reviewer*

## 15. Accepted Decisions — 2026-06-22

1. Build this feature first, but as a compatibility-first MVP rather than a bulk project-note migration.
2. Treat the work as a new shared project model plus an incremental migration, not as a trivial Cockpit refactor.
3. Make project filtering before ranking and explicit abstention the central correctness requirement and public demo proof.
4. Add only `kb.resume_project` to the first MCP tool milestone. Expose project context as a resource and produce the handoff through a deterministic formatter, Cockpit action, or prompt.
5. Ship one technical-peer handoff first.
6. Defer checkpoint mutation, stale-state UX, additional audiences, and “last resumed” UI metadata until the read-only resume flow is proven.
7. Target effort: approximately 6–9 focused engineer-days, with retrieval scoping and parser unification as the dominant work.
