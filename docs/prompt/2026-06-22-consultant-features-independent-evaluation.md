# Feature Prompt Template

## 1. Feature Title
`Independent Product and Architecture Evaluation — Three Consultant Features for Grounded Knowledge Engine`

## 2. Objective
Independently evaluate the three proposed consultant-focused features for Grounded Knowledge Engine (GKE): Project Context API, Workspace Vaults and Leakage Guard, and Remote MCP Gateway for Microsoft/GitHub Copilot. Determine whether they are the right next product investments, whether their proposed architecture and delivery order are sound, and how much of each should actually be built for a compelling public portfolio artifact.

Do not implement the features during this task. Produce a candid, evidence-based recommendation that distinguishes product value, portfolio value, technical necessity, and attractive but premature scope.

## 3. Context
- Product area: `Local-first grounded knowledge, project memory, MCP interoperability, consultant workflows, and public engineering portfolio`
- Public repository to evaluate: the current repository root.
- Optional production-like reference implementation: a larger local installation supplied separately to the evaluator and never quoted in the public report.
- Current behavior: `GKE indexes Markdown, retrieves cited evidence through BM25 or SQLite, ingests PDF/DOCX/XLSX/Markdown, captures useful knowledge back into Markdown, and exposes the same provider-neutral MCP server to Claude Code, Codex, and Gemini CLI. An optional React Operator Cockpit already derives project boards, project detail, quick recall, blockers, open questions, and next actions from Markdown.`
- Problem to solve: `A consultant or technical user moves between projects, clients, devices, and AI agents. They need fast project resumption, hard protection against cross-client leakage, and access from the agent surface their environment permits. The proposed features attempt to turn the existing local grounding engine into that trusted working environment.`

### Product thesis

GKE is intended to be a provider-neutral memory and grounding layer:

> Keep understandable Markdown under the user's control, let multiple agents retrieve the same cited context, and capture durable knowledge so later sessions do not repeat the same investigation.

It is not intended to become a generic document-management SaaS, a replacement for Jira/Linear, or a provider-specific Claude/Copilot extension.

### Current implemented baseline

Inspect the code before judging the plans. Important implemented capabilities include:

1. Provider-neutral local MCP setup for Claude Code, Codex, and Gemini CLI:
   - `scripts/configure-mcp.mjs`
   - `tools/kb-mcp-server/server.ts`
   - `tools/kb-mcp-server/catalog.ts`
2. Small MCP profiles:
   - Default `core`: `kb.search`, `kb.get_record`, `kb.answer_and_capture`
   - `full`: administrative capabilities and compatibility aliases
3. Formal MCP output schemas, safety annotations, schema-size budgets, and addressable `gke://` resources.
4. Local document ingestion for PDF, DOCX, XLSX, Markdown, and text:
   - `tools/ingest/`
   - `docs/document-ingestion-plan.md`
5. Deterministic retrieval and evaluation:
   - `tools/grounding/`
6. Existing Operator Cockpit:
   - `apps/cockpit/`
7. End-to-end grounding loop:
   - ingest/search → grounded answer with citations → capture → retrieve captured knowledge in a fresh query.

The MCP Core Modernization prerequisite is already implemented. Review its original plan and compare it with the current code:

- `docs/prompt/2026-06-21-mcp-core-modernization.md`

Current public-repository history relevant to this evaluation:

- `188a230 feat(mcp): modernize core catalog and plan consultant features`
- `439f868 docs: keep consultant plans release-safe`

### The three proposals under evaluation

#### Proposal 1: Project Context API

Goal: Promote project intelligence that currently exists mainly in the Cockpit into a deterministic core-engine contract available to every MCP client.

Proposed capabilities:

- Canonical `project_id` and project manifest.
- Explicit project-scoped retrieval before ranking.
- `kb.get_project_context`.
- `kb.resume_project`.
- Append-only `kb.checkpoint_project`.
- Audience-specific `kb.create_handoff`.
- Equivalent facts and citations in the Cockpit and MCP.
- Compact personal-resume and colleague/client handoff capsules.

Important nuance: this is not simply “show the project and quick glance.” The Cockpit already has a useful presentation, but the project model is not yet a first-class shared core contract. Today, another MCP client cannot reliably request the same structured project state or export a deterministic handoff.

Full plan:

- `docs/prompt/2026-06-21-project-context-api.md`

#### Proposal 2: Workspace Vaults and Leakage Guard

Goal: Make one client, employer, or personal workspace a hard physical trust boundary rather than a soft tag/filter.

Proposed capabilities:

- One immutable workspace context per MCP process.
- Separate workspace roots and separately named MCP entries.
- Read/write-root enforcement using normalized real paths.
- Protection against traversal and symlink escapes.
- Read-only defaults and sensitivity labels.
- Workspace identity in every structured response and in Cockpit chrome.
- Privacy-safe append-only audit events.
- No cross-workspace/global client search.

