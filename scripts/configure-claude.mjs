#!/usr/bin/env node
// Backward-compatible Claude-only wrapper. New users should run `npm run setup:mcp`.

process.argv.splice(2, 0, "--client", "claude");
await import("./configure-mcp.mjs");
