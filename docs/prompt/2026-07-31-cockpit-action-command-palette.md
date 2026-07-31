# Feature Prompt Template

## 1. Feature Title

`Operator Cockpit — Typed, Action-Capable Command Palette`

## 2. Objective

Upgrade `Cmd/Ctrl+K` from document-only search into the fastest safe navigation
surface in GKE. Technical users should be able to reach documents, projects,
decisions, primary views, and existing review flows without leaving their IDE
workflow or hunting through the optional Cockpit. The palette must navigate or
open authoritative review UI only; it must never write canonical Markdown.

## 3. Context

- Product area: `apps/cockpit` navigation and operator workflow.
- Current behavior: `CommandBar.tsx` accepts document-shaped items, returns no
  options until the user types, and always opens a document. The current dirty
  worktree also contains the validated `#/attention` inbox and shared
  `OperatorDestination` primitives; preserve those changes.
- Problem to solve: the UI labels the surface as searching “notes, terms,
  commands,” but projects, decisions, views, Ask, Attention, and Capture Review
  are not represented. Experienced users cannot use the keyboard as the main
  Cockpit navigation path.

## 4. Scope

- In scope:
  1. Add a browser-safe, discriminated command-palette domain model for
     `document`, `project`, `decision`, `view`, and `review-action` entries.
  2. Rank and group metadata-only results deterministically.
  3. Show safe quick actions and recent destinations before the user types.
  4. Route every selection through one destination callback owned by `App.tsx`.
  5. Preserve complete keyboard, focus, screen-reader, reduced-motion, and
     bounded-result behavior.
- Out of scope:
  1. Performing capture, decision review, project mutation, or any other write
     directly from the palette.
  2. Loading Markdown bodies, adding semantic search, embeddings, fuzzy remote
     search, or another backend endpoint.
  3. Adding new routes, MCP tools, canonical record types, or a global state
     library.
  4. Redesigning the Knowledge Base search or command-line interfaces.

## 5. Requirements

1. Add `apps/cockpit/src/domain/command-palette.ts` with exported types similar
   to:
   - `CommandPaletteEntry = DocumentEntry | ProjectEntry | DecisionEntry |
ViewEntry | ReviewActionEntry`;
   - a stable `id`, `kind`, `title`, `subtitle`, normalized search fields,
     `destination`, and optional `keywords` for every entry;
   - pure functions for composition, ranking, grouping, and result limiting.
2. Reuse `normalizeSearchText`, `buildSearchFields`, and/or equivalent shared
   matching rules from `src/lib/search.ts`; do not create a second inconsistent
   normalization algorithm.
3. Build entries from already-loaded catalog metadata:
   - documents from `docs`;
   - projects from `projectSummaries`;
   - decisions from `decisionSummaries`;
   - views for Mission Control, Attention Inbox, Knowledge Base, Project Board,
     Decision Replay, and Context Graph;
   - review actions for Ask, Capture Review, and Attention Inbox.
4. When the query is empty, show two bounded groups:
   - safe quick actions (`Attention Inbox`, `Ask grounded knowledge`, `Capture
Review`);
   - recent destinations, with duplicates removed and most-recent first.
5. Persist recent destinations only as versioned, bounded metadata in
   `localStorage`. Store canonical IDs/routes only; never store raw queries,
   Markdown bodies, workspace paths, question text, or machine paths. Recover
   safely from blocked storage and malformed/old values.
6. When the user types, search all entry kinds, rank exact title/ID matches
   ahead of prefix/token matches, break ties deterministically by kind and ID,
   and return no more than 20 options.
7. Group visible results by type with accessible group labels and include enough
   context to distinguish similarly named documents, projects, and decisions.
8. Replace `CommandBar`'s document-only `onSelect` contract with a single typed
   destination callback. Extend the existing destination model only as needed
   for views and review surfaces; keep destination parsing browser-safe.
9. Selecting an entry must:
   - close the palette and clear the query;
   - navigate to the canonical document/project/decision/view route; or
   - open the existing Ask or Capture Review drawer;
   - never call a mutation endpoint.
10. Preserve `Cmd/Ctrl+K`, Arrow Up/Down wraparound, Enter, Escape, click,
    focus trapping, initial focus, focus restoration, and reduced-motion
    behavior.
11. Announce result counts and the active group through an `aria-live` region.
    The combobox/listbox active descendant must always reference a rendered,
    unique option.
12. Update the header label from `Quick Search` to `Command palette` (or an
    equally explicit label) while retaining an accessible name that explains
    the shortcut.
13. Keep the palette lazy with respect to Markdown content: opening and
    searching it must not call `markdownContentLoader.load()`.

## 6. Technical Constraints

1. Preserve the architecture rule that `App.tsx` orchestrates data and routes,
   while `src/domain/command-palette.ts` remains pure and imports no React,
   Node APIs, fetch adapters, or local-only plugins.
