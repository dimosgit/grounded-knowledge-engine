---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, prompts, source-docs
source: modelcontextprotocol/docs/docs/concepts/prompts.mdx
---

# MCP Source Notes: Prompts

MCP prompts are reusable, parameterized templates a server exposes so an
application can offer consistent, structured interactions. Unlike tools, which
are model-controlled, prompts are user-controlled: the person explicitly picks
which prompt to run, often surfaced as a slash command or quick action.

The prompts flow has two operations:
- `prompts/list` discovers the prompts a server exposes and their metadata.
- `prompts/get` resolves a selected prompt with its arguments into concrete
  message content.

Prompts can accept required or optional arguments, embed resource context (logs,
code files) directly, and chain several conversation steps into a guided
workflow.