The central design claim to challenge is:

> A workspace is a physical trust boundary; a project is a logical context boundary.

Full plan:

- `docs/prompt/2026-06-21-workspace-vaults-leakage-guard.md`

#### Proposal 3: Remote MCP Gateway

Goal: Preserve local `stdio` MCP while exposing the same application layer through authenticated Streamable HTTP for Microsoft Copilot Studio, Microsoft 365 declarative agents, and remote-capable clients.

Proposed capabilities:

- Shared transport-independent MCP application layer.
- Existing local `stdio` retained.
- Authenticated `/mcp` Streamable HTTP endpoint.
- Remote read-only default.
- One workspace per endpoint/process.
- Workspace-relative citations with no host paths.
- Local GitHub Copilot adapter.
- Copilot Studio onboarding example.
- Microsoft 365 declarative-agent example.
- Transport-parity, authentication, and write-denial tests.

Important constraint: ordinary Microsoft 365 Copilot chat cannot directly spawn a local `stdio` process. The proposed Microsoft path requires a declarative/Copilot Studio agent and a reachable remote MCP endpoint.

Full plan:

- `docs/prompt/2026-06-21-remote-mcp-microsoft-copilot.md`

Because Microsoft and GitHub integration requirements change, re-verify the plan against current official documentation as of the evaluation date. Prefer primary sources:

- Microsoft Copilot Studio MCP overview: `https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp`
- Copilot Studio existing MCP server onboarding: `https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent`
- Microsoft 365 declarative-agent MCP guide: `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins`
- GitHub Copilot MCP documentation: `https://docs.github.com/en/copilot/concepts/context/mcp`

### Shared architecture

All three proposals are governed by:

- `docs/workspace-data-architecture.md`
- `docs/prompt/2026-06-21-consultant-features-roadmap.md`

The intended model is:

- Workspace = physical trust boundary.
- Project = logical context boundary.
- Checkpoint = progress history.
- Decision = reasoning history.
- Source = evidence and provenance.
- Topic/term = reusable knowledge.
- Markdown under `kb/` = canonical.
- `.cache/` = disposable derived indexes.
- `.gke/` = local operational policy/audit state.
- One MCP process or remote endpoint = one immutable workspace.
- Project and workspace scope must be applied before retrieval/ranking.

Decision Replay is a planned adjacent feature, but it is not one of the three consultant-foundation proposals:

- `docs/prompt/2026-06-21-decision-replay.md`

Use Decision Replay as a challenger when judging prioritization: would it deliver more distinctive user and portfolio value than one of the proposed three?

### Hiring and portfolio context

This public repository is intended to become the first Featured artifact on LinkedIn and evidence for applications. The hiring strategy explicitly says the artifact should prove AI-assisted delivery/project-memory claims with one click.

Optional hiring materials may be supplied separately to the evaluator and must
not be copied into this repository. They include:

- Referral-first hiring strategy.
- Execution playbook.
- CV A — primary Senior Product Engineer positioning.
- CV B — Principal Full-Stack Engineer.
- CV C — AI Product Engineer.
- CV D — Forward Deployed Engineer.

Relevant positioning:

- Primary identity: Senior Product Engineer / Principal Full-Stack Engineer.
- Supporting lanes: AI Product Engineer and Forward Deployed Engineer.
- Core proof themes:
  - Product engineering from discovery to production.
  - Full-stack TypeScript/React/Node.js.
  - Internal tools, automation, APIs, and integrations.
  - AI-assisted project-memory workflows.
  - Operational B2B software and enterprise-grade boundaries.
- The public artifact must translate enterprise-platform experience into modern product-engineering evidence rather than lead with a vendor-specific identity.
- The hiring strategy originally timeboxed the project-memory repository to roughly 15–20 hours over 3–4 weeks. The repository has already grown beyond a tiny template, so evaluate whether the new roadmap sharpens the proof or becomes portfolio-diluting overbuild.
- The desired proof is not “many features.” It is a clear, defensible story that a hiring manager can understand quickly.

Evaluate which proposed feature most strengthens each CV variant:

- CV A: product judgment, UX, end-to-end ownership.
- CV B: architecture, secure boundaries, typed contracts, test rigor.
- CV C: durable agent memory, grounding, multi-agent interoperability.
- CV D: client switching, handoff, deployment, enterprise integration.

Do not recommend exposing employer, client, or domain-specific private knowledge
in the public repository. A larger local installation may be inspected only as
evidence that the engine works with a production-like knowledge base and
domain-specific extensions.

