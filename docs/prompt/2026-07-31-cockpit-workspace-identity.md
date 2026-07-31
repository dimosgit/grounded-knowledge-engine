# Feature Prompt Template

## 1. Feature Title

`Operator Cockpit — Safe, Real Workspace Identity and Policy Display`

## 2. Objective

Make the active workspace and its write policy visible on every primary
Cockpit route without exposing host paths or weakening process isolation. A
technical user should immediately know which local trust boundary is active,
whether writes are allowed, and whether the workspace is personal, internal,
sensitive, restricted, or a public demo.

## 3. Context

- Product area: workspace safety, Cockpit shell, and local development adapter.
- Current behavior: `OperatorFrame.WorkspaceStatus` displays a generic `Local
workspace · Workspace policy active` label in development and a hard-coded
  demo label in production. The engine already resolves immutable `id`,
  `label`, `readOnly`, and `sensitivity` values in `WorkspaceContext`.
- Problem to solve: operators working across repositories cannot verify the
  active workspace policy from the browser. Displaying a generic label weakens
  the value of the workspace-vault safety model.

## 4. Scope

- In scope:
  1. Add a read-only loopback development adapter that returns a strict safe
     projection of the already-loaded `WorkspaceContext`.
  2. Add a browser client/domain adapter and display model with bounded timeout,
     safe fallback, and explicit loading/error states.
  3. Render workspace label, ID, write policy, and non-default sensitivity in
     desktop, collapsed, and mobile navigation.
  4. Keep the public build on compile-time demo metadata and prove the local
     endpoint is absent from production artifacts.
- Out of scope:
  1. Workspace switching, cross-workspace search, workspace creation, registry
     management, or exposing `.gke/workspaces.json`.
  2. Returning repository roots, scan roots, write roots, usernames, hostnames,
     environment variables, secrets, or arbitrary workspace config.
  3. Changing the engine's write authorization semantics or adding hosted
     workspace APIs.
  4. Adding settings/account UI or a new MCP tool.

## 5. Requirements

1. Add `GET /__gke/workspace/context` as a Vite development plugin. Return only:

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

2. Construct the payload by allowlisting those four fields from the immutable
   `WorkspaceContext` already loaded in `vite.config.ts`. Never serialize the
   context object directly.
3. Reuse `scripts/local-dev-api.ts` request guards. Accept loopback, same-origin
   `GET` only; reject other methods, non-loopback peers/hosts, repeated/unknown
   query parameters, and malformed requests. Send `cache-control: no-store` and
   JSON content type.
4. Add `src/lib/workspace-context-api.ts` with a client timeout of no more than
   5 seconds, strict response validation, an abort signal, and safe generic
   errors that never echo response bodies or paths.
5. Add pure `src/domain/workspace-display.ts` rules that convert the payload
   into display text and visual state. Keep React, fetch, Node APIs, and plugin
   code out of this module.
6. In local development, load context once per app/session and expose:
   - the human label prominently;
   - the stable workspace ID as secondary text or a tooltip;
   - exactly `Read-only` or `Local writes enabled`;
   - sensitivity when it is not the default `personal` value.
7. In the public production build, render an explicit `Demo workspace ·
Read-only preview` state from compile-time constants. Do not fetch or include
   the development endpoint.
8. While loading, preserve shell geometry and show neutral workspace status.
   On failure, show `Workspace unavailable · Verify local configuration` and
   keep the rest of the Cockpit usable.
9. In collapsed navigation, render a policy-aware icon with an accessible label
   and full tooltip; do not attempt to squeeze all metadata into the rail.
10. Use distinct but accessible treatments for read-only, writable, sensitive,
    restricted, and demo states. Color must not be the only carrier of meaning.
11. Extend `forbiddenLocalEndpointMarkers` with
    `/__gke/workspace/context` before registering the plugin.
12. Ensure no payload, error, title, tooltip, DOM attribute, console message, or
    production artifact contains `repoRoot`, `realRepoRoot`, `scanRoots`,
    `writeRoots`, or an absolute path.

## 6. Technical Constraints

1. The adapter must receive the one workspace selected at Vite process startup;
   it must not load the workspace registry or accept a workspace ID parameter.
2. Reuse the shared local request guard and `sendJson`; do not create a weaker
   ad hoc loopback check.
3. Keep `workspace-display.ts` browser-safe and pure. The local endpoint client
   belongs in `src/lib`; the hook belongs in `src/hooks`; Node middleware belongs
   in `apps/cockpit/scripts`.
