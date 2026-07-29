# Operator Cockpit Action Center and Workspace Clarity Plan

**Status:** Proposed.
**Review date:** 2026-08-12.
**Repository:** Grounded Knowledge Engine.
**Primary surface:** `apps/cockpit`.

## Product decision

Build a workspace-aware Operator Inbox and upgrade the global command palette
before adding another engine capability.

The engine already exposes the signals an operator needs: immutable workspace
identity, read-only policy, project attention, changed documents, capture
proposals, open questions, and decision freshness. The Cockpit presents these
signals in separate views and drawers, while its command palette searches only
documents and several shell controls are disabled placeholders. The next
meaningful improvement is to make existing capability easier and safer to
operate.

## Evidence from the current UI

1. `Mission Control` summarizes project reviews, blockers, and open questions,
   but capture proposals and decision reviews live elsewhere.
2. Capture review state is owned inside `OperatorActions`; other screens cannot
   compose it into a unified attention count without duplicating requests.
3. The Decision Ledger has useful due/stale filters, but those items do not
   participate in daily attention.
4. The command palette says it searches “notes, terms, commands,” yet its input
   contract contains document fields only and its empty state has no quick
   actions or recent destinations.
5. The shell identifies the user as a generic “Technical Lead” but does not
   identify the active workspace, sensitivity, or read-only state. That weakens
   the visibility of the workspace-vault safety model.
6. `New Document`, `Settings`, `History`, `Archive`, `Support`, and account
   controls appear disabled. Non-functional primary affordances add visual
   noise and make implemented features feel less trustworthy.
7. Route state is partially encoded in the URL. Project-attention and decision
   filters are linkable, but command destinations and a unified attention view
   do not yet have a canonical route.

## Desired user outcomes

After this plan is delivered, a local operator should be able to:

1. See which workspace is active and whether writes are allowed before taking
   an action.
2. Open one inbox that answers “what needs my attention now?” across projects,
   captures, decisions, questions, and changed evidence.
3. Filter and deep-link that inbox by urgency, item type, and project.
4. Use `Cmd/Ctrl+K` to navigate to documents, projects, decisions, views, and
   review queues.
5. Reach an authoritative preview before every mutation; the inbox and command
   palette never bypass existing review boundaries.
6. Use the same flows on keyboard, screen reader, narrow viewport, and reduced
   motion settings.

## Scope

### In scope

1. Safe workspace identity and policy metadata in the Cockpit shell.
2. A unified, derived Operator Inbox with deterministic filters and routes.
3. Shared local state for capture proposal summaries and attention refresh.
4. A typed, action-capable command palette.
5. Removal of misleading disabled shell controls.
6. Responsive, keyboard, screen-reader, and loading/error/empty states.
7. Focused UI tests, production-boundary checks, and bundle-budget enforcement.

### Out of scope

1. Cross-workspace search or an in-process workspace switcher.
2. New canonical record types or a new core MCP tool.
3. Automatic approval, bulk mutation, or mutation from the command palette.
4. Hosted writes or exposing local adapters in the public production bundle.
5. Replacing Markdown, the existing application services, or the hash router.
6. Semantic search, embeddings, or speculative analytics.
7. Implementing Settings, Archive, account management, or support workflows.

## Information architecture

### Workspace identity

The desktop sidebar and mobile navigation should show:

- workspace label;
- workspace ID in a secondary or tooltip treatment;
- `Read-only` or `Local writes enabled`;
- sensitivity label when it is not the default personal value;
- a visible `Demo workspace` treatment in the public build.

Absolute roots, usernames, machine paths, and secrets must never be returned or
rendered.

### Operator Inbox

Add `Attention` as a first-class navigation destination with route
`#/attention`. Use allowlisted query parameters:

- `kind=all|project|capture|decision|question|change`;
- `priority=all|overdue|due|blocked|review`;
- `project=<project-id>`.

Each item uses a shared browser-safe contract:

```ts
interface OperatorInboxItem {
  id: string;
  kind: "project" | "capture" | "decision" | "question" | "change";
  priority: "overdue" | "due" | "blocked" | "review" | "info";
  title: string;
  summary: string;
  projectId: string | null;
  occurredAt: string | null;
  destination: OperatorDestination;
  sourcePath: string | null;
}
```

