# Operator Cockpit

`cockpit` is the local web UI layer over the grounded knowledge engine.

It is not a separate CMS. The app reads Markdown from the repository's knowledge
base, derives navigation / project / graph data from that Markdown, and presents
it as a dark "Operator Cockpit". The engine (CLI + MCP server) is the product;
this app is an optional way to browse the same notes the engine grounds against.

## What The App Does

- Gives a dashboard-style home view ("Mission Control") for the current project context.
- Lets you browse all Markdown notes with track, item, and document-type filters.
- Provides full-text search and a command bar.
- Renders Markdown with GFM tables, Mermaid diagrams, internal links, relative assets, and unresolved-asset fallbacks.
- Shows digest quick-recall panels.
- Builds a project board from Markdown project sections, with drag-to-lane moves persisted back to frontmatter in dev.
- Builds structured project detail pages from the shared engine parser, including
  current focus, recent changes, decisions, blockers/questions, next actions,
  linked context, and a copyable technical handoff.
- Builds a major-context graph across tracks, modules, and projects.

## Routes

- `#/hub`: Mission Control dashboard.
- `#/doc/:encodedPath`: Knowledge Base reader for a Markdown file.
- `#/projects`: Project Board.
- `#/project/:projectId`: Project detail page.
- `#/graph`: Context Graph overview.
- `#/graph?focus=:focusId`: Context Graph focused on a major node.

## Run Locally

```bash
cd apps/cockpit
npm install
npm run dev
```

`npm run dev` starts two processes:
- `watch:content`: watches source Markdown and syncs it into `apps/cockpit/content`
- `vite`: serves the React app

The local URL is usually `http://localhost:5173`.

## Manual Content Sync

```bash
cd apps/cockpit
npm run sync:content
```

The app indexes synced files from the repository-root knowledge folders. By
default it syncs `demo-kb/**/*.md` and `kb/**/*.md`, funneling both under a
single logical `kb/` namespace inside `content/`. Override the source folders
with the `KB_PREVIEW_SOURCE_FOLDERS` environment variable (a comma-separated
list of `from:to` pairs, where `:to` is optional and defaults to the source
name), e.g.:

```bash
KB_PREVIEW_SOURCE_FOLDERS="demo-kb:kb,kb:kb" npm run sync:content
```

The synced copy lives under `apps/cockpit/content` and is read by Vite through:

```js
import.meta.glob("../content/**/*.md", { query: "?raw", import: "default", eager: true })
```

## Scripts

```bash
npm run dev
npm run sync:content
npm run build
npm run preview
npm run test
npm run test:watch
npm run typecheck
```

Notes:
- `pretest` and `prebuild` automatically run `sync:content`.
- Do not run `npm run test` and `npm run build` in parallel because both sync content.
- `build` emits the static app into `apps/cockpit/dist`.

## Architecture

The app is split so `App.tsx` remains a thin orchestrator.

```text
Markdown source files (demo-kb/, kb/)
  -> scripts/sync-markdown.ts
  -> content/**/*.md
  -> domain/catalog.ts
  -> domain view models
  -> route views
```

### Top-Level Orchestration

- `src/App.tsx`
  - loads synced Markdown
  - owns top-level UI state
  - coordinates navigation actions
  - chooses the active route view

### Views

- `src/views/HubView.tsx`: dashboard/home screen — active project, current module, open questions, tracks, recent docs.
- `src/views/LibraryView.tsx`: Knowledge Base reader — filters, side list, Markdown article, digest quick view, print/PDF mode.
- `src/views/ProjectBoardView.tsx`: project board columns.
- `src/views/ProjectDetailView.tsx`: project status, focus, changes, decisions,
  blockers/questions, actions, linked docs, and handoff copying.
- `src/views/ContextGraphView.tsx`: major-context graph with focus selection, zoom, fit/reset, node movement, and collapsible context links.

### Components

