# Feature Prompt Template

## 1. Feature Title
`Remote MCP Gateway — Microsoft 365 Copilot, Copilot Studio, and GitHub Copilot Compatibility`

## 2. Objective
Expose GKE’s existing provider-neutral tools through a secure Streamable HTTP MCP endpoint while preserving the current local `stdio` server. This enables a GKE-backed agent in Microsoft Copilot Studio or Microsoft 365 Copilot and improves GitHub Copilot support without creating provider-specific business logic. The remote path must be opt-in, authenticated, workspace-scoped, and read-only by default.

## 3. Context
- Product area: `MCP transport, deployment, authentication, setup adapters, and enterprise integration`
- Current behavior: `GKE runs as a local newline-delimited JSON stdio MCP server and configures Claude Code, Codex, and Gemini CLI. GitHub Copilot clients can support local MCP servers, but GKE has no generated adapter for them. Microsoft Copilot Studio and Microsoft 365 Copilot MCP integrations require a remotely reachable Streamable HTTP server URL, which the current stdio-only process does not provide.`
- Problem to solve: `A consultant who works inside Microsoft 365 or GitHub Copilot cannot consistently access the same GKE memory from those surfaces. A naive public tunnel would weaken the product’s local-first and data-protection guarantees.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Refactor the existing MCP domain/tool handling so it can be hosted by both stdio and Streamable HTTP transports.
  2. Add an opt-in Streamable HTTP endpoint, default `/mcp`.
  3. Add API-key authentication for the first remote milestone and define an OAuth/OIDC follow-up.
  4. Enforce one workspace identity and policy per deployed endpoint.
  5. Add setup/documentation for GitHub Copilot local use.
  6. Add a Microsoft Copilot Studio onboarding guide and a Microsoft 365 declarative-agent example.
  7. Add transport parity and security tests.
- Out of scope:
  1. Exposing a user’s unrestricted filesystem to a hosted service.
  2. Shipping a public multi-tenant SaaS.
  3. Anonymous write-enabled endpoints.
  4. Synchronizing Microsoft Graph, Teams, Outlook, or SharePoint content in this feature.
  5. Interactive Microsoft 365 Copilot widgets in the first release.
  6. Replacing the local stdio server.

## 5. Requirements
1. Extract tool definitions and handlers from transport-specific code into a shared MCP application layer.
2. Preserve all existing stdio behavior and tests.
3. Add a Streamable HTTP server that:
   - Accepts MCP requests at `/mcp`
   - Provides `/healthz`
   - Uses HTTPS in every non-local environment
   - Applies request-size, timeout, and concurrency limits
4. Support stateless operation where possible. If session state is required by the selected MCP SDK/transport, bind it to authenticated workspace identity and expire it.
5. Default remote operation to read-only, regardless of local defaults.
6. Require an explicit deployment setting to enable remote writes.
7. Require authenticated identity for any remote write.
8. Add API-key authentication for v1 with constant-time comparison and secret loading from environment/secret store.
9. Define, but do not necessarily implement in v1, OAuth 2.0/OIDC suitable for individual-user authorization in Copilot Studio.
10. Integrate the Workspace Vault policy object so the endpoint cannot access data outside its configured workspace.
11. Return sanitized citations. Do not reveal absolute host filesystem paths to remote clients.
12. Add CORS and origin policy only where required; do not use permissive `*` with credentials.
13. Add structured security logs without document bodies or raw secrets.
14. Add `npm run dev:mcp:http` for local testing and a production start command.
15. Add `npm run setup:mcp -- --client github-copilot` or a documented equivalent for supported GitHub Copilot local clients.
16. Add a sample Microsoft Copilot Studio configuration describing:
   - Server URL
   - Streamable HTTP transport
   - API-key or OAuth setup
   - Generative orchestration requirement
   - Read-only recommended tools
17. Add a sample Microsoft 365 Agents Toolkit declarative-agent package that references the remote MCP endpoint.
18. Clearly document that ordinary Microsoft 365 Copilot chat does not directly spawn a local stdio process; GKE must be attached through a declarative agent/Copilot Studio agent and a reachable Streamable HTTP endpoint.
19. Add a compatibility matrix covering:
   - Claude Code: local stdio
   - Codex: local stdio
   - Gemini CLI: local stdio
   - GitHub Copilot IDE/CLI/app: local or remote depending on host
   - Copilot Studio: remote Streamable HTTP
   - Microsoft 365 Copilot declarative agent: remote MCP action
20. Add a remote smoke test that performs initialize → tools/list → `kb.search` and confirms parity with stdio.

## 6. Technical Constraints
1. Implement the remote citation, one-workspace-per-process, runtime-data, and MCP endpoint contracts from `docs/workspace-data-architecture.md`.
2. Reuse the catalog profiles, output schemas, annotations, resources, and schema-budget tests established by MCP Core Modernization.
3. Follow Microsoft’s current requirement that Copilot Studio MCP connections use Streamable HTTP; do not build new SSE support.
4. Keep provider-specific configuration outside the grounding and decision-domain code.
5. Prefer the official Model Context Protocol TypeScript SDK for Streamable HTTP transport unless compatibility testing proves it cannot preserve current behavior.
6. Do not bind a public server to all interfaces by default. Local development should use loopback.
7. Production examples must require HTTPS and authentication.
8. The hosted process can access only data mounted or synchronized into its workspace. It cannot magically read files remaining solely on a user laptop.
9. Preserve local-first positioning by documenting two deployment modes:
   - Private self-hosted gateway reachable through an organization-controlled network/tunnel
   - Opt-in hosted workspace containing deliberately synchronized data
10. Do not recommend temporary public tunnels for sensitive production use.
11. Remote write tools must be separately allowlisted; authentication alone is not sufficient authorization.
12. Keep all existing sanitization, citation, strict-grounding, SLO, and write-gate behavior.

## 7. Implementation Notes
1. Suggested structure:
   - `tools/kb-mcp-server/app.ts` — shared tools, dispatch, and payload shaping
   - `tools/kb-mcp-server/server-stdio.ts` — existing stdio entry
   - `tools/kb-mcp-server/server-http.ts` — Streamable HTTP entry
   - `tools/kb-mcp-server/auth.ts`
   - `tools/kb-mcp-server/http-integration-test.ts`
2. Keep `tools/kb-mcp-server/server.ts` as a compatibility entry or migrate callers atomically.
3. Start with one configured workspace per HTTP process. Do not route arbitrary workspace IDs supplied by the model.
4. Add remote-safe citation aliases such as `kb/topics/example.md` rather than absolute filesystem locations.
5. Add rate limiting and body limits before exposing the endpoint outside loopback.
6. Add a Dockerfile or deployment example only after the local HTTP integration test is green.
7. The Microsoft 365 sample should live under `examples/microsoft-365-copilot-agent/`; Copilot Studio onboarding can live under `docs/integrations/`.
8. The GitHub Copilot adapter should reuse the same local command, `tsx`, server path, environment, and write controls already generated for other clients.
9. Test tool discovery because Copilot Studio dynamically consumes tool names, descriptions, and schemas.
10. Current server resources and prompts are empty. Do not add them merely for marketing; tools are sufficient for the first compatibility milestone.
11. Official references verified on 2026-06-21:
   - Microsoft Copilot Studio MCP overview: https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp
   - Copilot Studio existing-server onboarding and Streamable HTTP requirement: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
   - Microsoft 365 Copilot declarative-agent MCP guide: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins
   - GitHub Copilot MCP support: https://docs.github.com/en/copilot/concepts/context/mcp

## 8. Test Requirements
1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `No dedicated lint script exists today; record lint as N/A unless the implementation adds one.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm run smoke:mcp && npm run test:mcp:http && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria
1. Existing Claude, Codex, and Gemini stdio configurations continue to work unchanged.
2. The HTTP smoke test completes MCP initialization, discovers the same tool schemas, and executes a grounded read.
3. Copilot Studio can connect to a deployed test endpoint through Streamable HTTP and discover GKE tools.
4. A Microsoft 365 declarative-agent sample can invoke a read-only GKE tool through its MCP action.
5. GitHub Copilot setup instructions connect to the same local GKE server without a provider-specific fork.
6. Unauthenticated requests, invalid API keys, oversized requests, and attempts to use disabled write tools are rejected.
7. Remote responses contain workspace-relative citations and never expose absolute host paths.
8. Documentation accurately explains local versus remote deployment and does not imply that Microsoft 365 Copilot can launch the local stdio server directly.

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
  1. The first Microsoft integration target is a custom Copilot Studio or Microsoft 365 declarative agent, not the unextended consumer chat surface.
  2. A private authenticated endpoint is acceptable for an enterprise pilot.
  3. GitHub Copilot local MCP support can reuse GKE’s current stdio process.
- Open questions:
  1. Which deployment example best supports the portfolio story: Azure Container Apps, Cloudflare Workers plus storage, or a private local gateway?
  2. Should API-key authentication ship publicly, or should the first published remote example wait for OAuth/OIDC?
  3. Which Microsoft tenant and licensing path will be available for an end-to-end demo?