Item IDs must be stable and derived from canonical identities such as project
ID, proposal ID, decision ID, question path plus line, or changed-document
path. Sorting is deterministic: priority, date, kind, then ID.

The inbox composes:

- due/overdue projects and blockers from the shared project model;
- pending capture summaries from the capture-review API;
- due, overdue, and stale-evidence decisions from the shared decision model;
- open questions from canonical Markdown;
- changed documents from the existing local workspace-review API.

The first render uses already-loaded catalog data. Local proposal and
changed-document data load lazily, display independent error states, and never
block the rest of the inbox.

### Command palette

Replace the document-only `CommandItem` with a discriminated
`CommandPaletteEntry`:

- `document`;
- `project`;
- `decision`;
- `view`;
- `review-action`.

The palette should:

1. Show recent destinations and safe quick actions before typing.
2. Group results by type and display the destination context.
3. Search projects and decisions using the same normalized matching helpers as
   documents.
4. Open Ask, Capture Review, or Attention without performing a write.
5. Keep arrow-key, Enter, Escape, focus trapping, focus restoration, and live
   result announcements.
6. Preserve a bounded result count and avoid loading Markdown bodies.

## Architecture

### Browser-safe domain layer

Add:

- `apps/cockpit/src/domain/operator-inbox.ts` for composition, filtering,
  sorting, counts, and stable IDs;
- `apps/cockpit/src/domain/command-palette.ts` for typed entries and ranking;
- `apps/cockpit/src/domain/workspace-display.ts` for safe presentation rules.

These modules remain pure and receive data as arguments. They must not import
Node APIs, fetch, React, or local adapter modules.

### Local adapter boundary

Add a read-only `GET /__gke/workspace/context` development adapter returning
only:

```json
{
  "workspace": {
    "id": "client-alpha",
    "label": "Client Alpha",
    "readOnly": false,
    "sensitivity": "internal"
  }
}
```

The adapter must reuse the shared local-request guard, accept loopback GET only,
enforce a timeout, and exclude roots and paths by construction. The public
build uses compile-time demo metadata and must not contain the endpoint marker
or adapter implementation.

### Shared UI state

Extract proposal-list ownership from `OperatorActions` into a small
`useOperatorAttention` hook owned by `App.tsx` or the shared shell boundary.
The hook may compose catalog-derived counts with lazy local requests, but it
must not introduce a global state library.

`App.tsx` stays an orchestrator:

- assemble inputs;
- own route state;
- pass view models and callbacks;
- avoid reimplementing inbox rules.

Existing drawers remain the authoritative mutation surfaces. Inbox and command
entries open them with a selected record ID.

### Routing

Extend `routes.ts` and `useRouteSync.ts` with:

- strict parsing and serialization for the attention route;
- allowlisted filters;
- safe fallback to `all` for malformed values;
- browser back/forward parity;
- one destination callback for documents, projects, decisions, views, and
  review surfaces.

Do not encode machine paths, question text, or other sensitive content in the
URL.

## Delivery phases

### Phase 0 — Contracts and safety

1. Define workspace-display, inbox-item, destination, and command-entry
   contracts.
2. Add pure domain tests for composition, deduplication, sort order, filters,
   and malformed inputs.
3. Add the safe workspace-context adapter with loopback, timeout, and
   no-path-leakage tests.
4. Extend the production-boundary marker list before registering the adapter.

**Exit gate:** contracts and adapter tests pass; the production build contains
neither the endpoint nor workspace roots.

### Phase 1 — Workspace-aware shell

1. Show workspace label, write policy, and sensitivity in desktop and mobile
   navigation.
2. Add the `Attention` navigation destination and badge.
3. Remove disabled placeholder controls from primary navigation and the header.
4. Preserve collapsed-navigation state and all modal accessibility behavior.

**Exit gate:** the active workspace and write policy are visible at every
primary route, and no unexplained disabled primary controls remain.

### Phase 2 — Unified Operator Inbox

1. Implement the browser-safe inbox composer.
2. Add the lazy-loaded `AttentionView`.
3. Compose project, capture, decision, question, and changed-document items.
4. Add urgency, kind, and project filters with canonical URLs.
5. Route each item to its authoritative detail or review surface.
6. Add independent loading, empty, partial-error, and retry states.

