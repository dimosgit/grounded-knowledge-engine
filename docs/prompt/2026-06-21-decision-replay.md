# Feature Prompt Template

## 1. Feature Title
`Decision Replay — Research Once, Reuse and Revalidate Decisions Later`

## 2. Objective
Turn grounded research into a durable decision record that preserves the recommendation, alternatives, evidence, assumptions, caveats, and review date. A later agent session must be able to explain what was decided and why without repeating the original research, then revalidate only the evidence marked as stale. The feature should make GKE useful as decision infrastructure rather than only a document search layer.

## 3. Context
- Product area: `Grounding engine, MCP server, Markdown knowledge model, and Operator Cockpit`
- Current behavior: `GKE retrieves cited evidence, captures topic/term notes, ingests documents, and recalls captured notes across MCP clients. It does not distinguish a decision from a general note, track decision validity, preserve alternatives, or compare an old decision against newer evidence.`
- Problem to solve: `Consultants and technical users repeatedly research the same question because prior conclusions are buried in chats or undifferentiated notes. Even when a conclusion is found, the user cannot see whether its evidence is still current or which assumptions require revalidation.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Add a canonical Markdown decision record under `kb/decisions/`.
  2. Add MCP tools to record, retrieve, list, supersede, and review decisions.
  3. Preserve source citations, research dates, assumptions, alternatives, confidence, and a `review_after` date.
  4. Compare a saved evidence snapshot with newly supplied or newly ingested evidence and return a structured decision diff.
  5. Add a Decision Ledger and Decision Replay view to the Operator Cockpit.
  6. Add deterministic fixtures and end-to-end tests proving record → recall → review → supersede.
- Out of scope:
  1. Running autonomous internet research inside the GKE server.
  2. Treating a saved recommendation as permanently correct.
  3. Replacing Markdown with a database as the source of truth.
  4. Automatically executing the business decision.
  5. Multi-user approval workflows in the first release.

## 5. Requirements
1. Define a decision note schema with these minimum fields:
   - `decision_id`
   - `project_id`
   - `status` (`proposed`, `active`, `superseded`, `rejected`)
   - `decided_at`
   - `evidence_checked_at`
   - `review_after`
   - `confidence`
   - `owner`
   - `tags`
2. Render stable Markdown sections for:
   - Decision question
   - Recommendation
   - Alternatives considered
   - Rationale
   - Assumptions
   - Risks and caveats
   - Evidence snapshot with file-and-line citations
   - Review history
   - Supersession link
3. Add `kb.record_decision`. It must accept structured decision fields, validate every citation against the active KB, support `dryRun`, and write only under `kb/decisions/`.
4. Add `kb.get_decision`. It must resolve by ID, slug, path, title, or project and return both readable text and structured content.
5. Add `kb.list_decisions`. It must filter by project, status, review state (`current`, `due`, `overdue`), owner, and tag.
6. Add `kb.review_decision`. It must accept a decision ID plus a new evidence set or paths to newly ingested evidence. It must compare old and new evidence without silently overwriting the original snapshot.
7. `kb.review_decision` must classify changes as:
   - `unchanged`
   - `strengthened`
   - `weakened`
   - `contradicted`
   - `missing`
   - `new`
8. A review result must explicitly identify which assumptions need human validation and whether the recommendation remains supported.
9. Add `kb.supersede_decision`. It must preserve the old decision, mark it `superseded`, and link both records.
10. Never describe a decision as current when `review_after` is in the past. Responses must carry a stale/overdue warning.
11. Add a Cockpit Decision Ledger showing status, project, confidence, evidence date, review date, and stale state.
12. Add a Decision Replay detail page with the original rationale, citations, timeline, and side-by-side evidence diff.
13. Add a prominent `Review what changed` action. In v1 this action consumes local/ingested evidence; it does not perform web research itself.
14. Preserve compatibility with existing topic and term notes. Existing KBs must continue to index and render unchanged.
15. Document a demo scenario that compares Valencia, Málaga, and Lisbon, records Valencia as the pilot recommendation, simulates a later session, and reviews the decision from newer evidence.

## 6. Technical Constraints
1. Implement the decision, source, checkpoint, identifier, relationship, and citation contracts from `docs/workspace-data-architecture.md`.
2. Extend the semantic MCP catalog and reusable output schemas established by MCP Core Modernization; decision records must also be addressable resources.
3. Markdown under `kb/` remains canonical. SQLite/BM25 data remains derived and regenerable.
4. Extend the write path deliberately; do not force decision records through the current topic-only frontmatter renderer.
5. Use a dedicated parser/renderer module, for example `tools/decisions/decision-record.ts`, shared by CLI, MCP handlers, and tests.
6. Decision IDs must be stable and deterministic once created. Use a human-readable slug plus a collision-safe suffix or generated ID stored in frontmatter.
7. Validate all dates as ISO `YYYY-MM-DD`. Treat invalid or missing dates as errors for decision creation.
8. Do not infer that evidence is current from file modification time alone. Freshness comes from explicit `evidence_checked_at`, source metadata, or review input.
9. Reviews must be append-only in history. Updating a decision must not erase prior evidence or rationale.
10. Real writes remain guarded by `KB_MCP_ENABLE_WRITES=true`; every mutating tool must support `dryRun=true`.
11. Tool responses must remain compact by default and expose full evidence only when requested.
12. Avoid adding a network dependency to the local engine. External research remains the responsibility of the connected agent or a later connector.

## 7. Implementation Notes
1. Suggested engine files:
   - `tools/decisions/types.ts`
   - `tools/decisions/decision-record.ts`
   - `tools/decisions/decision-diff.ts`
   - `tools/decisions/decision-test.ts`
2. Suggested MCP changes:
   - Extend `tools/kb-mcp-server/server.ts` tool definitions and handlers.
   - Keep protocol handling separate from decision-domain functions.
   - Add decision tools to `tools/kb-mcp-server/README.md`.
3. Suggested Cockpit changes:
   - `apps/cockpit/src/domain/decisions.ts`
   - `apps/cockpit/src/views/DecisionLedgerView.tsx`
   - `apps/cockpit/src/views/DecisionReplayView.tsx`
   - Route and navigation additions in existing routing/frame code.
4. Add `decisions` to catalog classification without reclassifying ordinary topic notes.
5. A useful v1 review algorithm can be deterministic: normalize citation identity, compare source path/section/fingerprint, and require the caller to provide a short claim assessment. Do not pretend lexical diff alone proves factual contradiction.
6. Add a CLI path, such as `npm run decisions -- list --due`, so the lifecycle can be tested without an agent.
7. Add a demo decision fixture with a deliberately overdue review date and a second evidence set that weakens one assumption.
8. If a cited source disappears, preserve the old citation and mark it `missing`; never silently drop it.
9. If a decision is superseded, retrieval should prefer the active replacement while still allowing explicit historical lookup.
10. Update `docs/architecture.md` with the decision lifecycle and `README.md` with the user-facing value proposition after implementation.

## 8. Test Requirements
1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `No dedicated lint script exists today; record lint as N/A unless the implementation adds one.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria
1. A connected MCP client can record a cited decision and retrieve it in a fresh session without repeating the research.
2. An overdue decision is always returned with a visible stale warning and its original evidence date.
3. Reviewing a decision with newer local evidence produces a structured before/after diff without changing the original evidence snapshot.
4. Superseding a decision preserves both records and creates bidirectional links.
5. The Cockpit can list decisions, filter overdue items, open a decision timeline, and display changed evidence.
6. The Valencia demo completes record → later recall → evidence review → retained or superseded recommendation.
7. Existing ingestion, grounding, capture, project board, and graph tests remain green.

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
  1. The connected agent can perform external research when the user requests it, then pass citations/evidence into GKE.
  2. Decision review is primarily a human-supervised workflow; GKE provides traceability, not autonomous authority.
  3. `kb/decisions/` is acceptable as a new canonical note category.
- Open questions:
  1. Should confidence be a constrained label only, a numeric score, or both?
  2. Should review reminders remain visible only in the Cockpit, or also emit an optional machine-readable due list for external automation?
  3. Should a later release support approval/sign-off history for team decisions?
