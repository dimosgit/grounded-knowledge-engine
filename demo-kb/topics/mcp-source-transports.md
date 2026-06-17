---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, transports, source-docs
source: modelcontextprotocol/docs/docs/concepts/transports.mdx
---

# MCP Source Notes: Transports

The transport layer carries messages between client and server and converts them
to and from the JSON-RPC 2.0 wire format. JSON-RPC defines three message types:
requests (carry an `id` and `method`), responses (carry the matching `id` and a
result or error), and notifications (no `id`).

Two transports are built in:
- **stdio** communicates over standard input/output streams — the natural fit for
  command-line tools and local process integrations.
- **HTTP with SSE** streams server-to-client over Server-Sent Events while the
  client posts requests over HTTP — suited to networked or restricted-network
  setups.

Custom transports can be implemented against the same interface for specialized
protocols or performance needs.
