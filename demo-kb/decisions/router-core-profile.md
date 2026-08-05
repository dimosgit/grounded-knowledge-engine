---
schema_version: 1
record_type: decision
workspace_id: demo
decision_id: router-core-profile
project_id: router-rollout
title: Keep the default MCP profile small and semantic.
status: active
owner: demo
decided_at: 2026-06-20
evidence_checked_at: 2026-06-22
review_after: 2026-09-15
confidence: high
updated: 2026-06-22
tags: demo, router, mcp, profile
---

# Keep the Default MCP Profile Small and Semantic

## Decision question

Which capabilities should the public router demonstration expose by default?

## Recommendation

Keep the core profile limited to the semantic operations needed to search,
retrieve, resume, and capture grounded project knowledge.

## Alternatives considered

- Advertise every advanced and write-capable operation by default.
- Use separate demonstrations for retrieval and project resume.

## Rationale

A small default profile makes the demonstration easier to understand and keeps
the primary workflow centered on grounded outcomes instead of tool inventory.

## Assumptions

- Advanced operations remain available through an explicitly selected profile.
- Write tools remain gated by the workspace write policy.

## Risks and caveats

- A compact profile may hide useful advanced operations from first-time users.

## Evidence snapshot

- demo-kb/sources/router-rollout/evidence.md:22 — The router rollout uses the core MCP profile.

## Review history

- None recorded.

## Supersession

- None recorded.
