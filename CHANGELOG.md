# Changelog

All notable changes to Grounded Knowledge Engine are documented here.

## Unreleased

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