4. Use `import.meta.env.DEV` and a development-only dynamic import so Rollup can
   remove the endpoint client from production. The production-boundary test is
   authoritative.
5. Preserve immutable one-process/one-workspace behavior. Do not add a selector
   or in-process switcher.
6. Do not add dependencies or expose additional workspace configuration fields.
7. Preserve the current dirty worktree and the uncommitted Attention Inbox.

## 7. Implementation Notes

1. Primary files:
   - add `apps/cockpit/scripts/workspace-context-plugin.ts`;
   - register it in `apps/cockpit/vite.config.ts` using the existing `workspace`;
   - add `src/lib/workspace-context-api.ts`;
   - add `src/domain/workspace-display.ts`;
   - add `src/hooks/useWorkspaceDisplay.ts` or an equivalent thin hook;
   - refactor `WorkspaceStatus` in `src/components/OperatorFrame.tsx` to receive
     or consume the safe display model;
   - extend `apps/cockpit/scripts/production-boundary.ts`.
2. Follow the structure and error handling of existing capture/review plugins,
   but implement no request body and no mutation path.
3. Validate `id` and `label` as bounded strings, `readOnly` as boolean, and
   `sensitivity` against `personal|internal|sensitive|restricted` on the client.
4. Prefer a single app-level context request rather than one request per route
   or one request per `OperatorFrame` mount.
5. If a hook uses cached module state, ensure tests can reset it. A small
   App-owned state value is preferable to an opaque global singleton.
6. Update the workspace-aware shell progress note only after the endpoint,
   browser UI, leakage tests, and production boundary all pass.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Add `workspace-context-plugin.test.ts` covering:
   - exact safe payload;
   - absence of every root/path field even when fixtures contain distinctive
     secret-looking paths;
   - GET-only behavior;
   - loopback host/peer enforcement;
   - repeated/unknown query rejection;
   - unrelated-route pass-through;
   - generic error responses with no path leakage.
3. Add domain/hook/component tests covering writable, read-only, demo,
   sensitive, restricted, loading, invalid-response, timeout, and failure
   states in desktop/mobile/collapsed navigation.
4. Extend `production-boundary.test.ts` to prove the new marker is detected and
   ensure the real production build is clean.
5. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm --prefix apps/cockpit run typecheck`
   - Format: `npm --prefix apps/cockpit run format:check`
   - Focused tests: `npm --prefix apps/cockpit exec vitest run --
src/__tests__/workspace-context-plugin.test.ts
src/__tests__/workspace-display.test.tsx
src/__tests__/production-boundary.test.ts
src/__tests__/app-flow.test.tsx`
   - Full Cockpit tests: `npm --prefix apps/cockpit test`
   - Production build: `npm --prefix apps/cockpit run build`
   - Production boundary: `npm --prefix apps/cockpit run
test:production-boundary`
   - Bundle budget: `npm --prefix apps/cockpit run test:bundle-budget`
   - Repository sanitization: stage intended files, then run `npm run scrub`
6. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Every primary local Cockpit route displays the exact configured workspace
   label and whether it is read-only or writable.
2. Desktop, collapsed, and mobile navigation expose equivalent workspace
   identity and policy information accessibly.
3. A sensitive/restricted workspace is clearly labeled in text, not color only.
4. A failed or timed-out request leaves navigation functional and shows a safe,
   actionable fallback with no response-body/path leakage.
5. Requests with non-GET methods, non-loopback identity, repeated parameters,
   or unknown parameters fail closed.
6. The public build displays `Demo workspace · Read-only preview`, contains no
   `/__gke/workspace/context` marker, and performs no context request.
7. Automated leakage tests prove that no absolute root or forbidden context
   field reaches the safe payload or rendered UI.
8. Existing local mutation adapters continue to enforce the same workspace
   policy; this feature does not weaken their authorization.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Updated Cockpit plan/README status after all checks pass.
4. Short implementation summary including exact test results and screenshots of
   writable, read-only, and public-demo shell states.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. Never log, render, return, or commit absolute workspace paths or local
   machine configuration.
6. Preserve all pre-existing user and agent changes in the dirty worktree.

## 12. Assumptions and Open Questions

- Assumptions:
  1. `vite.config.ts` continues to load exactly one immutable
     `WorkspaceContext` at startup.
  2. `internal` is displayed explicitly because the current product plan asks
     for non-personal sensitivity labels.
  3. The public production build remains a sanitized static demo and never
     connects to a local workspace endpoint.
- Open questions:
  1. None are blocking. Use the existing status colors and typography, adding
     text labels wherever color would otherwise carry meaning alone.
