# Feature Prompt Template

## 1. Feature Title

`Cockpit Daily Attention and Project Delta View`

## 2. Objective

Expose the engine's implemented daily-review signals in the Cockpit so an
operator can identify due projects, blockers, open questions, and explicitly
scoped changes without switching to the CLI.

## 3. Context

- Product area: `Project Board, Hub, shared project model, workspace review service, and local read-only adapters`
- Current behavior: `gke review and gke://workspace/review return attention and changed-document data; the Cockpit does not expose attention filters or changed-since output.`
- Problem to solve: `The engine knows what needs attention, but the primary operator UI cannot act on that information.`

## 4. Scope

- In scope:
  1. Due/overdue, blocker, and open-question attention summaries.
  2. Project Board filters based on those signals.
  3. A local read-only changed-since view with citations.
  4. Browser-safe reuse of shared attention semantics.
- Out of scope:
  1. Editing review dates, blockers, or questions from this view.
  2. Decision review or checkpoint creation.
  3. Global Git history visualization.
  4. A new MCP tool.

## 5. Requirements

1. Extract due-state and attention-reason calculation into a browser-safe shared
   project module if it is currently coupled to Node filesystem or Git code.
2. Keep filesystem/Git change discovery in the Node application-service layer.
3. Add a read-only local endpoint for workspace review that accepts bounded ISO
   `asOf` and optional `since` values and reuses `reviewWorkspace`.
4. Apply the shared loopback, same-origin, strict-input, safe-error, and timeout
   controls used by other local adapters.
5. Add Hub attention counts for overdue/due projects, blocked projects, and
   projects with open questions.
6. Add Project Board filters: `all`, `needs attention`, `overdue`, `blocked`, and
   `open questions`. Filters must compose with existing status lanes.
7. Add an optional `since` control with a valid ISO date and display changed
   explicitly scoped documents with workspace-relative citations.
8. Selecting an attention item navigates to the corresponding project or document.
9. In the static public build, show due/blocker/open-question signals derived from
   synced demo Markdown, but do not call a local endpoint or claim Git deltas are available.
10. Clearly label change provenance (`git`, `frontmatter`, or `mtime`) in the local view.

## 6. Technical Constraints

1. Project membership remains explicit and change discovery stays within project scope.
2. Do not import Node-only modules into browser bundles.
3. Do not duplicate due-state rules independently in React components.
4. Preserve current Project Board drag/write behavior.
5. The production-boundary assertion must continue to pass.

## 7. Implementation Notes

1. Suggested areas: `tools/projects/project-review.ts`, a new browser-safe
   `tools/projects/project-attention.ts`, Cockpit domain project transforms, a
   local Vite plugin/API helper, Hub, and Project Board tests.
2. Use a fixed injected `asOf` date in tests to avoid timezone-dependent failures.
3. Keep the first UI compact: summary cards, filters, and one changed-document list.
4. Avoid adding charts unless they materially improve the attention workflow.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm run lint && npm --prefix apps/cockpit run lint`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:project-review && npm run test:projects && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm --prefix apps/cockpit run test:production-boundary`
   - Formatting: `npm run format:check && npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Engine and Cockpit calculate the same due/overdue state for the same project and date.
2. Each attention filter returns only matching projects without breaking status lanes.
3. A local `since` query shows only changed explicitly scoped documents with resolvable citations.
4. Static public mode makes no local review request and does not display fake change history.
5. Attention items navigate to the correct project or document.

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
  1. Daily attention is read-only in the Cockpit for this milestone.
- Open questions:
  1. None. Do not add notification scheduling or reminders in this task.