**Exit gate:** all five signal types can appear together, counts match their
source models, filters survive reload/back/forward, and no inbox action mutates
canonical Markdown directly.

### Phase 3 — Action-capable command palette

1. Build typed entries for documents, projects, decisions, views, and review
   actions.
2. Add grouped results, recent destinations, and an informative empty state.
3. Route selections through the shared destination callback.
4. Keep the palette metadata-only and enforce a deterministic result limit.

**Exit gate:** keyboard-only users can reach every primary view and review
surface; the palette does not load Markdown bodies or perform writes.

### Phase 4 — Responsive polish and evidence

1. Verify inbox density and filter behavior at narrow, medium, and wide
   viewports.
2. Add skeletons that match final layout and avoid content jumps.
3. Add `aria-live` announcements for inbox refresh and filter counts.
4. Confirm reduced-motion behavior and visible focus.
5. Record bundle measurements and update this plan with implemented status and
   final results.

**Exit gate:** full Cockpit and engine gates pass, the initial bundle stays
within the existing budget, and the public build remains static/read-only.

## Acceptance criteria

1. Every primary Cockpit route identifies the active workspace and write
   policy without revealing a filesystem path.
2. The Operator Inbox displays deterministic, filterable items from projects,
   captures, decisions, questions, and changed documents.
3. A partial local-adapter failure leaves catalog-derived attention usable and
   offers a bounded retry.
4. Inbox links and filters are reloadable and browser-navigation safe.
5. The command palette searches documents, projects, and decisions and exposes
   navigation/review actions before a query is entered.
6. Command and inbox actions never bypass preview-before-apply workflows.
7. Disabled placeholder controls are removed from primary UI.
8. All new modal, filter, and navigation behavior is keyboard and
   screen-reader tested.
9. No local endpoint marker, workspace identity payload, or write adapter enters
   the production bundle.
10. Initial JavaScript and CSS remain inside the existing CI budgets.

## Required tests

Add or extend:

- `workspace-context-plugin.test.ts`;
- `operator-inbox.test.ts`;
- `operator-inbox-view.test.tsx`;
- `command-palette.test.tsx`;
- `app-flow.test.tsx`;
- `modal-accessibility.test.tsx`;
- `production-boundary.test.ts`;
- `bundle-budget.test.ts`.

Minimum adversarial cases:

1. Workspace metadata never includes configured or real roots.
2. Non-loopback, non-GET, repeated, or unknown requests fail closed.
3. Duplicate signals resolve to stable independent items without unstable
   ordering.
4. Malformed route filters cannot escape their allowlists.
5. Capture conflicts remain pending and route back to authoritative review.
6. Read-only workspaces display the policy and reject mutation through the
   existing adapters.
7. One failed local request does not erase project, question, or decision
   attention derived from the catalog.

## Verification

Run after each phase:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:gke
npm --prefix apps/cockpit run typecheck
npm --prefix apps/cockpit run lint
npm --prefix apps/cockpit run format:check
npm --prefix apps/cockpit test
npm --prefix apps/cockpit run build
npm --prefix apps/cockpit run test:production-boundary
npm --prefix apps/cockpit run test:bundle-budget
npm run scrub
```

Do not commit a phase with a failing required check.

## Success measures

The plan succeeds when:

1. One screen represents all current review/attention sources without changing
   their canonical semantics.
2. An operator can identify the active workspace and reach any primary record
   or review flow in two interactions or fewer.
3. Empty, partial-failure, and read-only states explain the next safe action.
4. The shell contains no misleading disabled primary controls.
5. Accessibility, production-boundary, and bundle-budget regressions are
   prevented by CI.

## Follow-on decisions

After real use of the Operator Inbox:

1. Add local-only, aggregate feedback metrics only if operators need evidence
   about missed results or review throughput. Do not store raw query text by
   default.
2. Add route overrides during capture apply only if rejecting and recapturing
   ambiguous routes proves materially slow.
3. Consider a deliberate workspace launcher outside the running Cockpit
   process. Do not weaken process-isolated vaults with an in-process workspace
   switcher.
