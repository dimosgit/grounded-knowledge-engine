---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, sampling, source-docs
source: modelcontextprotocol/docs/docs/concepts/sampling.mdx
---

# MCP Source Notes: Sampling

Sampling inverts the usual direction: the server asks the client for an LLM
completion via the `sampling/createMessage` method. This lets a server drive
agentic, multi-step behavior without holding its own model credentials.

The flow keeps a human in the loop on the client side:
1. The server sends a sampling request.
2. The client reviews and may modify or reject the request.
3. The client samples from an LLM of its choosing.
4. The client reviews the completion.
5. The client returns the result to the server.

The client retains final control over model selection, context inclusion, and
whether a proposed completion is accepted at all.
