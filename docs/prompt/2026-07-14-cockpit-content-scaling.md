# Feature Prompt Template

## 1. Feature Title

`Cockpit Catalog and Lazy Markdown Content Scaling`

## 2. Objective

Stop Cockpit startup cost from growing linearly with every complete Markdown
body. Load a compact generated catalog eagerly, load full bodies on demand, and
enforce a production initial-bundle budget in CI.

## 3. Context

- Product area: `Cockpit content sync, catalog/domain transforms, Markdown loading, hash routes, search, and production build verification`
- Current behavior: `App.tsx eagerly imports every Markdown body; buildDocs constructs full-body search fields at startup; the current 15-document production entry is about 400 KB raw and 125 KB gzip before lazy Markdown/Mermaid chunks.`
- Problem to solve: `A real workspace increases initial JavaScript, parse time, memory, and startup work in direct proportion to canonical content size.`

## 4. Scope

- In scope:
  1. Generated compact catalog and bounded search fields.
  2. Lazy full-body loading by logical path.
  3. Deep-link, recent-item, graph, project, and Markdown rendering compatibility.
  4. Initial production-bundle budget enforcement.
- Out of scope:
  1. A server database, hosted search service, or client-side SQLite.
  2. Semantic search.
  3. Removing offline static-preview support.
  4. Replacing Markdown or Mermaid rendering libraries.

## 5. Requirements

1. During content sync, generate one deterministic catalog containing logical
   path, title, frontmatter, type, track, excerpt, project/link metadata needed
   by current views, and bounded normalized search fields.
2. Do not include complete Markdown bodies in the eager catalog.
3. Replace the eager raw glob with a lazy loader map keyed by normalized logical path.
4. Fetch/load a full body only when a view needs to render or parse body-specific
   sections that are not already represented in catalog metadata.
5. Cache loaded bodies in memory for the session and deduplicate concurrent loads.
6. Show a stable loading and safe error state in Library and Project Detail while
   a body is being loaded.
7. Preserve hash-route deep links and browser back/forward behavior.
8. Preserve current search behavior for titles, paths, frontmatter, excerpts,
   headings, and meaningful body terms represented in the generated bounded index.
9. Keep Mermaid and Markdown renderer code lazy.
10. Emit a Vite manifest or equivalent machine-readable build inventory.
11. Add a budget script that identifies initial entry JS/CSS separately from
    lazy content, Markdown, graph, and Mermaid chunks.
12. Set an initial entry JavaScript budget no higher than 350 KB raw and 120 KB
    gzip. Record any later budget change as an explicit reviewed decision.
13. Add the budget assertion to Cockpit CI after build.

## 6. Technical Constraints

1. Markdown remains canonical; generated catalog and content assets remain disposable.
2. Sync output must be deterministic for identical inputs.
3. Keep public static hosting and offline navigation functional.
4. Do not import Node-only parser code into the browser.
5. Do not weaken Markdown link filtering, Mermaid strict mode, or production-boundary checks.

## 7. Implementation Notes

1. Expected areas: `apps/cockpit/scripts/sync-lib.ts`, generated `content/`
   artifacts, `src/domain/catalog.ts`, a content-loader hook/service, `App.tsx`,
   Library/Project views, Vite config, and build assertion scripts.
2. Generate enough project and graph metadata during sync to avoid loading every
   body merely to render the Hub or Project Board.
3. Add a fixture with a large unique body marker. Assert that the marker is absent
   from the eager entry but appears after loading the corresponding document.
4. If exact full-body substring search cannot remain bounded, document the
   intentional search contract and test the replacement behavior; do not silently
   drop body search.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm --prefix apps/cockpit run test:production-boundary && npm --prefix apps/cockpit run test:bundle-budget`
   - Formatting: `npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Initial entry assets contain catalog data but not complete Markdown bodies.
2. Increasing fixture body sizes tenfold does not materially increase initial entry size.
3. Direct document and project deep links load and render the correct body.
4. Existing search, graph, project, recent-item, and asset-rendering tests remain green or are updated to an explicitly equivalent contract.
5. Initial entry JS stays within 350 KB raw and 120 KB gzip in CI.
6. Public static preview remains fully navigable without a server API.

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
  1. The 350 KB raw and 120 KB gzip entry budgets are achievable without removing current features.
- Open questions:
  1. If measurement shows React/framework code alone prevents the budget, report
     the measured entry composition and request a revised explicit budget rather
     than deleting functionality.
