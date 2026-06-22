# Feature Prompt Template

## 1. Feature Title
`Local MCP HTTP Bridge — Temporary Microsoft 365 Copilot Tunnel and GitHub Copilot Compatibility`

## 2. Objective
Expose GKE’s provider-neutral tools from the user's local machine through a secure Streamable HTTP MCP endpoint while preserving the current local `stdio` server. For the first milestone, publish the loopback endpoint temporarily through an authenticated tunnel such as ngrok so Microsoft Copilot Studio or a Microsoft 365 declarative agent can be tested without permanent hosting. The proof of concept must be opt-in, workspace-scoped, read-only, short-lived, and limited to sanitized or explicitly approved data.

## 3. Context
- Product area: `MCP transport, deployment, authentication, setup adapters, and enterprise integration`
- Current behavior: `GKE runs as a local newline-delimited JSON stdio MCP server and configures Claude Code, Codex, and Gemini CLI. GitHub Copilot clients support local MCP servers, but GKE has no generated adapter for them. Microsoft Copilot Studio and Microsoft 365 Copilot MCP integrations require a reachable Streamable HTTP server URL, which the current stdio-only process does not provide.`
- Problem to solve: `Microsoft 365 Copilot is the user's go-to company tool and can be tested immediately with real colleagues, but the user does not want permanent deployment or synchronized hosted knowledge. GKE therefore needs a safe local proof-of-concept path that temporarily exposes only approved read-only capabilities.`
- Normative data contract: [`docs/workspace-data-architecture.md`](../workspace-data-architecture.md)

## 4. Scope
- In scope:
  1. Refactor the existing MCP domain/tool handling so it can be hosted by both stdio and Streamable HTTP transports.
  2. Add an opt-in loopback-only Streamable HTTP endpoint, default `/mcp`.
  3. Add API-key authentication for the first tunnel milestone and define OAuth/OIDC as a production follow-up.
4. Enforce one workspace identity and policy per exposed endpoint.
  5. Add setup/documentation for GitHub Copilot local use.
  6. Add a short-lived ngrok-compatible tunnel workflow, Microsoft Copilot Studio onboarding guide, and Microsoft 365 declarative-agent example.
  7. Add transport parity, authentication, tunnel-safety, and write-denial tests.
- Out of scope:
  1. Exposing a user’s unrestricted filesystem to a hosted service.
  2. Permanent hosted deployment or a public multi-tenant SaaS.
  3. Remote writes in the first milestone.
  4. Synchronizing Microsoft Graph, Teams, Outlook, or SharePoint content in this feature.
  5. Interactive Microsoft 365 Copilot widgets in the first release.
  6. Replacing the local stdio server.
  7. Exposing internal company data without explicit organizational approval.

## 5. Requirements
1. Extract tool definitions and handlers from transport-specific code into a shared MCP application layer.
2. Preserve all existing stdio behavior and tests.
3. Add a Streamable HTTP server that:
   - Accepts MCP requests at `/mcp`
   - Provides `/healthz`
   - Uses HTTPS in every non-local environment
   - Applies request-size, timeout, and concurrency limits
4. Support stateless operation where possible. If session state is required by the selected MCP SDK/transport, bind it to authenticated workspace identity and expire it.
5. Force tunnel operation to read-only, regardless of local defaults.
6. Do not advertise or execute mutation tools through the first tunnel milestone.
7. Treat remote writes as a separate future feature requiring explicit authorization design; authentication alone is insufficient.
8. Add API-key authentication for v1 with constant-time comparison and secret loading from environment/secret store.
9. Define, but do not necessarily implement in v1, OAuth 2.0/OIDC suitable for individual-user authorization in Copilot Studio.
10. Integrate the Workspace Vault policy object so the endpoint cannot access data outside its configured workspace.
11. Return sanitized citations. Do not reveal absolute host filesystem paths to remote clients.
12. Add CORS and origin policy only where required; do not use permissive `*` with credentials.
13. Add structured security logs without document bodies or raw secrets.
14. Add `npm run dev:mcp:http` for loopback testing and a documented tunnel command that prints the temporary public URL without persisting it in repository configuration.
15. Add `npm run setup:mcp -- --client github-copilot` or a documented equivalent for supported GitHub Copilot local clients.
16. Add a sample Microsoft Copilot Studio configuration describing:
   - Server URL
   - Streamable HTTP transport
   - API-key or OAuth setup
   - Generative orchestration requirement
   - Read-only recommended tools
   - Short-lived tunnel limitations and data-handling warning
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
21. Require a dedicated sanitized demo workspace by default. Using internal company data requires explicit company approval and must not be the documented public example.
22. Document that tunnel traffic and MCP responses pass through Microsoft and the tunnel provider even though canonical files and the GKE process remain local.
23. Add a local GitHub Copilot adapter independently of the tunnel so GitHub Copilot can use the existing stdio server directly.

