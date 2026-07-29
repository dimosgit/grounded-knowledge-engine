# GitHub Copilot — Local GKE MCP Setup

GitHub Copilot can launch the same local `stdio` GKE server used by Claude
Code, Codex, and Gemini CLI. No HTTP bridge, tunnel, copied knowledge, or
provider-specific server is involved.

## Generate the project adapters

From the repository root:

```bash
npm run setup:mcp -- --client github-copilot
```

This creates two ignored, machine-local files with absolute paths:

| Host                        | Generated file     | Configuration shape |
| --------------------------- | ------------------ | ------------------- |
| GitHub Copilot CLI          | `.mcp.json`        | `mcpServers.kb`     |
| Copilot Chat in VS Code     | `.vscode/mcp.json` | `servers.kb`        |
| Claude Code, when installed | `.mcp.json`        | `mcpServers.kb`     |

Both Copilot entries launch `tools/kb-mcp-server/server.ts` through the
repository's installed `tsx` executable. The shared `.mcp.json` uses the
standard `stdio` type and remains compatible with Claude Code.

Use `--no-writes` to expose only read behavior, or `--profile full` when the
larger catalog is deliberately needed:

```bash
npm run setup:mcp -- --client github-copilot --no-writes
npm run setup:mcp -- --client github-copilot --profile full
```

## Verify in VS Code

1. Open this repository in VS Code and review the generated
   `.vscode/mcp.json`.
2. Approve the workspace and MCP server when VS Code asks for trust.
3. Run **MCP: List Servers** and start `kb` if it is not already running.
4. Open Copilot Chat in Agent mode and inspect the tool picker.
5. Ask Copilot to use `kb.search` against a topic in the sanitized demo
   workspace.

For Copilot Business or Enterprise, an organization administrator may need to
enable the **MCP servers in Copilot** policy.

## Verify in Copilot CLI

Start Copilot CLI from this repository. It discovers the project-level
`.mcp.json`; then use `/mcp show kb` or `copilot mcp get kb` to inspect the
server and available tools.

Copilot CLI does not read `.vscode/mcp.json`, which is why setup generates both
files. Do not copy the generated absolute paths into a shared committed
configuration.

## Scope and references

This adapter is local only. GitHub's cloud coding agent is a different
execution environment and cannot access Markdown that remains solely on this
machine without an explicit data-transfer design.

- [GitHub: MCP servers in an IDE](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp)
- [GitHub: MCP servers in Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
