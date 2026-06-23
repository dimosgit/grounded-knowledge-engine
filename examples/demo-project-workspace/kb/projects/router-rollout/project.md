---
schema_version: 1
record_type: project
workspace_id: demo
project_id: router-rollout
title: Router Rollout
status: active
lifecycle: active
owner: demo
track: demo
started_at: 2026-06-10
updated: 2026-06-23
review_after: 2026-07-06
source_roots: kb/sources/router-rollout
tags: mcp, router, rollout, demo
---

# Router Rollout

## Outcome

Ship a local MCP router demonstration that can retrieve, capture, and reuse
grounded project knowledge across agent clients.

## Current focus

Validate the project-resume capsule against the canonical project structure.

## Last meaningful change

The project context became available through both `kb.resume_project` and the
`gke://project/router-rollout/context` resource.

## Delivery checklist

- [x] Expose project resume through `kb.resume_project` [M]
- [x] Publish the project context resource [M]
- [x] Preserve Markdown as canonical project state [S]
- [ ] Validate the project view in the Operator Cockpit [S]
- [ ] Compare the Cockpit and MCP resume facts [M]
- [ ] Export the technical-peer handoff [S]

## Active decisions

- Keep the default MCP profile small and semantic.
- Preserve Markdown as the canonical source of project state.

## Blockers

- The Microsoft tunnel proof remains outside this milestone.

## Open questions

- Which project-resume interaction should lead the public demonstration?

## Next actions

1. Open the project in the Operator Cockpit.
2. Resume it through the MCP tool and compare the facts.
3. Export the technical-peer handoff.

## Key documents

- [Router rollout evidence](../../sources/router-rollout/evidence.md)
- [MCP source architecture](../../topics/mcp-source-architecture.md)
