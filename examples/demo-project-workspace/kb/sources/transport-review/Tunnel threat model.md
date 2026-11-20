---
track: demo
module: agent-runtime
status: canonical
type: concept
owner: demo
updated: 2026-06-23
aliases:
  - Bridge threat model
tags:
  - demo
  - transport
  - security
---

# Tunnel threat model

Risks of exposing the local server through a temporary [[Streamable HTTP]] bridge
for [[projects/transport-review/project|Transport Review]].

| Risk | Mitigation |
| --- | --- |
| Someone else reaches the endpoint | Loopback only, plus a long random API key |
| An agent changes notes remotely | The bridge is read-only; writes stay local |
| A tunnel is left open | Short-lived tunnels, closed after each session |

The [[stdio transport]] stays the default for everyday local use. Decision:
[[decisions/transport-read-only-boundary|keep remote writes disabled]]. Latest
checkpoint: [[2026-06-23-cp-transport-scope]].
