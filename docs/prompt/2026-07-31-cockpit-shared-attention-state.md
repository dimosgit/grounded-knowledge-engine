# Feature Prompt Template

## 1. Feature Title

`Operator Cockpit — Shared Live Attention State and Accurate Navigation Badge`

## 2. Objective

Create one reliable client-side owner for pending capture proposals, changed
evidence, refresh lifecycle, selection, and Attention counts. The Attention
Inbox, shell badge, Ask flow, and Capture Review drawer should update together
without duplicate network requests, polling, or stale selections. Existing
preview-before-apply mutation boundaries must remain authoritative.

## 3. Context

- Product area: `apps/cockpit` local operator state and review workflows.
- Current behavior: `OperatorActions` owns and refreshes capture proposals,
  while the new `AttentionView` independently calls
  `useOperatorAttentionSupplement` for proposals and workspace changes. This
  duplicates `/__gke/capture/proposals` requests and prevents the shell from
  showing one accurate Attention badge.
- Problem to solve: capture/review state can drift between the header drawer and
  inbox, and each surface implements its own loading/error/refresh lifecycle.

## 4. Scope

- In scope:
  1. Extract shared Attention state using React hooks/context or an App-owned
     view model; do not add a state library.
  2. Give Capture Review, Attention Inbox, and the shell one proposal list,
     selected proposal, refresh lifecycle, and error source.
  3. Keep changed-evidence loading lazy and independently retryable.
  4. Add an accurate Attention badge to desktop, collapsed, and mobile
     navigation.
  5. Refresh state after capture proposal creation, apply, reject, focus return,
     and explicit retry.
- Out of scope:
  1. Background polling, WebSockets, service workers, notifications, analytics,
     or persisted proposal copies.
  2. Automatic capture approval, bulk mutation, or direct Markdown mutation
     from the inbox/badge.
  3. Changing proposal file format, capture engine semantics, local API routes,
     or MCP tools.
  4. Cross-workspace aggregation or an in-process workspace switcher.

## 5. Requirements

1. Replace the split ownership in `OperatorActions` and
   `useOperatorAttentionSupplement` with one exported
   `useOperatorAttention` state contract owned at `App.tsx` or a shared shell
   provider boundary.
2. The shared contract must expose at least:
   - `proposals`, `selectedProposalId`, `proposalStatus`, and `proposalError`;
   - `changes`, `changeStatus`, and `changeError`;
   - `refreshProposals(preferredId?)`, `refreshChanges()`, and `retryFailed()`;
   - `selectProposal(id)`, `requestCaptureReview(id?)`, and the pending review
     request/state required by the authoritative drawer;
   - a deterministic combined Attention count/view model composed with catalog
     project, decision, and question items.
3. Issue at most one in-flight proposal-list request. Concurrent callers must
   share/coalesce it or apply a last-request-wins guard so an older response
   cannot replace newer state.
4. Load proposals once in local development and refresh them only when:
   - the window regains focus/visibility;
   - Ask creates a proposal;
   - Capture Review applies or rejects a proposal;
   - an inbox/palette action requests a specific proposal;
   - the user explicitly retries.
5. Do not poll. Deduplicate focus and visibility events so the same transition
   cannot trigger two back-to-back list requests.
6. Keep workspace-review/change loading lazy: load it when Attention becomes
   active or when the user explicitly refreshes changes. A change-request
   failure must not erase proposals or catalog-backed items.
7. Preserve selection when the selected proposal still exists. When it is
   applied/rejected or disappears, select the first remaining proposal or
   `null` deterministically.
8. `OperatorActions` must become a consumer of shared state. It may continue to
   own drawer open/closed presentation state, but it must not own another
   proposal array or make an independent list request.
9. `AttentionView` must consume the same proposal/change arrays and statuses;
   remove `useOperatorAttentionSupplement` after migration rather than keeping
   two APIs.
10. The navigation badge must represent the full unfiltered Attention item
    count from the same domain composer used by the inbox. Cap visual text at
    `99+`, but keep the exact count in the accessible name.
11. Badge count and inbox count must update immediately after a proposal appears
    or disappears, without a page reload.
12. Keep proposal and change errors independent. The shared UI must continue to
    show project, decision, and question signals when either local source fails.
13. Outside development, do not import or call local adapters. The public build
    remains static/read-only and uses catalog-backed Attention signals only.
14. Preserve all authoritative review behavior: applying remains disabled until
    preview succeeds, conflicts remain pending, and index refresh happens only
    through existing application services after real mutation.

## 6. Technical Constraints

1. Use React state/hooks and optionally built-in Context only. Do not add Redux,
   Zustand, SWR, React Query, event buses, or another dependency.
2. Keep `operator-inbox.ts` pure. Fetching and refresh coordination belong in a
   hook/provider; drawer presentation belongs in components.
3. Avoid prop-drilling a large mutable object through every view. Prefer a
   narrow context or a stable view-model contract at the shared shell boundary,
   while keeping `App.tsx` an orchestrator.
4. Memoize derived counts/items from primitive source arrays. Do not store
   filtered/derived inbox arrays as independent state.