## 6. Technical Constraints
1. Implement the remote citation, one-workspace-per-process, runtime-data, and MCP endpoint contracts from `docs/workspace-data-architecture.md`.
2. Reuse the catalog profiles, output schemas, annotations, resources, and schema-budget tests established by MCP Core Modernization.
3. Follow Microsoft’s current requirement that Copilot Studio MCP connections use Streamable HTTP; do not build new SSE support.
4. Keep provider-specific configuration outside the grounding and decision-domain code.
5. Prefer the official Model Context Protocol TypeScript SDK for Streamable HTTP transport unless compatibility testing proves it cannot preserve current behavior.
6. Bind the HTTP server to loopback only. Let the approved tunnel client provide the external HTTPS endpoint.
7. Every tunnel example must require HTTPS, API-key authentication, a short lifetime, and explicit shutdown instructions.
8. The local process reads only the selected local workspace. However, evidence returned to Microsoft traverses Microsoft and the tunnel provider and must be treated as externally disclosed data.
9. Preserve local-first positioning as: local files and local execution by default, with an optional temporary gateway for approved enterprise-agent experiments.
10. Do not recommend temporary public tunnels for sensitive production use or as the permanent enterprise architecture.
11. Do not expose remote write tools in the first milestone. Any future remote-write release must separately allowlist them; authentication alone is not sufficient authorization.
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
6. Do not add a Dockerfile or permanent deployment example in the proof-of-concept milestone.
7. The Microsoft 365 sample should live under `examples/microsoft-365-copilot-agent/`; Copilot Studio onboarding can live under `docs/integrations/`.
8. The GitHub Copilot adapter should reuse the same local command, `tsx`, server path, environment, and write controls already generated for other clients.
9. Test tool discovery because Copilot Studio dynamically consumes tool names, descriptions, and schemas.
10. Reuse the existing MCP resources and semantic catalog; do not expand the tool surface merely for Microsoft compatibility.
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
3. Copilot Studio can connect through a short-lived authenticated tunnel to the local Streamable HTTP endpoint and discover only read-safe GKE capabilities.
4. A Microsoft 365 declarative-agent sample can invoke a read-only GKE capability against the sanitized local demo workspace.
5. GitHub Copilot setup instructions connect to the same local GKE server without a provider-specific fork.
6. Unauthenticated requests, invalid API keys, oversized requests, expired/stopped tunnel access, and attempts to use write tools are rejected.
7. Remote responses contain workspace-relative citations and never expose absolute host paths.
8. Documentation accurately explains local `stdio` versus temporary tunnel exposure and does not imply that Microsoft 365 Copilot can launch the local stdio server directly.

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
  2. A short-lived authenticated tunnel to a loopback-only local endpoint is acceptable for a controlled proof of concept.
  3. GitHub Copilot local MCP support can reuse GKE’s current stdio process.
- Open questions:
  1. Does company policy permit ngrok or require an approved alternative tunnel?
  2. Which Microsoft tenant, licensing path, and administrative approval are available for the end-to-end demo?
  3. After colleague testing, is the value high enough to justify an organization-controlled permanent gateway and OAuth/OIDC?

## 13. Review
**Roast by Antigravity Reviewer:**
This is cool in theory, but is Microsoft Copilot Studio integration really a priority right now? Adding HTTP and auth on top of a local stdio tool is a massive scope creep. Feasibility is medium-to-hard because of the deployment complexities, network boundaries, and auth. It's a nice enterprise portfolio piece but probably shouldn't block the core local-first value. Definitely the lowest priority of the three.

## 14. Claude Reviewer — Roast & Feasibility

**Verdict: DEFER. Highest effort, highest risk, lowest demonstrable payoff — and it actively fights the local-first thesis it claims to preserve.**

### The plan contradicts the product's one good story

The entire pitch of GKE is "your Markdown, your machine, your control." This feature's own Technical Constraint 8 admits the fatal tension: *"The hosted process can access only data mounted or synchronized into its workspace. It cannot magically read files remaining solely on a user laptop."* So to demo M365 Copilot reading "the same memory," you must **copy the knowledge to a server**. The moment you do that, the local-first proof is gone and you've become the SaaS the product explicitly says it isn't (Context §24 of the eval spec). Constraint 9 ("document two deployment modes") is hand-waving past this: both modes require the data to leave the laptop. You can't have "local-first" and "Copilot reads it remotely" in the same 30-second demo.

### "Extract a shared app layer" is a refactor of 2,685 hand-rolled lines