## 4. Scope
- In scope:
  1. Inspect the implemented public repository and verify that each proposal builds on real existing capabilities.
  2. Evaluate each feature's user value, technical coherence, complexity, security implications, differentiation, and public-demo value.
  3. Challenge the shared data architecture, especially workspace/project boundaries and the one-workspace-per-process decision.
  4. Identify assumptions that are unsupported, redundant, or unnecessarily complex.
  5. Propose the smallest credible MVP for each feature.
  6. Recommend sequencing and identify which work can be postponed.
  7. Compare the three features with Decision Replay as an alternative investment.
  8. Evaluate the roadmap as a LinkedIn Featured/public hiring artifact against the supplied hiring strategy and CV positioning.
  9. Recommend one coherent demo story and one concise positioning sentence.
- Out of scope:
  1. Implementing or editing any feature.
  2. Committing or pushing repository changes.
  3. Rewriting the CVs or hiring strategy.
  4. Evaluating private employer or client content for public release.
  5. Designing a full multi-tenant SaaS.
  6. Treating every planned requirement as mandatory merely because it is documented.

## 5. Requirements
1. Begin by reading the following in order:
   - `readme.md`
   - `docs/architecture.md`
   - `docs/prompt/2026-06-21-mcp-core-modernization.md`
   - `docs/prompt/2026-06-21-consultant-features-roadmap.md`
   - `docs/workspace-data-architecture.md`
   - The three feature plans.
2. Inspect the actual MCP, grounding, ingestion, setup, and Cockpit code. Flag any plan statement that assumes a capability not present in code.
3. Give each feature a 1–5 score for:
   - User pain solved
   - Differentiation
   - Portfolio/hiring signal
   - Architectural necessity
   - Demo clarity
   - Implementation complexity, where `5` means very complex
   - Security/operational risk, where `5` means high risk
4. For every score, provide a short reason grounded in the repository or supplied strategy.
5. For each feature, separate:
   - Essential MVP
   - Valuable follow-up
   - Premature or removable scope
6. Estimate implementation effort in engineer-days or focused work weeks. State assumptions and confidence; do not present estimates as precise facts.
7. Identify dependencies and determine whether the proposed order—Project Context, Workspace Vaults, Remote MCP—is optimal.
8. Explicitly answer:
   - Is Project Context API genuinely new core value, or mostly a refactor of the Cockpit?
   - Are separate processes/workspaces the right leakage boundary, or is this too heavy for the target user?
   - Does remote Microsoft Copilot support strengthen the product now, or distract from the local-first proof?
   - Should Decision Replay displace one of the three in the near-term roadmap?
   - Which single feature would produce the strongest 30–60 second demo?
   - Which combination would be strongest in a technical interview?
9. Assess whether the shared Markdown schema is sufficient for projects, checkpoints, decisions, and sources. Identify fields or relationships that are missing or over-modeled.
10. Challenge MCP tool growth. Recommend the smallest semantic tool surface and whether some proposed operations should be resources, prompts, CLI commands, or Cockpit actions instead.
11. Assess token/context efficiency:
   - Expected default capsule size
   - Risk of verbose tool schemas
   - Whether resources and compact structured outputs are used appropriately
12. Assess privacy and deployment:
   - Local threat model
   - Remote threat model
   - Path/symlink and accidental-capture risks
   - Whether audit logging is justified in v1
   - Whether API-key authentication is acceptable for a public example
13. Evaluate portfolio fit against the hiring strategy:
   - Does the roadmap communicate Senior Product Engineer judgment?
   - Does it prove AI-assisted delivery without looking like an AI wrapper?
   - Is the scope credible for one engineer?
   - What should a hiring manager see in the first 60 seconds?
14. Conclude with one of these recommendations:
   - Build all three in the proposed order.
   - Build all three in a revised order/scope.
   - Build only a subset now.
   - Replace one proposal with Decision Replay or another clearly justified feature.
15. Be candid. Prefer deletion and sequencing over vague approval.

## 6. Technical Constraints
1. Treat `docs/workspace-data-architecture.md` as the current proposed contract, not unquestionable truth.
2. Preserve these established product constraints unless arguing explicitly for a change:
   - Markdown remains canonical.
   - Retrieval indexes remain derived.
   - The deterministic CLI/core remains independent from MCP providers.
   - Local `stdio` workflows remain functional.
   - Writes remain explicit and gated.
   - Public examples contain no private employer or client data.
3. Do not propose provider-specific forks of the grounding engine.
4. Do not assume semantic filtering is an adequate security boundary.
5. Do not assume a remote process can access files that remain only on the user's laptop.
6. Verify current Microsoft/GitHub MCP claims from official sources before relying on them.
7. Distinguish:
   - Logical project scope
   - Filesystem workspace isolation
   - Remote authentication
   - Authorization for writes
