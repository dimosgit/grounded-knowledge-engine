# KB MCP Server

Provider-neutral local MCP server over the repository's configured Markdown
knowledge roots.

Runs over **stdio** by default (`npm run dev:mcp`). An optional read-only
**loopback HTTP bridge** (`npm run dev:mcp:http`) exposes the same tools for
remote agents (Copilot Studio / M365 declarative agents) via a short-lived
authenticated tunnel — see [docs/integrations/remote-mcp-tunnel.md](../../docs/integrations/remote-mcp-tunnel.md).

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

Daily attention and project deltas are available without adding another MCP
tool. `gke review` reports due or overdue project reviews, blockers, open
questions, and explicitly scoped documents changed since an optional ISO date:

```bash
gke review --as-of 2026-07-13
gke review my-project --since 2026-07-01 --json
```

AI clients can read the current workspace attention report through the
read-only `gke://workspace/review` resource.

Project creation and validation intentionally live outside MCP. Use the
human-facing project CLI:

```bash
npm run project -- create my-project --title "My Project"
npm run project -- validate my-project
npm run project -- list
npm run project -- update my-project --current-focus "Validate the next milestone"
npm run project -- link my-project notes/evidence.md
```

Direct Markdown authoring remains supported at
`kb/projects/<project-id>/project.md`.

## Capture planning and review

The capture domain keeps duplicate advice separate from write authorization.
An unambiguous new path can be created immediately. A fuzzy duplicate candidate
or existing target produces a versioned proposal under
`.gke/capture-proposals/`; the candidate never becomes the target
automatically. Existing-target replacement and append are applied only after
review against the exact base-content hash.

Proposal review is deliberately a local CLI/application-service surface, not a
fifth core MCP tool:

```bash
gke capture list
gke capture show <proposal-id>
gke capture apply <proposal-id> --action <create|append|replace|open-question>
gke capture reject <proposal-id>
```

The stdio server reports proposal metadata in existing capture output. The
read-only HTTP bridge cannot advertise or execute proposal writes.

## Resources

The server advertises:

- `gke://workspace/info`
- `gke://workspace/review`
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

- The transport emits newline-delimited JSON over stdio and accepts legacy
  `Content-Length` input frames for compatibility.
- Framing and JSON-RPC dispatch live in `transport.ts`; tool and resource
  behavior remain transport-independent callbacks.
- Every advertised tool has a formal output schema and MCP safety annotations.
- The `core` catalog is limited to four tools and 7,000 serialized schema
  characters.
- The `full` catalog is limited to eleven tools and 13,500 characters.
- Real writes require `KB_MCP_ENABLE_WRITES=true`; `dryRun=true` remains
  available for write previews.
- `kb.answer_grounded` is evidence-gated and can abstain.
- `kb.answer_and_capture` couples retrieval with explicit capture policy.
- Canonical capture writes use realpath containment, per-proposal locking,
  atomic replacement, and post-write index refresh.
- No external network dependency is required.

## Verification

```bash
npm run test:mcp:catalog  # profiles, schemas, annotations, and budgets
npm run test:mcp:transport # framing, notifications, invalid JSON, and RPC errors
npm run test:mcp:http     # loopback HTTP bridge: parity, auth, write-denial, limits
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