Requirement 1 and Implementation Note 1 assume a clean transport-agnostic core exists to lift out. It doesn't. `server.ts` is **2,685 lines** of hand-rolled newline-delimited JSON-RPC (`process.stdin.on("data"...)` at line 396, manual framing detection at line 410, `dispatchMessage`/`handleRequest`/`handleToolCall` all bespoke) — and it advertises protocol `2024-11-05`. The plan then says (Constraint 5) "prefer the official MCP TypeScript SDK for Streamable HTTP." So you'd run a **hand-rolled old-protocol stdio server next to an SDK-based newer-protocol HTTP server** and then write "transport parity" tests (Req 20, Acceptance #2) across two fundamentally different implementations and protocol versions. That parity surface is where this feature goes to die. Either rebuild stdio on the SDK too (large, risks the working server) or accept permanent drift between transports.

### You cannot actually run the headline demo

Open question 3 — "which Microsoft tenant and licensing path will be available?" — is not an open question, it's a blocker. Copilot Studio / M365 declarative agents need a tenant with the right licensing. For a public portfolio artifact, a hiring manager **cannot click and see this work**; at best they see a screenshot and a config sample. The hiring strategy explicitly wants one-click proof. This feature delivers a compatibility *matrix* (Req 19) and a *guide* (Req 16) — documentation of an integration most viewers can't reproduce. That's a badge, not a proof.

### What's genuinely cheap and worth keeping

One sliver is nearly free and real: **the GitHub Copilot adapter** (Req 15, Implementation Note 8) reuses the existing local stdio command — no HTTP, no auth, no deployment. That's a one-evening `configure-mcp.mjs` addition that legitimately widens "same memory, more agents." Pull it out of this plan and fold it into the Project Context milestone.

### Scores (1–5; complexity/risk: 5 = worst)

| Dimension | Score | Why |
|---|---|---|
| User pain solved | 2 | Few target users live in Copilot Studio; the GitHub Copilot slice is the only broad win. |
| Differentiation | 2 | "MCP over HTTP with API keys" is commodity; everyone is shipping this in 2026. |
| Portfolio/hiring signal | 3 | "Enterprise integration" reads on CV-D, but only if it actually runs — and it mostly won't. |
| Architectural necessity | 1 | Nothing else depends on it; it depends on Workspace Vaults (Constraint 10). |
| Demo clarity | 2 | Requires a tenant, a deployed host, and synced data. The opposite of a 30s click. |
| Implementation complexity | 5 | Transport refactor + auth + deployment + Microsoft onboarding + parity tests. |
| Security/operational risk | 5 | First time GKE is internet-reachable and writes are possible remotely. Whole new threat model. |

### MVP / Follow-up / Cut

- **Essential MVP (do now, outside this plan):** the GitHub Copilot **local** adapter only. No HTTP, no auth.
- **Valuable follow-up (someday):** a private self-hosted Streamable HTTP gateway on the SDK, read-only, single workspace, API-key auth — *if and only if* a real client/tenant materializes (Open question 1/3).
- **Cut now:** Copilot Studio onboarding guide, M365 declarative-agent sample, OAuth/OIDC design, compatibility matrix, transport-parity test suite. All of it premature until there's a tenant to run against.

### Effort

GitHub Copilot adapter: ~0.5 day. The full remote gateway as specced: ~12–20 engineer-days plus ongoing ops (low confidence — the parity work and a real Microsoft end-to-end could double it). For a project timeboxed at 15–20 hours total, this single feature is the entire budget, spent on the least visible proof.

**Bottom line:** Take the free GitHub Copilot adapter, ship it with Project Context, and shelve the rest behind a real client need. Building a remote gateway to prove a *local-first* tool is the portfolio equivalent of putting a spoiler on a bicycle.

— *Claude Reviewer*

## 15. Accepted Decisions — 2026-06-22

1. Do not permanently deploy GKE or copy the canonical workspace into hosted storage for this milestone.
2. Keep Microsoft 365 Copilot in the active roadmap because it is the user's real workplace tool and can be validated immediately with colleagues.
3. Implement the first Microsoft milestone as:
   - Local loopback-only Streamable HTTP server.
   - Short-lived ngrok-compatible HTTPS tunnel.
   - API-key authentication.
   - One sanitized or explicitly approved workspace.
   - Read-only capabilities only.
   - No remote capture or other writes.
4. Clearly disclose that returned evidence passes through Microsoft and the tunnel provider even though files and execution remain local.
5. Treat the tunnel as a controlled proof of concept, never as production architecture for sensitive data.
6. Add local GitHub Copilot stdio support independently because it is inexpensive and does not require the HTTP/tunnel work.
7. Build this milestone after Project Context Lite and Leakage Guard Lite, because useful project context and enforced workspace boundaries must exist before exposing the local engine through a tunnel.
