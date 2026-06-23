---
id: REQ-20260622-gke-maintainability-and-project-authoring-improvements
title: "GKE Maintainability and Project Authoring Improvements"
type: feature-request
status: in-progress
priority: P1
owner: unassigned
created_at: 2026-06-22
updated_at: 2026-06-22
tags: ["maintainability", "projects", "cli", "api", "mcp", "typescript", "cockpit"]
---

# GKE Maintainability and Project Authoring Improvements

## 1. Summary

Improve Grounded Knowledge Engine without changing its local-first product model. The work should add a deterministic human-facing API and CLI for project lifecycle operations, decompose the oversized MCP server, remove duplicated retrieval and catalog code, strengthen TypeScript boundaries, harden MCP protocol handling, and address smaller developer-experience and Cockpit build issues.

These are primarily maintainability and usability improvements rather than evidence of a fundamentally broken implementation. The current test suite, documentation, retrieval behavior, and MCP/Cockpit integration are strong and should remain behaviorally compatible throughout the work.

## 2. Problem Statement

GKE has a well-defined read model but an incomplete write and administration model for projects. Humans and agents currently create projects by manually assembling Markdown paths, frontmatter, section names, dates, source roots, and links. The parser tolerates this, but there is no supported command that guarantees a valid record.

The implementation also carries growing maintenance risk:

- `tools/kb-mcp-server/server.ts` is approximately 2,700 lines and combines transport, JSON-RPC dispatch, MCP resources, tool handlers, grounded answering, capture policy, writes, document loading, validation, formatting, and utility functions.
- `tools/grounding/retriever.ts` and `tools/grounding/sqlite-index.ts` are each over 1,200 lines.
- The two retrieval backends contain at least 29 same-purpose functions with matching names, including chunking, tokenization, frontmatter parsing, file discovery, query cache handling, evidence signals, snippets, and result cloning.
- Both retrieval implementations duplicate constants such as chunk sizes, stop words, query expansions, limits, and cache defaults.
- The MCP server contains an unused `legacyTools` catalog definition of roughly 225 lines while the advertised catalog is built from `catalog.ts`. This is dead schema duplication and creates drift risk.
- The MCP server separately implements document scanning, frontmatter parsing, title inference, track inference, and source-kind inference even though closely related logic exists in the retrieval layer.
- TypeScript uses `strict: false` in both the engine and Cockpit, while important JSON-RPC, structured-output, UI-domain, and Vite middleware boundaries use `any`.
- MCP transport and negotiation are implemented manually. The server currently returns any non-empty protocol version supplied by the client instead of negotiating against an explicit supported-version set.
- There is no lint or formatting gate and no coverage threshold.
- The Cockpit build passes but reports deprecated Vite plugin options and several Mermaid-related chunks above 500 KB.
- The architecture documents describe checkpoint and broader workspace behavior that is partly future-facing. Readers can mistake the normative target model for a fully implemented authoring workflow.

## 3. Goals

- Provide a supported human-facing project lifecycle through a reusable TypeScript API and CLI.
- Keep direct Markdown editing supported and validate manually authored records.
- Reduce duplicated behavior between BM25, SQLite, and MCP document handling.
- Turn the MCP server into a thin protocol adapter over reusable domain services.
- Strengthen type safety at external and cross-module boundaries.
- Make supported MCP protocol versions explicit and test negotiation behavior.
- Preserve all current retrieval, citation, project-isolation, ingestion, and Cockpit behavior.
- Improve contributor feedback through linting, formatting, coverage reporting, and clearer implementation-status documentation.

## 4. Non-Goals

- Replacing Markdown as the canonical source of truth.
- Requiring the Cockpit, MCP, or CLI for every file edit.
- Exposing unrestricted filesystem CRUD through MCP.
- Replacing Jira, Linear, Planner, or other task-management systems.
- Rewriting both retrieval backends into one backend.
- Migrating to a database-first project model.
- Performing unrelated dependency major-version upgrades.
- Adding hosted or remote project administration.

## 5. Users and Use Cases

