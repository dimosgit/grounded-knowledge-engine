---
record_type: term
title: JSON-RPC
track: demo
module: agent-runtime
status: canonical
owner: demo
updated: 2026-06-24
aliases:
  - JSON-RPC 2.0
tags:
  - demo
  - glossary
  - protocol
---

# JSON-RPC

## Definition

The message format underneath MCP. Every request carries an id and a method, every
response answers that id, and notifications are one-way messages without an id.

## Retrieval anchors

- Exact term: JSON-RPC.
- Requests, responses, and notifications.
- MCP messages are JSON-RPC 2.0 objects.

## Related

- [[stdio transport]]
- [[Streamable HTTP]]
- [[Capability negotiation]]
- Concept note: [[mcp-source-transports]]