- `src/components/OperatorFrame.tsx`: shared cockpit frame, sidebar, top bar, command entry.
- `src/components/CommandBar.tsx`: quick search and command navigation.
- `src/components/MarkdownArticle.tsx`: Markdown rendering, Mermaid, links, images, TOC behavior.
- `src/components/ProjectCard.tsx`: compact project card used by the board.
- `src/components/HighlightedText.tsx`: search-result highlighting helper.

### Domain Layer

The domain layer is pure data transformation where possible.

- `src/domain/catalog.ts`: builds indexed doc objects from raw Markdown, applies indexing exclusions, computes initial fallback document.
- `src/domain/docs.ts`: frontmatter parsing; title/excerpt/type/track/tag derivation; labels and ordering; breadcrumbs; Markdown section helpers; digest quick-view extraction; internal doc and asset path resolution.
- `src/domain/library.ts`: tracks and item counts; tag counts; visible filters; filtered/grouped docs; curation stats; recent docs.
- `src/domain/projects.ts`: adapts the shared project parser into Cockpit project
  summaries, status buckets, board columns, linked documents, and handoffs.
- `src/domain/graph.ts`: relationship scoring; major-node focus options; overview/focused graph construction; context graph for project detail pages.
- `src/domain/hub.ts`: dashboard summaries.

### Hooks

- `src/hooks/useRecentPaths.ts`: persists recently opened docs in localStorage.
- `src/hooks/useRouteSync.ts`: syncs hash/popstate routes into app state.
- `src/hooks/useGraphInteractions.ts`: graph zoom, pan-like movement, reset, and node repositioning.

### Lib

- `src/lib/routes.ts`: hash route parsing and hash writers.
- `src/lib/search.ts`: normalized/compact search indexing and matching.
- `src/lib/utils.ts`: shared utility helpers.

## Data Derivation Rules

### Document Model

Each Markdown file becomes a doc object with `path`, `section`, `tag`,
`docType`, `learningItemType`, `track`, `trackLabel`, `frontmatter`, `title`,
`excerpt`, and raw/normalized/compact search fields.

The `track` is taken from frontmatter `track:` (slugified); the demo corpus uses
`track: demo`.

### Project Detection

Canonical projects use:

- `record_type: project`
- an explicit `project_id`
- `kb/projects/<project-id>/project.md` (or its `demo-kb` equivalent)

Project-linked sources can declare the same `project_id`, live under an
explicit `source_roots` folder, or be linked from the project record.

The Cockpit imports the browser-safe parser from `tools/projects`, so its
project facts and handoff format match `kb.resume_project`. Legacy notes using
`type: project`, `module`, `## Current status`, or `## Next 3 actions` remain
readable for compatibility.

### Project Board Status

- `blocked`: project has blockers.
- `active`: project has next actions and no blockers.
- `next`: project has status/focus but no active next actions.
- `reference`: project-like context that is not an active board item.

The visible board shows `Active`, `Next Up`, and `Blocked`. In dev, dragging a
card to a new lane writes a `lifecycle:` value back to the source Markdown's
frontmatter; the content watcher re-syncs and HMR reloads the card.

### Graph Relationships

Graph relationships are derived from explicit Markdown links, backlinks, shared
module key, module ownership, shared tags, shared track, title mentions, and the
project/module/track hierarchy. Major focus options: overview, tracks, modules,
projects.

## Styling

- Tailwind CSS is the primary styling tool.
- `src/styles.css` contains the app-wide dark cockpit styling and Markdown rendering rules.
- `lucide-react` is used for icons.

## Testing

```bash
npm run test
```

Coverage includes app flow and route behavior, search normalization, internal
Markdown link navigation, asset path rendering, Markdown article rendering,
lifecycle-frontmatter write-back, shared canonical/legacy Project Context,
restricted-browser clipboard fallback, and graph controls.

## Extending The App

- New route screen: add a file in `src/views`.
- New repeated UI primitive: add a file in `src/components`.
- New derived data rule: add it to `src/domain`.
- New browser side effect: add a hook in `src/hooks`.
- New route syntax: update `src/lib/routes.ts`.
- New Markdown convention: update `src/domain/docs.ts` or `src/domain/catalog.ts`.

Keep `App.tsx` focused on state orchestration and route composition.
