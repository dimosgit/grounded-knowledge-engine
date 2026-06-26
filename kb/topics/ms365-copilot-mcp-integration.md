---
module: knowledge-ops
track: demo
status: canonical
type: howto
owner: integrations
updated: 2026-06-26
tags: mcp, ms365-copilot, copilot-studio, ngrok, remote-transport, howto
---

# Using GKE with Microsoft 365 Copilot (Remote MCP over ngrok)

How to expose the local Grounded Knowledge Engine to a Microsoft 365 Copilot /
Copilot Studio agent. GKE stays local; only the read-only MCP tools are reached
through a short-lived authenticated tunnel.

## Endpoint

- **Public MCP URL:** `https://YOUR-DOMAIN.ngrok-free.app/mcp`
- **Health check:** `https://YOUR-DOMAIN.ngrok-free.app/healthz`
- **Transport:** Streamable HTTP (stateless)
- **Auth:** API key sent as `Authorization: Bearer <key>` (or `x-api-key: <key>`)

Replace `YOUR-DOMAIN` with your own ngrok domain. The maintainer's real endpoint
is a reserved, ephemeral tunnel kept **outside this public repo** (local notes
only), and the API key is a secret that lives only in the `KB_MCP_HTTP_API_KEY`
environment variable — never committed.

## Start it (two terminals)

```bash
# Terminal 1 — local read-only MCP bridge (run from the repo root)
export KB_MCP_HTTP_API_KEY="<your-secret>"   # pick a strong value; do not commit
export KB_MCP_SCAN_ROOTS="demo-kb"           # sanitized demo workspace
npm run dev:mcp:http                         # serves 127.0.0.1:8765/mcp

# Terminal 2 — bind ngrok to the reserved domain
ngrok http 8765 --url=https://YOUR-DOMAIN.ngrok-free.app
```

## Verify the tunnel

```bash
curl https://YOUR-DOMAIN.ngrok-free.app/healthz
# -> {"status":"ok"}

curl -X POST https://YOUR-DOMAIN.ngrok-free.app/mcp \
  -H "Authorization: Bearer $KB_MCP_HTTP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

If a request returns ngrok's browser interstitial instead of JSON, add the header
`ngrok-skip-browser-warning: 1`.

## Connect from Copilot Studio

Add an existing MCP server / custom connector:

- **Server URL:** `https://YOUR-DOMAIN.ngrok-free.app/mcp`
- **Transport:** Streamable HTTP
- **Auth:** API key → `Authorization: Bearer <key>`
- **Tools:** read-only only (`kb.search`, `kb.get_record`, `kb.answer_and_capture`, …)

## Safety notes

- Read-only is enforced: writes are off and mutation tools are refused at the HTTP
  boundary regardless of local config.
- Citations are workspace-relative; absolute host paths are stripped.
- Evidence returned over the tunnel transits Microsoft and ngrok even though files
  and execution stay local — use the sanitized demo workspace by default; internal
  company data needs explicit approval.
- Stop `ngrok` and the bridge when finished. This is a proof of concept, not
  production architecture.

See also: [docs/integrations/remote-mcp-tunnel.md](../../docs/integrations/remote-mcp-tunnel.md).
