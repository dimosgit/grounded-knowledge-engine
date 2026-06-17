---
module: agent-runtime
track: demo
status: canonical
type: concept
owner: demo
updated: 2026-06-17
tags: mcp, tools, source-docs
source: modelcontextprotocol/docs/docs/concepts/tools.mdx
---

# MCP Source Notes: Tools

MCP tools let a server expose executable functionality that clients and LLMs can
invoke. Tools are appropriate when the model should be able to perform an action,
call an external system, run a computation, or change state with approval.

The tools flow has two important operations:
- `tools/list` lets a client discover the tools a server exposes.
- `tools/call` invokes one selected tool with arguments and returns content.

Tools are model-controlled, unlike resources, which are usually selected by the
application. Search and capture are tools because the agent can decide to call
them during a task.

