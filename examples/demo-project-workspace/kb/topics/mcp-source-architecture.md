---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, architecture, source-docs
source: modelcontextprotocol/docs/docs/concepts/architecture.mdx
---

# MCP Source Notes: Architecture

MCP follows a client-server architecture. Hosts are LLM applications, clients
maintain one-to-one connections inside a host, and servers provide context,
tools, and prompts.

The protocol layer handles message framing, request and response linking, and
notification flow. The transport layer carries messages between client and
server; common transports include stdio for local processes and HTTP/SSE for
networked communication.

JSON-RPC 2.0 is the message exchange format used by the transports.