- Primary users:
  - People maintaining personal or client knowledge bases.
  - Developers integrating GKE into scripts or local tooling.
  - AI assistants that need deterministic project storage operations.
  - Contributors maintaining the MCP server, retrieval backends, and Cockpit.

- Key use cases:
  - Create a valid project without memorizing the Markdown contract.
  - Validate a project created or edited manually.
  - List and inspect projects from a terminal or TypeScript caller.
  - Update one project section without rewriting unrelated content.
  - Link an existing source record to a project safely.
  - Refactor one retrieval rule without applying the same change in multiple files.
  - Add or change an MCP tool without editing a monolithic server file.
  - Upgrade protocol support without silently claiming compatibility with unknown versions.

## 6. Requirements

### Functional Requirements

- FR-1: Add a reusable project service API with at least:
  - `createProject`
  - `validateProject`
  - `listProjects`
  - `getProject`
  - `updateProject`
  - `linkProjectSource`

- FR-2: Add a human-facing CLI over the project service:

  ```text
  gke project create
  gke project validate <project-id>
  gke project list
  gke project show <project-id>
  gke project update <project-id>
  gke project link <project-id> <path>
  ```

- FR-3: Project creation must generate `kb/projects/<project-id>/project.md` with schema version 1, canonical frontmatter, required sections, and an optional source directory.

- FR-4: Project validation must report missing fields, invalid IDs or dates, duplicate project IDs, unknown lifecycle values, unsafe paths, missing source roots, and broken local links without modifying files.

- FR-5: Project updates must preserve unknown frontmatter fields, unknown body sections, comments where practical, and unrelated formatting.

- FR-6: Direct Markdown editing must remain supported. The CLI is a safety and convenience layer, not the exclusive write path.

- FR-7: Expose the same project operations as an importable TypeScript module so scripts and the Cockpit can use the same implementation.

- FR-8: Do not add project creation to the default MCP core profile. Any future MCP wrapper must call the same project service and remain an explicit optional capability.

- FR-9: Split `server.ts` into modules with explicit responsibilities:
  - stdio framing and JSON-RPC dispatch
  - protocol initialization and capabilities
  - MCP resource handlers
  - search and record handlers
  - answer and capture handlers
  - mutation handlers
  - document/catalog services
  - response shaping and validation

- FR-10: Remove the unused `legacyTools` catalog from `server.ts`; `catalog.ts` must be the single source of advertised tool definitions.

- FR-11: Extract backend-neutral retrieval utilities shared by BM25 and SQLite, including where behavior is intended to be identical:
  - scan-root normalization and safe file discovery
  - frontmatter parsing
  - title, track, and source-kind inference
  - chunking
  - token normalization, stop words, and query expansion
  - query option parsing and cache-key construction
  - snippet, context, evidence-signal, and result-cloning helpers

- FR-12: Keep backend-specific indexing and ranking isolated behind the existing `KbRetriever` contract.

- FR-13: Reuse shared document parsing and classification from the retrieval/domain layer in the MCP server instead of maintaining a third implementation.

- FR-14: Replace broad `any` usage at JSON-RPC, tool payload, project document, Cockpit domain, and Vite middleware boundaries with `unknown`, discriminated unions, generics, or explicit interfaces.

- FR-15: Introduce TypeScript strictness incrementally. New and extracted modules must compile under `strict: true`; the repository may adopt strict mode by directory or staged compiler settings before enabling it globally.

- FR-16: Maintain an explicit supported MCP protocol-version list. Initialization must select a supported version or reject an unsupported version according to the MCP contract; it must not blindly echo arbitrary input.

- FR-17: Add lint and formatting scripts for the engine and Cockpit, and run them in CI.

- FR-18: Add coverage reporting for core project parsing, project writes, retrieval shared utilities, path safety, MCP dispatch, and Cockpit project behavior. A blocking threshold may be introduced after a baseline is recorded.

- FR-19: Lazy-load Mermaid and diagram-specific dependencies in the Cockpit so ordinary project and library views do not load the full diagram stack.

- FR-20: Resolve or document the Vite React plugin deprecation warnings observed during the production build.

- FR-21: Clearly label documentation sections as `implemented`, `partially implemented`, or `planned`, especially checkpoints, workspace isolation, remote gateway behavior, and project authoring.

