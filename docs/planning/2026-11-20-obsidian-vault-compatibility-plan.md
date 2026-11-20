# Obsidian Vault Compatibility Plan

**Status:** Implemented on local branches, not pushed.

**Progress note (2026-11-20):** All three slices are built as stacked
branches: `feat/obsidian-frontmatter` (safe frontmatter), `feat/obsidian-links`
(wiki-links, embeds, aliases, inline tags) and `feat/obsidian-cockpit`
(backlinks panel, Open in Obsidian). Each passed `npm run verify`. Limits:
wiki-links count as project links in resume, review and the Cockpit, but
checkpoint and decision evidence checks still accept only path links; image
embeds render only when the image is synced into the Cockpit (`assets/`
folders), otherwise the missing-asset fallback shows.
**Review date:** 2026-12-04.
**Repository:** Grounded Knowledge Engine.
**Surfaces:** `packages/contracts`, `tools/grounding`, `tools/projects`,
`apps/cockpit`.

## Goal

GKE can be pointed at an existing Obsidian vault and behave correctly: it reads
Obsidian frontmatter and links, it never damages the vault when it writes, and
the Cockpit shows backlinks and can hand a note to Obsidian for editing.

GKE stays the grounded agent layer. Obsidian stays the human editor. Both work
on the same folder; neither owns the other.

## Why now

A read-only check on 2026-11-20 found three gaps:

1. **Write risk.** `updateFrontmatter` in `tools/projects/project-service.ts`
   rewrites a key line by line. On an Obsidian block list
   (`tags:` followed by `  - a` lines) it writes `tags: a, b` and leaves the old
   `- a` lines behind, so the YAML is broken.
2. **Lost metadata.** Both frontmatter parsers
   (`tools/grounding/document-core.ts`, `apps/cockpit/src/domain/docs.ts`) read
   only `key: value` lines. Block lists are dropped, and inline lists
   (`[a, b]`) split into `"[a"` and `"b]"` through `splitCsv`.
3. **Invisible links.** Only `[text](path)` links are parsed
   (`packages/contracts/src/projects.ts`, `apps/cockpit/src/domain/docs.ts`,
   `apps/cockpit/src/domain/graph.ts`). `[[wiki-links]]` and `![[embeds]]`, the
   default in Obsidian, do not reach project context, the graph or the reader.

Also: `.obsidian/` and `.trash/` are not in `SKIP_DIRECTORIES`, so Markdown that
plugins ship inside `.obsidian/plugins/` can enter the index.

## Read

Before changing code, the agent may read:

- `AGENTS.md`, `docs/separation-of-concerns.md`, `docs/workspace-config.md`.
- The files named in "Why now", plus `tools/grounding/retriever.ts` (title
  scoring), `apps/cockpit/src/components/MarkdownArticle.tsx` (link rendering),
  `apps/cockpit/scripts/lifecycle-frontmatter.ts` (board write-back) and
  `apps/cockpit/scripts/production-boundary.ts`.
- `tools/grounding/eval/workspace-shapes.json` and its fixtures.

Obsidian syntax reference (behavior to match):

| Syntax | Meaning |
|---|---|
| `[[Note]]` | Link to the file whose name is `Note.md`, anywhere in the vault |
| `[[folder/Note]]` | Link by vault-relative path |
| `[[Note\|label]]` | Link shown as `label` |
| `[[Note#Heading]]`, `[[Note#^block]]` | Link into a heading or block; resolve to the note |
| `![[Note]]`, `![[image.png\|300]]` | Embed a note or an image |
| `tags:` / `aliases:` as inline or block YAML lists | Properties |
| `#tag`, `#parent/child` in body text | Inline tag (not in code, not a heading) |

Name resolution order: exact vault-relative path, then a unique file name, then
the shortest path among equal names, else unresolved. Matching ignores case and
the `.md` extension.

## Bound

In scope, three slices, each its own PR:

1. **Safe frontmatter (first, blocks the rest).** One browser-safe frontmatter
   module in `packages/contracts` that parses scalars, quoted strings, inline
   lists, block lists and CRLF files, and a writer that replaces a key together
   with its continuation lines. Engine and Cockpit parsers and all `splitCsv`
   callers use it. Add `.obsidian` and `.trash` to `SKIP_DIRECTORIES`.
2. **Wiki-links, embeds, aliases, inline tags.** One pure parser and resolver in
   `packages/contracts` that skips fenced and inline code. Used by project
   linked context, Cockpit link sections, the Context Graph, and the Markdown
   reader (wiki-links become internal links; image embeds render as images;
   note embeds render as a link card, not inline content). Aliases count as
   title text in retrieval scoring; inline tags join frontmatter tags.
3. **Cockpit: backlinks and Open in Obsidian.** A "Linked from" panel on the
   document reader, built from the same resolved link graph. An "Open in
   Obsidian" action using `obsidian://open?vault=<name>&file=<path>`, shown only
   when the optional `ui.obsidian.vault` setting is present and only in the
   local build.

Out of scope: an editor, sync, mobile, plugins, Canvas, Bases-style table views,
unlinked mentions, block-reference resolution beyond the note, semantic search,
and writing wiki-links (GKE keeps writing standard Markdown links, which
Obsidian reads).

## Protect

- No new MCP tools; the four `core` tools keep their names and schemas.
- Contracts stay free of Node, browser, React and filesystem APIs. No new
  runtime dependency for YAML or wiki-links unless a slice shows the subset
  parser cannot pass the tests; then stop and ask.
- Writes keep path policy, dry-run, conflict guards and the update-first rule. A
  frontmatter write must leave every key it did not touch byte-identical.
- The public build keeps serving `demo-kb` only and never shows Open in
  Obsidian (`npm run test:production-boundary`).
- Fixtures use neutral, synthetic names. No private or client text.
- Citation line numbers stay file-relative after the parser change.

## Operate

1. Branch from `origin/main` per slice: `feat/obsidian-frontmatter`,
   `feat/obsidian-links`, `feat/obsidian-cockpit`.
2. Write the failing tests first, using a small synthetic vault fixture
   (block-list tags, aliases, wiki-links with labels and headings, an image
   embed, a `.obsidian/plugins/x/README.md` decoy, a CRLF file).
3. Implement, then run `npm run verify` before each commit.
4. Update `docs/workspace-config.md` (slice 3 setting) and the README feature
   list only for what shipped.
5. No push, PR or release without the owner's OK.

## Prove

- Slice 1: round-trip test where updating `lifecycle` on a note with block-list
  `tags` and `aliases` changes only the `lifecycle` line; parser tests for each
  YAML shape; `.obsidian` decoy absent from the index.
- Slice 2: a new `obsidian-vault` shape in `workspace-shapes.json` whose floors
  stay at 1: a question that matches only an alias returns that note first;
  `kb.resume_project` lists a note linked only by `[[wiki-link]]`; citations
  resolve to file and line.
- Slice 3: Cockpit tests for the backlinks panel and for the Open in Obsidian
  action appearing only when configured and never in the production build.
- Every slice: `npm run verify -- --all` passes; the report lists each gate run.