2. Reuse `OperatorDestination` or extract a shared superset instead of creating
   incompatible navigation contracts for the inbox and palette.
3. Keep `CommandBar` as a presentation/interaction component. Entry composition
   and ranking belong in the domain layer, not inside JSX.
4. Import components and utilities directly; do not add a broad barrel import
   that increases the initial bundle.
5. Do not add third-party command-menu, fuzzy-search, or state-management
   dependencies.
6. The public build must remain static and read-only. No local endpoint marker
   or mutation adapter may enter a production artifact.
7. Preserve the current dirty worktree. Inspect `git status` before editing and
   do not discard, overwrite, reset, or reimplement the uncommitted Attention
   Inbox changes.

## 7. Implementation Notes

1. Primary files:
   - add `apps/cockpit/src/domain/command-palette.ts`;
   - refactor `apps/cockpit/src/components/CommandBar.tsx`;
   - update `apps/cockpit/src/App.tsx` to compose entries and own the destination
     callback;
   - update view call sites currently constructing a document-only
     `<CommandBar>`;
   - add a small `useRecentDestinations` hook only if persistence cannot be
     cleanly isolated in an existing hook.
2. Prefer one palette instance near the shared shell boundary rather than eight
   independently configured instances. If moving the instance is too invasive,
   centralize its entry and callback props so every view receives the identical
   contract.
3. Use stable IDs such as `document:<path>`, `project:<project-id>`,
   `decision:<decision-id>`, `view:<route>`, and `review:<action>`.
4. Suggested kind ordering after score ties: review action, view, project,
   decision, document. Document path/ID provides the final deterministic tie
   breaker.
5. Empty states must distinguish “start with a quick action” from “no matches
   for this query.”
6. Existing document-only callers and tests must migrate in the same change;
   do not retain two parallel command-palette APIs.
7. Update the Operator Cockpit plan progress note and README only after the
   implemented behavior and tests are green.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Add `apps/cockpit/src/__tests__/command-palette.test.tsx` and a focused pure
   domain test. Cover:
   - all five entry kinds;
   - deterministic ranking and the 20-result ceiling;
   - empty-query quick actions and recent destinations;
   - malformed/blocked `localStorage`;
   - grouped accessible output;
   - keyboard wraparound, Enter, Escape, focus restoration, and live results;
   - duplicate titles across kinds;
   - Ask/Capture Review opening without a write;
   - metadata-only operation with no Markdown-body load.
3. Extend `app-flow.test.tsx` and `modal-accessibility.test.tsx` for route parity
   and modal behavior.
4. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm --prefix apps/cockpit run typecheck`
   - Format: `npm --prefix apps/cockpit run format:check`
   - Focused tests: `npm --prefix apps/cockpit exec vitest run --
src/__tests__/command-palette.test.tsx src/__tests__/app-flow.test.tsx
src/__tests__/modal-accessibility.test.tsx`
   - Full Cockpit tests: `npm --prefix apps/cockpit test`
   - Production build: `npm --prefix apps/cockpit run build`
   - Production boundary: `npm --prefix apps/cockpit run
test:production-boundary`
   - Bundle budget: `npm --prefix apps/cockpit run test:bundle-budget`
   - Repository sanitization: stage intended files, then run `npm run scrub`
5. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Opening `Cmd/Ctrl+K` with no query shows recent destinations and safe quick
   actions.
2. One query can return correctly grouped document, project, decision, and view
   results with deterministic ordering.
3. Keyboard-only users can reach every primary Cockpit view plus Ask, Capture
   Review, and Attention Inbox.
4. Selecting Ask or Capture Review opens the existing authoritative drawer and
   sends no mutation request.
5. Selecting a document, project, decision, or view produces the canonical hash
   route and browser back/forward remains correct.
6. The palette never loads Markdown bodies and never displays more than 20
   search results.
7. Focus trapping/restoration, reduced motion, live announcements, and active
   descendant semantics pass automated tests.
8. The initial bundle remains within its current enforced budget and the public
   build contains no local endpoint marker.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Updated roadmap/README status that distinguishes implemented behavior from
   remaining work.
4. Short implementation summary including test command results and one desktop
   plus one narrow-viewport screenshot of the open palette.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. Preserve all pre-existing user and agent changes in the dirty worktree.

## 12. Assumptions and Open Questions

- Assumptions:
  1. The current Attention Inbox implementation remains the baseline and its
     `OperatorDestination` contract may be extended rather than replaced.
  2. Recent destinations may persist locally in a versioned, bounded schema;
     raw search queries must not persist.
  3. The recommended cross-feature delivery order is workspace identity,
     shared Attention state, then command palette, but this prompt remains
     implementable on the current baseline.
- Open questions:
  1. None are blocking. Default to the existing visual language and label the
     surface `Command palette` unless product review requests different copy.