- FR-22: Document local installation of required verification tools such as `gitleaks`, or provide a repository-local reproducible wrapper that matches CI.

### Non-Functional Requirements

- NFR-1: All file writes must remain inside the configured repository/workspace root and reject traversal and symlink escapes.
- NFR-2: Project writes must be atomic or use a safe temporary-file-and-rename strategy.
- NFR-3: Existing MCP tool names, schemas, resources, and compact response behavior must remain backward compatible unless a versioned change is explicitly approved.
- NFR-4: BM25 and SQLite must continue to produce equivalent document metadata, chunk boundaries, filters, and citation line semantics where backend behavior is intended to match.
- NFR-5: Refactoring must not weaken the existing project cross-contamination tests.
- NFR-6: New project API operations must be deterministic and must not require network access or an LLM.
- NFR-7: The CLI must support non-interactive flags suitable for automation. Interactive prompts may be added as a convenience.
- NFR-8: Generated project files must be readable and maintainable by humans.
- NFR-9: Existing engine and Cockpit verification commands must remain available.

## 7. Proposed Solution

Introduce three shared layers:

```text
Project service
    ├── TypeScript API
    ├── CLI commands
    └── Cockpit integration

Knowledge document core
    ├── scan and parse
    ├── classify and chunk
    ├── tokenize and shape evidence
    ├── BM25 backend
    └── SQLite backend

MCP adapter
    ├── transport and protocol
    ├── catalog
    ├── resources
    └── thin tool handlers
```

Suggested modules:

```text
tools/projects/project-service.ts
tools/projects/project-writer.ts
tools/projects/project-validation.ts
tools/projects/cli.ts

tools/grounding/document-loader.ts
tools/grounding/document-parser.ts
tools/grounding/chunking.ts
tools/grounding/query-language.ts
tools/grounding/search-result.ts

tools/kb-mcp-server/transport.ts
tools/kb-mcp-server/protocol.ts
tools/kb-mcp-server/resources.ts
tools/kb-mcp-server/handlers/
```

Recommended priority:

1. P1 — Project service API, `create`, `validate`, `list`, and `show` CLI commands.
2. P1 — Remove dead `legacyTools` duplication and split the MCP server along existing behavior boundaries.
3. P1 — Extract shared retrieval/document utilities and add backend-parity tests.
4. P2 — Incremental strict typing and typed protocol/tool payload boundaries.
5. P2 — Explicit MCP version negotiation and compatibility tests.
6. P2 — Project update, source linking, and atomic write support.
7. P3 — Linting, formatting, coverage thresholds, documentation status labels, and reproducible local security tooling.
8. P3 — Cockpit Mermaid lazy loading and build-warning cleanup.

## 8. Acceptance Criteria

- [x] `gke project create my-project --title "My Project"` creates a valid canonical project record.
- [x] `gke project validate my-project` exits successfully for valid records and non-zero with actionable diagnostics for invalid records.
- [x] `gke project list` and `gke project show my-project` work without starting MCP or the Cockpit.
- [x] A manually created valid `project.md` is discovered by the CLI, Cockpit, and `kb.resume_project`.
- [x] Updating one canonical project section preserves unknown metadata and sections.
- [x] No project-authoring command is added to the default MCP core profile.
- [x] `server.ts` no longer contains an unused duplicate tool catalog and is decomposed into reviewable modules.
- [x] Shared retrieval rules exist once where BM25 and SQLite are intended to behave identically.
- [x] Backend-parity tests prove equal chunk boundaries, metadata classification, filters, and citation lines for shared fixtures.
- [x] New or extracted core modules compile with strict TypeScript settings.
- [x] Initialization tests cover every supported MCP protocol version and at least one unsupported version.
- [x] Existing `npm run test:gke` and Cockpit tests continue to pass.
- [x] CI runs linting and formatting checks.
- [x] Documentation clearly distinguishes current project support from planned checkpoint and workspace functionality.
- [x] The Cockpit production build no longer emits the observed Vite deprecation warning.
- [x] Initial project/library views do not eagerly load the full Mermaid diagram bundle.

## 9. Dependencies and Constraints

