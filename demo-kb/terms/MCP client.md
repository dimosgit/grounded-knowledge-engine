---
record_type: term
title: MCP client
track: demo
module: agent-runtime
status: canonical
owner: demo
updated: 2026-06-24
aliases:
  - Client connection
tags:
  - demo
  - glossary
  - architecture
---

# MCP client

## Definition

The connector inside a host that keeps one dedicated session with one MCP server. It
sends requests, receives results, and reports what the host supports.

## Retrieval anchors

- Exact term: MCP client.
- One client talks to exactly one server.
- Clients announce capabilities such as sampling and roots.

## Related

- [[MCP host]]
- [[MCP server]]
- [[JSON-RPC]]
- [[Root]]
- Concept note: [[mcp-source-architecture]]
