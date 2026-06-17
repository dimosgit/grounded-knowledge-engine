---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, roots, source-docs
source: modelcontextprotocol/docs/docs/concepts/roots.mdx
---

# MCP Source Notes: Roots

A root is a URI that the client suggests a server should focus on. Clients
declare roots to a server during connection to indicate which resources and
locations are relevant — for example a project directory (`file://`) or an API
endpoint (`https://`).

Roots are informational rather than strictly enforced boundaries, but a
well-behaved server prioritizes operations within them. They commonly scope
repositories, project folders, and API surfaces so a server knows where to work.

Roots describe *where* to look; resources expose *what* is there.
