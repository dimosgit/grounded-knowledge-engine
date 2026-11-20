---
record_type: term
title: stdio transport
track: demo
module: agent-runtime
status: canonical
owner: demo
updated: 2026-06-24
aliases:
  - Standard input/output transport
  - stdio
tags:
  - demo
  - glossary
  - transport
---

# stdio transport

## Definition

The default local transport. The client starts the server as a child process and
they exchange newline-delimited JSON-RPC messages over standard input and output.

## Retrieval anchors

- Exact term: stdio transport.
- Local child process, no network port.
- The router demo runs over stdio.

## Related

- [[Streamable HTTP]]
- [[JSON-RPC]]
- [[Tunnel threat model]]
- Concept note: [[mcp-source-transports]]