8. Treat catalog/token budgets as an architectural requirement, not cosmetic optimization.
9. Recommendations must preserve or improve testability.

## 7. Implementation Notes
1. This is a read-only evaluation task. Do not modify repository files.
2. Useful public-repository paths:
   - MCP catalog: `tools/kb-mcp-server/catalog.ts`
   - MCP server: `tools/kb-mcp-server/server.ts`
   - MCP setup: `scripts/configure-mcp.mjs`
   - MCP tests: `tools/kb-mcp-server/schema-budget-test.ts`, `smoke-test.ts`, `loop-integration-test.ts`
   - Retrieval: `tools/grounding/retriever.ts`, `sqlite-index.ts`
   - Ingestion: `tools/ingest/`
   - Cockpit source: `apps/cockpit/src/`
   - CI: `.github/workflows/ci.yml`
3. Use any separately supplied production-like installation only for contextual
   comparison. Do not quote its paths, organization names, or knowledge.
4. Do not interpret the three feature documents as independent. Evaluate their combined architecture and whether dependencies force unnecessary coupling.
5. Suggested evaluation frame:
   - Product truth: Is the pain frequent and costly?
   - Architecture truth: Does the mechanism actually enforce the promise?
   - Portfolio truth: Can an outsider understand the proof quickly?
   - Delivery truth: Can one engineer finish and polish it?
6. Suggested demo to critique:
   - Open Client Alpha.
   - Resume a project and show cited current context.
   - Export a technical handoff.
   - Attempt to retrieve an identically named Personal Project fact and show it blocked.
   - Retrieve the same Client Alpha context through a Microsoft/GitHub Copilot-compatible endpoint.
7. Consider whether this demo is too long. If so, propose a better 30–60 second version and a longer technical-interview version.

## 8. Test Requirements
1. No code changes are required. Run tests only to validate claims about the current baseline.
2. If the local dependencies are available, run:
   - Lint: `N/A — no dedicated root lint script currently exists.`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
3. Report whether commands were run, skipped, passed, or failed. Do not imply execution if only documentation was inspected.
4. Do not create a commit. If any accidental change occurs, report it and do not commit it.

## 9. Acceptance Criteria
1. The evaluation gives a clear verdict rather than only summarizing the plans.
2. Every feature receives scored, reasoned analysis and an MVP/follow-up/cut breakdown.
3. The report identifies incorrect assumptions or architecture risks found by inspecting the code.
4. The report recommends a delivery order and realistic effort range.
5. The report explicitly judges Decision Replay as a competing priority.
6. The report connects recommendations to CV A/B/C/D and the public LinkedIn Featured artifact.
7. The report defines what should be visible in a 30–60 second public demo.
8. The report names the top three decisions the maintainer should make before implementation.
9. The report contains a concise final recommendation that can guide the next implementation plan.

## 10. Deliverables
1. Executive verdict in no more than 300 words.
2. Comparison table for the three features, including scores and effort estimates.
3. Per-feature analysis with:
   - What is strong
   - What is weak or redundant
   - MVP
   - Follow-up
   - Scope to cut
4. Architecture critique of `docs/workspace-data-architecture.md`.
5. Recommended roadmap for the next three milestones.
6. Public-demo and technical-interview demo recommendations.
7. Portfolio/hiring assessment tied to the supplied strategy and CV variants.
8. Top three decisions requiring maintainer approval.
9. Exact files, tests, and official sources inspected.

## 11. Mandatory Agent Rules
1. Inspect implementation evidence before reaching conclusions.
2. Do not modify, commit, or push repository changes.
3. Do not expose private employer, client, or personal knowledge in the report.
4. Distinguish verified facts, inferences, and recommendations.
5. Re-verify temporally unstable Microsoft/GitHub integration claims using official documentation.
6. Report exact commands executed and whether each passed.
7. Escalate access blockers rather than silently skipping key evidence.

## 12. Assumptions and Open Questions
- Assumptions:
  1. The evaluator has read access to the public repository and any optional context supplied outside it.
  2. This public repository is the intended LinkedIn artifact.
  3. The immediate objective is a polished proof artifact and credible product direction, not maximizing feature count.
  4. One engineer will implement and maintain the near-term roadmap.
  5. Decision Replay remains a proposal and can still replace or follow one of the three features.
- Open questions:
  1. Is Microsoft Copilot integration strategically important because of likely target employers/clients, or mainly attractive as a compatibility badge?
  2. Is the first public audience primarily hiring managers, potential users, or both?
  3. How much implementation time is acceptable before returning focus to the referral-first job-search plan?
  4. Is a remote deployment tenant/license currently available for a real Microsoft end-to-end demo?
  5. Should the strongest public narrative emphasize “resume any project,” “prevent client leakage,” or “use the same memory from any agent”?
