---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, resources, source-docs
source: modelcontextprotocol/docs/docs/concepts/resources.mdx
---

# MCP Source Notes: Resources

MCP resources expose data or content that clients can read and use as context.
Resources can represent files, database rows, API responses, screenshots, logs,
or other server-provided content.

Resources are identified by URIs. Servers can list concrete resources with
`resources/list`, expose URI templates, and respond to `resources/read` with text
or binary payloads.

Resources are application-controlled in the normal MCP model. For automatic
model-driven actions, a server should expose a tool instead.
