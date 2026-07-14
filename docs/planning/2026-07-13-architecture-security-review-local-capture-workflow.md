# Architecture and Security Review: Local Capture Workflow

**Status:** Implemented review baseline. **Date:** 2026-07-13. **Scope:** grounded
Ask, capture routing, proposal application, project-task and lifecycle mutation,
and the local Cockpit adapters.

## Architecture Summary

The capture workflow keeps Markdown as canonical storage and treats
`.gke/capture-proposals/` as disposable local operational state. The engine
plans a capture, resolves track/module/project context, and either applies a
clear new-note create immediately or persists a review-required proposal.

The local Cockpit calls same-origin Vite development middleware. Grounded Ask
delegates to a provider-neutral answer service with injected retriever and
document dependencies. Capture reruns grounding server-side, then delegates to
the shared planner; successful immediate create or reviewed apply refreshes the
active retrieval backend after the atomic Markdown write. The middleware uses
Vite's `apply: "serve"` boundary, so it is not registered in the production
static build.

Project tasks use a separate project application service and canonical
`Delivery checklist` syntax. This avoids treating actionable work as a generic
knowledge note and keeps Cockpit task parsing compatible with CLI mutations.

## Security Findings

### Implemented controls

- Capture targets and proposal paths are workspace-relative, realpath checked,
  and constrained to approved Markdown roots.
- Existing-target mutations require an exact base-content hash; stale or
  concurrent apply attempts fail without removing the proposal.
- Project identities supplied explicitly or inferred from evidence are checked
  against canonical project records. Inferred membership remains review-only.
- The Cockpit capture adapter accepts loopback connections and loopback hosts
  only. Mutations additionally require a same-origin browser request,
  `application/json`, a bounded body, known fields, and an explicit action.
- Conflict responses use HTTP 409 and retain the proposal for another review.
- Proposal summaries omit note bodies, citations, and duplicate-candidate
  details until one proposal is explicitly opened.
- The public static Cockpit has no registered capture mutation adapter.
- Ask responses expose a bounded answer/evidence contract and omit retriever
  debug state. Browser-provided answer text is never trusted for capture;
  grounding is rerun inside the local adapter.
- Project lifecycle writeback now shares the loopback, same-origin, strict JSON,
  body-size, known-field, safe-error, and realpath-confinement controls.

### Remediated finding: lifecycle write-back boundary

**Previous severity:** Medium. The older inline lifecycle middleware lacked the
capture adapter's request controls. It is now extracted behind the shared local
request guard, strict schema/body validation, safe errors, and realpath
confinement. Focused tests cover missing/cross-protocol origins, oversized and
unknown input, logical `kb/` to physical `demo-kb/` resolution, and symlink
escape rejection.

## Improvement Proposals

1. **Delivered:** reuse one local-development request guard for Ask, capture,
   and project lifecycle mutations, with shared loopback, same-origin,
   content-type, and size rules.
2. Complete the broader application-service extraction so MCP stdio, local
   Cockpit, and future adapters share orchestration without importing protocol
   handlers.
3. Add route overrides to proposal apply only if real usage shows that
   rejecting and recapturing an ambiguous route is too slow. Avoid adding
   controls before that need is demonstrated.
4. Add a production-build assertion that server mutation modules and local
   endpoint strings remain absent from generated client assets.

## Execution Plan

### P0 — Delivered

- Conflict-safe proposal planning and atomic apply.
- Fuzzy matches are advisory only.
- Local proposal exclusion from retrieval, sync, export, and resources.

### P1 — Delivered

- Deterministic routing precedence and machine-readable decisions.
- Verified project defaults and conservative evidence consensus.
- Dedicated project-task mutation with duplicate protection and dry-run.

### P2 — Delivered

- Local grounded Ask with confidence, gate reasons, citations, evidence
  excerpts, and an explicit capture action.
- Local Cockpit queue, current/proposed preview, evidence and route display,
  explicit apply, reject, conflict retention, and retrieval refresh.
- Development-only hardened capture adapter; public preview remains read-only.
- End-to-end Ask → capture → refresh → re-Ask coverage proves the captured note
  becomes cited evidence.

### Follow-up

- Consider a first-class open-question application service for explicitly
  retaining abstained local Ask results without treating them as canonical
  knowledge.
- Consolidate the remaining project lifecycle filesystem mutation behind the
  broader project application-service boundary.
