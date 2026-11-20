---
track: demo
module: agent-runtime
status: canonical
type: howto
owner: demo
updated: 2026-06-24
aliases:
  - Rollback
tags:
  - demo
  - runbook
  - router
---

# Rollback plan

If a demo session misbehaves, return to the last known good state.

1. Stop the client so no further [[Tool call|tool calls]] arrive.
2. Restore the Markdown folder from version control; the index is disposable
   and rebuilds itself.
3. Restart the [[MCP server]] over the [[stdio transport]] and re-run step 1 of
   the [[Rollout checklist]].

Notes are the source of truth, so a rollback never needs a database restore.
