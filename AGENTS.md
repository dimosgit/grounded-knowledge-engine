# Agent Guide

Canonical guidance for coding agents (Claude Code, Codex, Gemini CLI) working
in this repository. `CLAUDE.md` and `GEMINI.md` import this file — edit here,
not there.

GKE is a local-first grounded knowledge engine: Markdown files are the source
of truth, the retrieval index (BM25 / SQLite FTS5) is derived and disposable,
and the same engine core is exposed through a CLI, a local MCP server, and the
optional Operator Cockpit web preview. This repo is **public** — see
Sanitization below before committing anything.

## Two npm trees

The engine (repo root) and the Cockpit (`apps/cockpit`) have separate
`package.json`, lockfiles, installs, and CI jobs. Run commands in the right
tree. Node ≥ 22.5 is required (built-in `node:sqlite`); CI tests Node 22 and 24.

## Commands — engine (repo root)

```bash
npm install
npm run typecheck
npm run lint                 # eslint over tools/
npm run format               # prettier --write (root *.md are gated too)
npm run build                # tsc -> dist/
npm run test:gke             # full engine suite (what CI runs)
npm run scrub                # sanitization gate; requires gitleaks installed
```

There is no test framework at the root: each suite is a standalone `tsx`
script, so "run a single test" means running its npm script directly:

| Script                                     | Covers                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| `npm run test:mcp:catalog`                 | MCP profiles, output schemas, annotations, size budgets      |
| `npm run test:mcp:transport`               | NDJSON + legacy Content-Length framing                       |
| `npm run test:mcp:http`                    | loopback HTTP bridge + API-key auth                          |
| `npm run test:projects`                    | strict project resolution, isolation, resource parity        |
| `npm run test:project-service`             | project CLI service (create/update/link/validate)            |
| `npm run test:document-core`               | shared document parsing                                      |
| `npm run smoke:mcp`                        | end-to-end MCP discovery, grounding, capture, resume         |
| `npm run test:loop`                        | ground → capture → re-ground → cite loop                     |
| `npm run test:ingest:unit` / `test:ingest` | ingestion pipeline (PDF/DOCX/XLSX fixtures)                  |
| `npm run eval`                             | retrieval quality against `tools/grounding/eval/qa-set.json` |

Other frequently used entry points: `npm run search -- --query "…"`,
`npm run project -- <create|list|show|validate|update|link>`,
`npm run ingest -- <folder>`, `npm run setup:mcp`, `npm run dev:mcp`.

## Commands — Cockpit (`apps/cockpit`)

```bash
cd apps/cockpit
npm install
npm run dev          # watch:content + vite (localhost:5173)
npm run test         # vitest run (pretest syncs content)
npx vitest run src/__tests__/<name>.test.tsx   # single test file
npm run typecheck && npm run lint && npm run format:check && npm run build
```

Do not run `test` and `build` in parallel — both sync Markdown into
`apps/cockpit/content/`.

## CI gates that bite

- **Prettier is a CI gate**, including root-level `*.md`. Run `npm run format`
  (root) or `npm run format` (cockpit) after editing.
- **The scrub gate scans tracked files only** (`git grep`). A new file passes
  locally until it is `git add`ed — stage first, then run `npm run scrub`.
  The blocked-term regex lives in `scripts/scrub-gate.sh` (do not quote those
  terms in committed prose — the gate will match them); gitleaks then scans
  the full history, and the gate fails closed if a scanner is missing.
- **MCP catalog budgets**: every advertised tool needs an output schema and
  safety annotations, and the catalog has enforced tool-count and character
  budgets (`npm run test:mcp:catalog`). Adding a tool means fitting the budget
  or consciously raising it in the test.

## Architecture

Data flow: Markdown KB → derived index → three surfaces (CLI, MCP, Cockpit).
Delete the index anytime; `--refresh` rebuilds it from the Markdown.

- **`tools/grounding`** — deterministic indexing, retrieval, grounded synthesis
  with file-and-line citations, and the eval harness.
- **`tools/projects`** — the shared project model: parses canonical project
  records (`record_type: project`, `project_id`,
  `kb/projects/<id>/project.md`), resolves membership **explicitly only**
  (`project_id`, canonical folder, `source_roots`, links — never semantic
  similarity), and formats resume capsules/handoffs. Both the MCP server and
  the Cockpit import this module, so a change here updates both surfaces;
  keep the parser browser-safe (no Node-only imports).
- **`tools/kb-mcp-server`** — provider-neutral MCP server over stdio using
  newline-delimited JSON (legacy `Content-Length` input frames still parse).
  The `core` profile exposes exactly four tools (`kb.search`, `kb.get_record`,
  `kb.answer_and_capture`, `kb.resume_project`); `full` adds advanced/write
  tools, and write tools stay out of discovery unless writes are enabled.
  Addressable context uses `gke://` resources. `server-http.ts` is an optional
  read-only loopback bridge gated by `KB_MCP_HTTP_API_KEY` (fails closed).
- **`tools/ingest`** — local pipeline `detect → extract → normalize → scrub →
capture → index`. `GKE_INGEST_CONVERTER=auto|native|markitdown` selects the
  converter; ingestion paths are deterministic so re-ingestion is idempotent.
- **`apps/cockpit`** — React/Vite preview. `scripts/sync-markdown.ts` copies
  `demo-kb/**` and `kb/**` into `content/` under one logical `kb/` namespace;
  `src/domain/` is pure data transformation; `App.tsx` stays a thin
  orchestrator. Extension points: new screen → `src/views/`, derived-data rule
  → `src/domain/`, browser side effect → `src/hooks/`, route syntax →
  `src/lib/routes.ts`.

Knowledge content: `demo-kb/` is the sanitized public demo corpus; `kb/` is
the private local workspace and is gitignored except deliberately sanitized
topic files. `examples/demo-project-workspace/` is generated by
`npm run export:demo-projects` — regenerate rather than hand-editing.

## Sanitization (public repo)

Everything committed ships publicly. Demo and example content must never
contain real customer identifiers, private endpoints, or secrets — use
placeholders (`YOUR-DOMAIN`, env vars for keys). `npm run scrub` is the
enforcement, but it is a backstop, not permission to be careless.

Machine-local generated configs (`.mcp.json`, `.claude/settings.local.json`,
`.codex/config.toml`, `.gemini/settings.json`) come from `npm run setup:mcp`
and are gitignored — never commit them or hardcode absolute local paths.

## Documentation conventions

The README and `docs/` deliberately label **implemented** vs **planned**
capabilities. When changing behavior, keep those labels truthful — do not
describe planned features as current, and update
`docs/workspace-data-architecture.md` status labels when a planned record type
lands. Commit subjects follow the existing conventional style
(`feat(mcp): …`, `fix(scrub): …`, `docs: …`).
