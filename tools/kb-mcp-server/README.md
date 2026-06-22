# KB MCP Server

Provider-neutral local MCP server over the repository's configured Markdown
knowledge roots.

## Profiles

The default `core` profile exposes four semantic tools:

- `kb.search`
- `kb.get_record`
- `kb.answer_and_capture`
- `kb.resume_project`

The `full` profile additionally exposes:

- `kb.get_topic` and `kb.get_term` compatibility aliases;
- `kb.list_modules`;
- `kb.answer_grounded`;
- `kb.refresh`;
- `kb.upsert_note` and `kb.add_open_question` when writes are enabled.

When writes are disabled, mutation tools are omitted from discovery.
`kb.answer_and_capture` remains available as a read-only grounded answer tool
and skips automatic capture.

## Run and configure

```bash
npm run dev:mcp
npm run setup:mcp
```

`setup:mcp` writes project-local adapters for Claude Code, Codex, and Gemini
CLI. Every adapter launches this same server; there are no provider-specific
server implementations.

```bash
npm run setup:mcp -- --client claude
npm run setup:mcp -- --client codex
npm run setup:mcp -- --client gemini
npm run setup:mcp -- --profile core
npm run setup:mcp -- --profile full
npm run setup:mcp -- --no-writes
```

## Project Context

`kb.resume_project` accepts an explicit `projectId` and returns a compact
structured capsule containing:

- title and start-here brief;
- current focus and recent changes;
- active decisions;
- blockers and open questions;
- the next three actions;
- key documents and line citations.

Canonical project records live at `kb/projects/<project-id>/project.md` or the
equivalent configured scan root. Membership is determined through explicit
project metadata, canonical folders, source roots, and links—not semantic
similarity. Unknown IDs fail rather than falling back to a similarly named
project.

The same capsule is available as:

```text
gke://project/{projectId}/context
```

## Resources

The server advertises:

- `gke://workspace/info`
- `gke://record/{path}`
- `gke://project/{projectId}/context`

Resources use logical, workspace-relative identifiers and do not expose host
filesystem paths.

## Environment variables

- `KB_MCP_REPO_ROOT`: repository/workspace root. Defaults to this repository.
- `KB_MCP_SCAN_ROOTS`: comma-separated roots relative to the repository root.
  Defaults to `demo-kb,kb`.
- `KB_MCP_PROFILE`: `core|full`. Defaults to `core`.
- `KB_MCP_ENABLE_WRITES`: `true|false`. Defaults to `false`.
- `KB_MCP_REQUIRE_CAPTURE`: `true|false`. Defaults to `true`.
- `KB_MCP_RESPONSE_FORMAT`: `compact|full`. Defaults to `compact`.
- `KB_MCP_RETRIEVAL_BACKEND`: `bm25|sqlite`. Defaults to `bm25`.
- `KB_MCP_SQLITE_PATH`: SQLite index path. Defaults to
  `.cache/kb-retriever.sqlite`.
- `KB_MCP_CACHE_TTL_MS`: in-memory index cache TTL. Defaults to `15000`.
- `KB_MCP_QUERY_CACHE_TTL_MS`: query cache TTL. Defaults to `45000`.
- `KB_MCP_QUERY_CACHE_MAX_ENTRIES`: maximum cached queries. Defaults to `240`.
- `KB_MCP_WRITE_REFRESH_DEBOUNCE_MS`: post-write refresh debounce. Defaults to
  `75`.
- `KB_MCP_SLO_MS`: answer-tool SLO threshold. Defaults to `3000`.
- `KB_MCP_LOG_LEVEL`: `off|error|warn|info|debug`. Defaults to `error`.
- `KB_MCP_WORKSPACE_ID`: logical workspace identifier exposed by the workspace
  resource. Defaults to `default`.

## Protocol and safety

- The transport is newline-delimited JSON over stdio.
- Every advertised tool has a formal output schema and MCP safety annotations.
- The `core` catalog is limited to four tools and 7,000 serialized schema
  characters.
- The `full` catalog is limited to eleven tools and 13,500 characters.
- Real writes require `KB_MCP_ENABLE_WRITES=true`; `dryRun=true` remains
  available for write previews.
- `kb.answer_grounded` is evidence-gated and can abstain.
- `kb.answer_and_capture` couples retrieval with explicit capture policy.
- Write operations are queued and index refresh is debounced.
- No external network dependency is required.

## Verification

```bash
npm run test:mcp:catalog  # profiles, schemas, annotations, and budgets
npm run test:projects     # strict project resolution, isolation, resource parity
npm run smoke:mcp         # discovery, resources, search, capture, reuse, resume
npm run test:loop         # ground → capture → re-ground → cite
npm run eval -- --k 5 --runs 3 --refresh
npm run eval -- --k 5 --runs 3 --backend sqlite
```

Use a custom QA set or include retrieval traces:

```bash
npm run eval -- --file tools/grounding/eval/qa-set.json --json
npm run eval -- --k 5 --traces
```
