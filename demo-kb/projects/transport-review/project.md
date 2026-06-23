---
schema_version: 1
record_type: project
workspace_id: demo
project_id: transport-review
title: Transport Review
status: planned
lifecycle: next
owner: demo
track: demo
started_at: 2026-06-18
updated: 2026-06-23
review_after: 2026-07-10
source_roots: kb/sources/transport-review
tags: mcp, transport, rollout, demo
---

# Transport Review

## Outcome

Choose a safe transport approach for a future read-only enterprise-agent
experiment without weakening the local-first product.

## Current focus

Review the deployment checklist for a temporary local HTTP bridge.

## Last meaningful change

The experiment was narrowed to loopback execution and short-lived tunnel access.

## Delivery checklist

- [x] Narrow the experiment to loopback execution [S]
- [x] Keep remote writes disabled [M]
- [ ] Confirm tenant and tunnel prerequisites [M]
- [ ] Validate the read-only transport contract [L]
- [ ] Record the security review outcome [M]

## Active decisions

- Keep remote writes disabled.
- Do not introduce permanent hosting for the proof of concept.

## Blockers

- Tenant and tunnel approval are not yet confirmed.

## Open questions

- Which approved tunnel provider can be used for the experiment?

## Next actions

1. Confirm the tenant prerequisites.
2. Validate the read-only transport contract.
3. Record the security review outcome.

## Key documents

- [Transport review evidence](../../sources/transport-review/evidence.md)
- [MCP source transports](../../topics/mcp-source-transports.md)
