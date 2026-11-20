---
record_type: term
title: Capability negotiation
track: demo
module: agent-runtime
status: canonical
owner: demo
updated: 2026-06-24
aliases:
  - Initialize handshake
  - Capabilities
tags:
  - demo
  - glossary
  - protocol
  - lifecycle
---

# Capability negotiation

## Definition

The opening exchange of every MCP session. The client and server say which features
they support, and neither side uses a feature the other did not announce.

## Retrieval anchors

- Exact term: capability negotiation.
- Happens during initialize.
- Unannounced features stay unused.

## Related

- [[MCP client]]
- [[MCP server]]
- [[JSON-RPC]]
- Concept note: [[mcp-source-architecture]]