- Dependencies:
  - Existing project parser and scope resolver under `tools/projects`.
  - Existing `KbRetriever` abstraction.
  - Existing MCP catalog contract and schema-budget tests.
  - Existing Cockpit project adapter and lifecycle write-back.
  - Git history or backups for safe testing of project writers.

- Constraints:
  - Markdown remains canonical.
  - The repository is currently version `0.1.0`; compatibility should be favored over sweeping redesign.
  - The default MCP catalog is intentionally limited to four tools.
  - Node 22.5 or newer remains required because of `node:sqlite`.
  - The current parser uses simple scalar frontmatter and comma-separated lists; richer YAML support should not be introduced accidentally during refactoring.

## 10. Risks and Tradeoffs

- Risk: A broad refactor could change retrieval ranking or citation line numbers unintentionally.
  - Mitigation: Extract behavior behind characterization and backend-parity tests before changing algorithms.

- Risk: A project writer can destroy manually curated Markdown formatting.
  - Mitigation: Restrict initial updates to known fields and sections, preserve unknown content, use atomic writes, and provide `--dry-run`.

- Risk: Enabling strict mode globally may create a large noisy migration.
  - Mitigation: Apply strictness to new modules first and track remaining exceptions explicitly.

- Risk: Adopting an MCP SDK could change framing or client compatibility.
  - Mitigation: Treat SDK adoption as optional; explicit version negotiation and modular transport can be implemented without changing the working stdio behavior.

- Tradeoff: Shared retrieval utilities reduce duplication but may constrain backend-specific optimization.
  - Decision: Share only semantic invariants and preprocessing; keep storage and ranking internals backend-specific.

- Tradeoff: A CLI adds another public surface.
  - Decision: Keep it thin over the project service so behavior is not duplicated.

## 11. Rollout Plan

- Phase 1: Add characterization tests, remove `legacyTools`, extract project validation, and ship `project create/list/show/validate`.
- Phase 2: Extract shared document and retrieval utilities with BM25/SQLite parity tests.
- Phase 3: Split MCP transport, resources, and handlers; introduce typed payload boundaries and supported-version negotiation.
- Phase 4: Add controlled project updates, source linking, dry-run output, and atomic writes.
- Phase 5: Add lint/format/coverage gates, clarify documentation status, and optimize Cockpit diagram loading.

## 12. Success Metrics

- Metric: Duplicate backend-neutral retrieval functions.
  - Target: One shared implementation for every behavior intentionally common to BM25 and SQLite.

- Metric: MCP server concentration.
  - Target: No single MCP adapter module over approximately 600 lines without a documented reason.

- Metric: Type safety.
  - Target: No broad `Record<string, any>` or `Promise<any>` at public project, retrieval, or MCP handler boundaries.

- Metric: Project usability.
  - Target: A new user can create and validate a project using documented commands without copying an example file manually.

- Metric: Compatibility.
  - Target: Existing engine and Cockpit suites remain green with unchanged public core tool names.

- Metric: Cockpit delivery.
  - Target: No build deprecation warnings and Mermaid excluded from the initial non-diagram route bundle.

## 13. Open Questions

- Should the CLI executable be named `gke`, or should commands initially remain under `npm run project -- ...`?
- Should project updates use field-specific flags, an editor workflow, stdin, or a patch document?
- Should source linking modify source frontmatter, add a Markdown link to `project.md`, or offer both explicitly?
- Should project creation generate `kb/sources/<project-id>/` by default?
- Should richer YAML parsing be introduced now or deferred until arrays and nested values are required?
- Is the current hand-written MCP implementation intentionally dependency-free, or is adopting the official SDK acceptable after compatibility tests exist?
- What baseline test-coverage percentage should become blocking?

## 14. Definition of Done

- [ ] Code complete
- [ ] Tests added
- [ ] Docs updated
- [ ] Acceptance criteria met
- [ ] Existing retrieval evaluation remains within its approved baseline
- [ ] BM25/SQLite parity fixtures pass
- [ ] Project writes are traversal-safe and atomic
- [ ] MCP schema budgets remain within their configured limits
- [ ] Local and CI verification instructions are reproducible
