# Remote MCP — Loopback HTTP Bridge + ngrok Tunnel (proof of concept)

GKE normally runs as a **local stdio MCP server** (Claude Code, Codex, Gemini CLI
all launch it as a subprocess). Microsoft Copilot Studio and Microsoft 365
declarative agents cannot launch a local process — they require a reachable
**Streamable HTTP** URL.

This bridge exposes the **same read-only tools** over loopback HTTP so they can be
published through a short-lived authenticated tunnel (e.g. ngrok) for controlled
testing. It is a **proof of concept**, not production architecture.

## Safety model

- **Loopback only.** The server binds `127.0.0.1`. It refuses any non-loopback
  bind. External reach must come from an approved tunnel client.
- **Read-only, enforced.** Writes are forced off and every non-read tool
  (including `kb.refresh`) is refused at the HTTP boundary, regardless of local
  config. Mutation tools are never advertised or executed.
- **API-key auth.** Every `/mcp` request needs a valid key (constant-time check).
- **No path leakage.** Absolute host paths are stripped; citations stay
  workspace-relative (e.g. `demo-kb/sources/...`).
- **Limits.** Body size, concurrency, and request timeouts are capped.
- **Disclosure.** Files and execution stay local, but any evidence returned over
  the tunnel passes through Microsoft and the tunnel provider. Use the sanitized
  demo workspace by default; internal company data requires explicit approval.

## 1. Start the local HTTP bridge

```bash
export KB_MCP_HTTP_API_KEY="$(openssl rand -hex 24)"   # required; requests 401/503 without it
export KB_MCP_SCAN_ROOTS="demo-kb"                      # use the sanitized demo workspace
npm run dev:mcp:http
```

It listens on `http://127.0.0.1:8765/mcp` (health: `/healthz`).

| Env var               | Default                           | Purpose                    |
| --------------------- | --------------------------------- | -------------------------- |
| `KB_MCP_HTTP_API_KEY` | _(unset → all requests rejected)_ | shared secret for `/mcp`   |
| `KB_MCP_HTTP_PORT`    | `8765`                            | loopback port              |
| `KB_MCP_HTTP_HOST`    | `127.0.0.1`                       | must stay loopback         |
| `KB_MCP_SCAN_ROOTS`   | `demo-kb,kb`                      | workspace folders to index |

Quick local check:

```bash
curl -s http://127.0.0.1:8765/healthz
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $KB_MCP_HTTP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 2. Open a temporary tunnel

```bash
ngrok http 8765
```

ngrok prints a public HTTPS URL (e.g. `https://<random>.ngrok-free.app`). The
MCP endpoint is that URL + `/mcp`. The URL is ephemeral — do **not** commit it.

> **One tunnel at a time.** ngrok's free tier allows a single active tunnel/agent
> session. If you also need to tunnel the cockpit or another service, run them
> sequentially (stop one `ngrok` before starting the next) or use reserved
> domains / a paid plan for parallel tunnels.

Stop the tunnel (`Ctrl-C` on ngrok) and the bridge (`Ctrl-C` on the npm process)
as soon as testing is done.

## 3. Point the remote client at it

Configure the agent (e.g. Copilot Studio "add an existing MCP server"):

- **Transport:** Streamable HTTP
- **Server URL:** `https://<random>.ngrok-free.app/mcp`
- **Auth:** API key — send as `Authorization: Bearer <key>` (or `x-api-key: <key>`)
- **Tools:** read-only (`kb.search`, `kb.get_record`, `kb.answer_and_capture`, …)

## Tests

```bash
npm run test:mcp:http   # initialize → tools/list → kb.search, auth + write-denial + limits
```

Parity with stdio is structural: the HTTP bridge reuses the exact
`handleRequest` dispatch from `tools/kb-mcp-server/server.ts`.
