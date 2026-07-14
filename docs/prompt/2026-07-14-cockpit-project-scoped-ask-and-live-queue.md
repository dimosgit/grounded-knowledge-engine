# Feature Prompt Template

## 1. Feature Title

`Cockpit Project-Scoped Ask and Live Capture Queue`

## 2. Objective

Make local Cockpit Ask honor the active project and make capture-review state
update immediately after a proposal is created. Give operators a direct
transition from an answer to the proposal that requires review.

## 3. Context

- Product area: `OperatorFrame, Project Detail, Ask drawer, Capture Review drawer, and local dev APIs`
- Current behavior: `AskDrawer accepts projectId but OperatorFrame always renders it without one; the capture queue fetches summaries only when opened; Ask and Capture Review do not share proposal state.`
- Problem to solve: `A question asked from Project Detail can ground globally, and a newly queued proposal is not visible in the review badge until the operator opens and refreshes the queue.`

## 4. Scope

- In scope:
  1. Explicit active-project scope in Ask.
  2. Shared local queue summary state for Ask and Capture Review.
  3. A visible `Review now` transition for proposed captures.
  4. Explicit global/workspace scope outside Project Detail.
- Out of scope:
  1. Changing project membership or retrieval algorithms.
  2. Adding a global state-management dependency.
  3. Daily attention filters or content lazy loading.
  4. Enabling writes in the public static build.

## 5. Requirements

1. Pass the active project ID from Project Detail through `OperatorFrame` to `AskDrawer`.
2. Show the current scope beside the question field: project title/ID on Project
   Detail and workspace scope elsewhere.
3. Include the project ID in both Ask grounding and capture requests. The server
   remains authoritative and must validate the project.
4. Keep global Ask available from non-project views; do not reuse a stale project
   after navigation.
5. Introduce the smallest practical shared owner for proposal summaries and the
   selected/open review state. React context or state lifted above both drawers is acceptable.
6. Fetch queue summaries once when local operator actions mount and whenever a
   capture callback reports `action: proposed`.
7. Update the queue badge without requiring the review drawer to open.
8. After a proposed capture, show `Review now`; activating it opens Capture Review
   with that proposal selected.
9. After apply or reject, update the shared count and selection exactly once.
10. Do not poll continuously. Refresh on mount, explicit refresh, capture, apply,
    reject, and relevant window focus only.
11. Hide all local mutation controls and endpoint calls from the production static build.

## 6. Technical Constraints

1. Reuse the existing local Ask and Capture Review endpoints and types.
2. Do not trust browser-provided answer text or project membership during capture.
3. Keep `App.tsx` a thin orchestrator and avoid duplicating proposal API logic in views.
4. Preserve hash-route project navigation and current public demo behavior.
5. The production-boundary assertion must continue to pass.

## 7. Implementation Notes

1. Expected files include `OperatorFrame.tsx`, `ProjectDetailView.tsx`,
   `AskDrawer.tsx`, `CaptureReviewDrawer.tsx`, their API helpers, and focused tests.
2. Prefer one `OperatorActions` context colocated with the drawer components over
   introducing a repository-wide state layer.
3. Reset project-scoped answer/capture state when the project ID changes.
4. Test navigation from one project to another and then to a global view.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:projects && npm run test:capture && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm --prefix apps/cockpit run test:production-boundary`
   - Formatting: `npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Ask from Project A sends only Project A's verified ID and displays that scope.
2. Navigation to Project B or a global view cannot reuse Project A scope.
3. A new proposal increments the visible queue count without opening the drawer.
4. `Review now` opens the exact new proposal.
5. Apply and reject immediately reconcile the badge and selection.
6. The production bundle contains no local endpoint markers.

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
  1. Local operator actions remain development-only for this milestone.
- Open questions:
  1. None. Do not add route override editing to the review drawer in this task.
