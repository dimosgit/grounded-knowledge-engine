# Feature Prompt Template

## 1. Feature Title
`MCP Core Modernization — Small Semantic Surface, Typed Results, and Addressable Resources`

## 2. Objective
Modernize the existing GKE MCP server before implementing Project Context, Workspace Vaults, Remote MCP, or Decision Replay. Keep the protocol surface intentionally small, semantic, measurable, and safe while preserving the CLI/core as the deterministic implementation. Establish reusable catalog, schema, resource, and compatibility foundations for every planned feature.

## 3. Context
- Product area: `MCP server catalog, protocol contract, tool safety, resources, and CI`
- Current behavior: `The server advertises nine tools with input schemas and structured results. Topic and term reads are separate tools, no output schemas or safety annotations are advertised, resources and prompts are empty, and catalog size is not constrained by CI.`
- Problem to solve: `As consultant features are added, the tool surface could grow into the kind of expensive low-level MCP catalog the product is intended to avoid. Clients also cannot formally validate structured output or address records as resources.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Add `core` and `full` MCP catalog profiles.
  2. Hide mutating tools when writes are disabled.
  3. Add semantic `kb.get_record` and keep topic/term getters as full-profile compatibility aliases.
  4. Add formal `outputSchema`, titles, and safety annotations.
  5. Expose workspace information and KB records through MCP resources.
  6. Add schema-budget and protocol compatibility tests.
  7. Update setup and server documentation.
- Out of scope:
  1. Project Context API implementation.
  2. Workspace Vault enforcement.
  3. Decision Replay implementation.
  4. Remote Streamable HTTP transport.
  5. LLM sampling or autonomous network access.

## 5. Requirements
1. Support `KB_MCP_PROFILE=core|full`; default to `core`.
2. The `core` profile exposes semantic day-to-day capabilities only.
3. The `full` profile adds administrative tools and compatibility aliases.
4. When `KB_MCP_ENABLE_WRITES=false`, tools whose primary behavior mutates state must not appear in `tools/list`.
5. `kb.answer_and_capture` must remain usable read-only: automatic capture resolves to `none` when writes are disabled, while explicitly requested writes return a visible tool error.
6. Add `kb.get_record` accepting a query plus optional kind/path scope.
7. Keep `kb.get_topic` and `kb.get_term` operational in the `full` profile for backward compatibility.
8. Every advertised tool must include:
   - Human-readable title
   - Input schema
   - Output schema
   - MCP safety annotations
9. Tool results with `structuredContent` must conform to the advertised output schema.
10. Expose `gke://workspace/info` and a parameterized record resource URI.
11. Implement `resources/read` for workspace information and indexed Markdown records.
12. Do not list every KB document as a static resource; use a template to avoid replacing tool-schema bloat with resource-list bloat.
13. Add a schema-budget test covering tool count, serialized catalog size, annotations, output schemas, and duplicate semantic tools.
    - Core: no more than 4 tools and 5,200 serialized characters.
    - Full: no more than 10 tools and 12,000 serialized characters.
14. Add protocol tests for at least the current baseline version and a newer supported version.
15. Business/tool failures must return `isError: true`; protocol errors remain JSON-RPC errors.

## 6. Technical Constraints
1. Keep the CLI/retrieval/write implementation independent of MCP transport.
2. Do not break newline-delimited JSON stdio framing.
3. Keep full-profile compatibility during migration.
4. Resources use workspace-relative logical URIs and never expose absolute host paths.
5. Safety annotations are hints only; existing write authorization remains authoritative.
6. Catalog budgets must be explicit constants and fail CI when exceeded.
7. Avoid adding a large SDK dependency solely for the stdio refactor.
8. The catalog design must allow Project Context and Decision Replay to add semantic tools without duplicating schemas.

## 7. Implementation Notes
1. Extract catalog/schema definitions into `tools/kb-mcp-server/catalog.ts`.
2. Add reusable JSON schemas for citations, documents, search results, grounded answers, captures, and refresh results.
3. Add a generic record handler in `server.ts`; implement aliases by adapting arguments to it.
4. Add `tools/kb-mcp-server/schema-budget-test.ts`.
5. Use `gke://record/<encoded-workspace-relative-path>` or an equivalent custom URI with strict decoding and path validation.
6. Advertise resources capability only when resource handlers are implemented.
7. Update `scripts/configure-mcp.mjs` so generated clients receive an explicit profile.
8. Update the MCP README with profile behavior and migration notes.

## 8. Test Requirements
1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `No dedicated lint script exists today; record lint as N/A unless the implementation adds one.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:mcp:catalog && npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria
1. The default catalog is smaller than the previous full catalog and contains no raw administrative write tools.
2. Read-only mode advertises no primary mutation tools.
3. `kb.get_record` retrieves both topic and term records; full-profile aliases still work.
4. Every advertised tool has an output schema and safety annotations.
5. `resources/read` returns workspace-relative Markdown records without exposing host paths.
6. Schema-budget tests fail when agreed tool-count or serialized-size limits are exceeded.
7. Existing ingestion, grounding, loop, Cockpit, and scrub tests remain green.

## 10. Deliverables
1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules
1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.

## 12. Assumptions and Open Questions
- Assumptions:
  1. Existing users can opt into `full` when they need low-level tools.
  2. A custom `gke://` URI is acceptable for local and future remote clients.
  3. Compatibility aliases may be removed only in a later major release.
- Open questions:
  1. Should user-controlled MCP prompts ship in the same release or immediately afterward?
  2. Should the default setup enable writes, or should setup become read-only unless `--writes` is explicit?
