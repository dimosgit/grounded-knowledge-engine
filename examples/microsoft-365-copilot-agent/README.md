# Microsoft 365 Copilot Agent — Tenant Validation Recipe

This directory records the reproducible validation path for a future
Microsoft 365 declarative-agent package. It intentionally does **not** contain
an installable generated package yet.

## Why the package is not checked in

Microsoft 365 Agents Toolkit 6.12 or later generates the current agent files,
including `ai-plugin.json`, from the MCP server URL and selected authentication
mode. GKE's temporary HTTP bridge currently accepts a shared API key. The
Toolkit's documented MCP-agent flow offers OAuth, Entra SSO, or no
authentication, so selecting **None** would weaken GKE's fail-closed tunnel
boundary.

A truthful, runnable package therefore depends on two unfinished prerequisites:

1. an OAuth/OIDC or Entra-compatible authorization boundary for GKE; and
2. an approved Microsoft 365 tenant with custom app upload and Copilot access.

Generated tenant registration, client identifiers, secrets, tunnel URLs, and
machine paths must never be committed here.

## Validation procedure after those prerequisites land

1. Start the GKE HTTP bridge against `demo-kb` and expose it through the
   short-lived HTTPS tunnel described in
   [`docs/integrations/remote-mcp-tunnel.md`](../../docs/integrations/remote-mcp-tunnel.md).
2. In Microsoft 365 Agents Toolkit, select **Create a New Agent/App →
   Declarative Agent → Add an Action → Start with an MCP Server**.
3. Enter `https://YOUR-TUNNEL.example/mcp`.
4. Select the implemented OAuth/Entra mode. Never select unauthenticated access
   for a public tunnel.
5. Let Agents Toolkit generate `ai-plugin.json` so MCP tools are discovered
   dynamically; do not manually duplicate GKE's tool schemas.
6. Provision and sideload only into the approved test tenant.
7. Confirm that discovery contains the four read-safe core tools and no
   mutation tool.
8. Run `kb.search` and `kb.resume_project` against the sanitized demo workspace.
9. Confirm citations are workspace-relative and contain no host paths.
10. Stop the tunnel and bridge, then verify that the agent can no longer reach
    GKE.

Reference:
[Microsoft — Build a plugin for a declarative agent from an MCP server](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins).