5. Use functional state updates and stable callbacks for refresh/selection.
   Guard async completion after unmount and stale-request replacement.
6. Preserve production tree-shaking and the existing production-boundary
   markers. No endpoint string or local adapter implementation may enter the
   production bundle.
7. Preserve the current dirty worktree, especially the uncommitted Attention
   Inbox and Decision Replay lazy-frontmatter fix.

## 7. Implementation Notes

1. Primary files:
   - replace `src/hooks/useOperatorAttentionSupplement.ts` with
     `src/hooks/useOperatorAttention.ts` or equivalent;
   - optionally add `src/context/OperatorAttentionContext.tsx` if it materially
     reduces prop drilling;
   - refactor `src/components/OperatorActions.tsx`;
   - update `src/views/AttentionView.tsx`;
   - update `src/components/OperatorFrame.tsx` for the badge;
   - update `src/App.tsx` to provide catalog inputs and shared destination
     callbacks.
2. Keep the existing dynamic development imports of
   `capture-review-api.ts` and `workspace-review-api.ts`, or use an equivalent
   pattern proven clean by the production-boundary test.
3. Model request status explicitly as `idle|loading|ready|error` instead of one
   ambiguous shared boolean.
4. Use a monotonically increasing request token or stored in-flight promise for
   concurrency control. Tests must prove late older responses cannot win.
5. Have `AskDrawer` report successful proposal creation through the shared
   refresh callback with the preferred proposal ID.
6. Ensure `CaptureReviewDrawer` apply/reject completion invokes one refresh and
   that `preferredId: null` can deliberately clear selection.
7. Add the badge beside `Attention Inbox` in expanded/mobile navigation and as
   a small counter treatment on the collapsed icon. Avoid layout shifts when
   the count moves from one to two digits.
8. Update the roadmap progress note only after the duplicate request is removed
   and all integration tests pass.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Add focused hook/provider tests covering:
   - a single initial proposal request despite multiple consumers;
   - focus/visibility deduplication;
   - proposal creation with preferred selection;
   - apply/reject removal and deterministic fallback selection;
   - concurrent responses arriving out of order;
   - independent proposal/change failures and retries;
   - unmount during an in-flight request;
   - no local request in production mode.
3. Extend `operator-actions.test.tsx`, `app-flow.test.tsx`, and Attention tests to
   prove the drawer, inbox, and badge share the same state and update together.
4. Add accessible badge assertions for expanded, collapsed, and mobile
   navigation, including exact accessible counts above 99.
5. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm --prefix apps/cockpit run typecheck`
   - Format: `npm --prefix apps/cockpit run format:check`
   - Focused tests: `npm --prefix apps/cockpit exec vitest run --
src/__tests__/operator-attention.test.tsx
src/__tests__/operator-actions.test.tsx
src/__tests__/operator-inbox.test.ts
src/__tests__/app-flow.test.tsx`
   - Full Cockpit tests: `npm --prefix apps/cockpit test`
   - Production build: `npm --prefix apps/cockpit run build`
   - Production boundary: `npm --prefix apps/cockpit run
test:production-boundary`
   - Bundle budget: `npm --prefix apps/cockpit run test:bundle-budget`
   - Repository sanitization: stage intended files, then run `npm run scrub`
6. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Opening the Cockpit produces no more than one proposal-list request even
   though the header and Attention route can both consume proposal state.
2. Creating a proposal through Ask updates the Capture Review badge, Attention
   badge, inbox row, and selected drawer proposal without reloading.
3. Applying or rejecting a proposal removes it from every surface after one
   refresh and selects a deterministic remaining proposal.
4. Returning focus triggers at most one refresh for that transition; no polling
   occurs while the app is idle.
5. A stale, slower response cannot overwrite newer proposal/change state.
6. Proposal failure leaves changes and catalog signals usable; change failure
   leaves proposals and catalog signals usable; each has a bounded retry.
7. Expanded, collapsed, and mobile navigation display the same accurate count,
   with `99+` visual capping and the exact accessible value.
8. The public build performs no local request and contains no forbidden local
   endpoint marker.
9. Existing preview-before-apply, conflict, read-only, and index-refresh rules
   continue to pass unchanged.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Removal of the superseded duplicate Attention supplement state/API.
4. Updated roadmap status after all checks pass.
5. Short implementation summary including exact request-count evidence, test
   results, and screenshots of the live badge/inbox before and after a proposal
   review.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. Do not weaken preview-before-apply, read-only, workspace, or production
   boundaries to simplify UI state.
6. Preserve all pre-existing user and agent changes in the dirty worktree.

## 12. Assumptions and Open Questions

- Assumptions:
  1. The combined navigation badge counts the same unfiltered five signal types
     as `composeOperatorInbox`.
  2. Focus/visibility refresh plus explicit mutation refresh is sufficient;
     background polling is not required for a local-first single-user app.
  3. Changed evidence remains a seven-day window unless the user selects a
     different window in an existing review surface.
- Open questions:
  1. None are blocking. Prefer a narrow built-in React Context only if it avoids
     repetitive props across all `OperatorFrame` consumers.
