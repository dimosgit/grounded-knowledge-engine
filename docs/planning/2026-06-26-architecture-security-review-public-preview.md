# Architecture and Security Review: Public Preview

## 1. Scope

- Application / repository: Grounded Knowledge Engine.
- Review date: 2026-06-26.
- Reviewed layers: root TypeScript engine, local MCP server, ingestion tooling, React Cockpit, Vercel static deployment config, public-release docs, dependency manifests, scrub gate.
- Constraints: GKE remains local-first. `gke.dimouzunov.com` is a static Cockpit preview over sanitized demo content, not a hosted MCP service or hosted user workspace.

## 2. Executive Summary

- Current architecture health: Good for public preview. The core engine remains local-first with clear CLI, MCP, ingestion, project-context, and Cockpit boundaries.
- Current security posture: Good after fixes. Secret scanning passes, production audits are clean, Cockpit dev audits are clean, and the hosted preview now has explicit browser hardening headers.
- Highest-risk items fixed: stale public-preview documentation, missing static-site security headers, Markdown link protocol filtering, Mermaid rendering mode, and vulnerable Node dependency paths.
- Recommended next milestone: deploy the Vercel preview, verify runtime headers at `https://gke.dimouzunov.com`, then run one browser smoke test against the deployed build.

## 3. Current-State Architecture

### 3.1 System Context

- Users and primary workflows: local developers use CLI/MCP tools for grounded retrieval, capture, document ingestion, and project resume; public viewers use the static Cockpit preview to inspect the demo workspace.
- External systems and APIs: npm registry for dependencies; Vercel for static Cockpit hosting. No remote API is required for the public preview.
- Data stores: Markdown source files are canonical; BM25/SQLite indexes, Cockpit synced content, and build output are derived and ignored.

### 3.2 Component Map

- Frontend (React): `apps/cockpit`, built with Vite 8 and deployed as static assets.
- Backend (Python): none.
- Backend/Services (Node.js): local CLI/MCP/ingestion tools under `tools`.
- Infra/Platform: Vercel static hosting via `vercel.json`; local MCP uses stdio, not HTTP.

### 3.3 Key Flows

- Auth flow: none in public preview; local MCP clients are configured by local files.
- Read flow: Cockpit reads pre-synced Markdown content; engine tools read local Markdown and derived indexes.
- Write flow: MCP writes are disabled unless explicitly enabled locally; Cockpit lane write-back is dev-only and skipped in production.
- Background jobs/events: none in hosted preview.

## 4. Architecture Findings

- ID: A-001
  - Category: Product boundary clarity
  - Evidence: README, app README, SECURITY, architecture docs, and copy manifest previously described the Cockpit as local-only or had stale release placeholders.
  - Impact: Public viewers could confuse a static demo frontend with a hosted knowledge engine.
  - Recommendation: Fixed. Docs now say `gke.dimouzunov.com` is static, demo-only, and does not expose MCP, write tools, indexes, or private workspaces.

- ID: A-002
  - Category: Build-tool compatibility
  - Evidence: Vite 8 rejected object-form `manualChunks` in `apps/cockpit/vite.config.ts`.
  - Impact: Public preview deployment would fail after dependency hardening.
  - Recommendation: Fixed. `manualChunks` now uses the function form accepted by Vite 8 / Rolldown.

## 5. Security Findings

- ID: S-001
  - Severity: Medium
  - Attack scenario: A public static frontend without browser hardening headers has weaker defense-in-depth for XSS, clickjacking, MIME confusion, and referrer leakage.
  - Evidence: `vercel.json` had no `headers` block.
  - Recommendation: Fixed. Added CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.

- ID: S-002
  - Severity: Medium
  - Attack scenario: A malicious committed Markdown link or Mermaid diagram could attempt unsafe browser behavior if rendered too permissively.
  - Evidence: `MarkdownArticle.tsx` previously rendered arbitrary non-internal links directly and initialized Mermaid with `securityLevel: "loose"`.
  - Recommendation: Fixed. Added protocol filtering for rendered Markdown links and switched Mermaid to strict security mode.

- ID: S-003
  - Severity: Medium
  - Attack scenario: Public dependency manifests with known advisories reduce trust and can expose dev-server or transitive package risk.
  - Evidence: root `npm audit` flagged `uuid` through `exceljs`; Cockpit audit flagged `shell-quote` through `concurrently` and Vite/esbuild.
  - Recommendation: Fixed. Root uses a `uuid` override; Cockpit uses `concurrently@9.2.3`, `shell-quote@1.8.4`, `vite@8.1.0`, `@vitejs/plugin-react@6.0.3`, and `esbuild@0.28.1`.

- ID: S-004
  - Severity: Low
  - Attack scenario: A release scrub gate can fail on intentional public maintainer metadata and train maintainers to bypass it.
  - Evidence: `scripts/scrub-gate.sh` blocked the requested `gke.dimouzunov.com` domain.
  - Recommendation: Fixed. The gate now focuses on client/private-workspace leakage while allowing intentional public maintainer metadata.

## 6. Improvement Proposals

- Proposal ID and title: P1 Runtime Header Verification
  - Problem statement: Static hosting headers are configured in repo but should be verified after DNS/deployment.
  - Target state: `https://gke.dimouzunov.com` returns the configured CSP and hardening headers.
  - Implementation steps: deploy preview, run `curl -I https://gke.dimouzunov.com`, confirm CSP, frame, content-type, referrer, and permissions headers.
  - Dependencies: DNS and Vercel deployment.
  - Tradeoffs: None.
  - Priority: P1.
  - Impact: Confirms production hardening is actually active.
  - Effort: Small.
  - Success metrics: headers match `vercel.json`.
  - Verification checks: deployed page loads and headers are present.

- Proposal ID and title: P2 Browser Smoke Test
  - Problem statement: Local build passes, but deployed asset paths and SPA rewrites should be checked in the hosted environment.
  - Target state: hub, library, project board, project detail, graph, Markdown links, and Mermaid diagrams work from the public domain.
  - Implementation steps: open deployed domain, navigate key hash routes, verify no console errors and no missing assets.
  - Dependencies: deployed static preview.
  - Tradeoffs: Manual check is acceptable for first public preview; automate later if preview becomes release-critical.
  - Priority: P2.
  - Impact: Reduces launch-day embarrassment risk.
  - Effort: Small.
  - Success metrics: key routes render without console errors.
  - Verification checks: browser smoke notes attached to release issue or commit.

## 7. Rollout Plan

- Phase 1 (0-2 weeks): deploy static Cockpit preview, verify headers, run browser smoke, share README link.
- Phase 2 (2-6 weeks): add CI header/dependency/scrub verification for PRs, if this repo becomes an ongoing public artifact.
- Phase 3 (6+ weeks): consider automated deployed-preview checks after each Vercel deployment.

## 8. Open Questions and Assumptions

- Open questions: none blocking public preview.
- Assumptions: `gke.dimouzunov.com` will point at the Vercel project configured by this repository, and the public preview intentionally serves only sanitized repository demo content.

## Verification Run

- `npm run typecheck`
- `npm run build`
- `npm run test:gke`
- `npm audit --audit-level=moderate`
- `npm --prefix apps/cockpit audit --audit-level=moderate`
- `npm --prefix apps/cockpit run typecheck`
- `npm --prefix apps/cockpit run test`
- `npm --prefix apps/cockpit run build`
- `npm run scrub`
