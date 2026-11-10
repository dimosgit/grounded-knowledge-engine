# Changelog

All notable changes to Grounded Knowledge Engine are documented here.

## 0.2.2 — 2026-11-09

### Grounded answers

- Fixed file-and-line citations: line numbers counted from the end of the
  Markdown frontmatter, and sometimes one line early, so every citation into a
  file with frontmatter pointed above the cited text. Citations are now
  file-relative in both the BM25 and SQLite backends, matching decision and
  checkpoint evidence. Both index formats are versioned, so existing caches
  rebuild on first use.
- Fixed answers quoting an unrelated record: a weakly ranked source that shared
  one title word with the question could supply the visible answer while the
  citations pointed elsewhere. A source is now quoted only when its evidence
  scores at least half of the top hit or the question names it, and long
  records are answered only from the lines next to their citations.

### Security hardening

- Ingestion rejects files over 50 MB and ZIP-based documents (DOCX, XLSX,
  PPTX) whose central directory declares more than 200 MB uncompressed, more
  than 10,000 entries, or an extreme compression ratio, before any parser runs.
  The archive is found from its end record, as ZIP readers do, so data placed
  before an archive cannot skip the check; such archives are rejected, as are
  ZIP-based files with no end record. Rejected files are reported as skipped. Override with
  `GKE_INGEST_MAX_FILE_MB` and `GKE_INGEST_MAX_UNZIPPED_MB`.
- The HTTP bridge refuses to start unless `KB_MCP_HTTP_API_KEY` has at least
  32 characters, rejects empty or oversized JSON-RPC batches (more than 20
  messages), and stops processing a batch once its request has timed out.
- `gke setup` writes client configuration atomically through an unpredictable,
  exclusively created temporary file, including the Codex TOML, which was
  previously written in place.
- Updated dependencies with published advisories: Vite 8.1.6 for the Cockpit
  dev server, `@xmldom/xmldom` 0.8.15 for DOCX parsing, DOMPurify 3.4.17, and
  patched development tooling.

### Documentation

- The README now states that retention is automatic and update-first when
  writes are enabled, and that named workspaces start with writes disabled.

### Client registration

- Added `gke setup --scope user` (`npm run setup:mcp -- --scope user`), which
  registers the server in each client's home configuration — `~/.claude.json`,
  `~/.codex/config.toml`, `~/.gemini/settings.json`, and VS Code's user
  `mcp.json` — so Claude Code, Codex, Gemini CLI, and Copilot reach a workspace
  from every folder instead of only the checkout that generated the config.
  Scope selects where the registration is written; the served knowledge base is
  unchanged, recorded as an absolute path.
- Refused to silently repoint an existing user-scope server name at a different
  workspace, since those names are global. Register additional vaults under
  their own `--workspace` ID, or pass `--force`.
- Backed up each home configuration to `<file>.gke-backup` before the first
  modification, and added `gke setup --help`.

## 0.2.1 — 2026-08-13

### Agent behavior and attribution

- Made `AGENTS.md` the explicit operating contract for grounded MCP routing and
  added repository instructions for GitHub Copilot.
- Defined AI assistants as tools rather than contributors and prohibited AI
  author, co-author, reviewer, session, and release attribution.
- Included the agent contract, client guidance, and grounded knowledge workflow
  skill in the installable release package.

### Operator Cockpit

- Expanded the Context Graph with readable project, decision, checkpoint,
  attention, and explicitly scoped evidence relationships.
- Added direct project-task writeback through the shared project service.

### Sanitization

- Split the scrub gate's blocked terms into a published, non-identifying list
  (`scripts/scrub-patterns.public.txt`) and a machine-local overlay
  (`.gke/scrub-patterns.txt`, untracked). The tracked gate no longer has to
  name the workspace-specific identifiers it exists to keep out of the
  repository.
- Added `scripts/scrub-patterns.local.example.txt` as the overlay template, and
  `GKE_SCRUB_PUBLIC_ONLY=1` for CI and outside contributors, who cannot hold a
  maintainer's local list. The gate announces the reduced scan on every such
  run and still fails closed when the overlay is missing locally.

## 0.2.0 — 2026-08-01

### Productized installation

- Added a downloadable package with the `gke` executable.
- Added `gke setup` to configure Codex, Claude, Gemini CLI, and GitHub Copilot
  from the current workspace.
- Packaged clients launch compiled JavaScript and no longer depend on a source
  checkout or the `tsx` development runtime.
- Added `gke demo` to scaffold a writable, sanitized demonstration workspace.
- Added an installed-package integration test covering pack, install, MCP
  setup, protocol smoke verification, demo creation, and project resume.

### Grounded project memory

- Added action-first project resume, append-only checkpoints, project review,
  and strict project isolation.
- Added durable decision records with evidence review and supersession.
- Added conflict-safe grounded capture and shared application services across
  CLI, MCP, and Cockpit surfaces.
- Added local document ingestion with source-aware re-ingestion.
- Added separately named, process-isolated workspace vaults.

### Operator Cockpit

- Added workspace identity and write-policy visibility.
- Added the shared Attention Inbox and live review badge.
- Added the typed command palette across documents, projects, decisions, and
  review destinations.
- Added grounded Ask, capture review, decision replay, responsive navigation,
  accessibility coverage, lazy content loading, and bundle budgets.

### Documentation

- Added the five-minute golden-path tutorial.
- Added explicit “who GKE is for” and “who GKE is not for” positioning.

## 0.1.0 — 2026-07-14

- Published the first public local-first grounding, MCP, ingestion, project,
  and Cockpit baseline.
