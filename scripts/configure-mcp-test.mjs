#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = join(repoRoot, "scripts", "configure-mcp.mjs");
const configRoot = mkdtempSync(join(tmpdir(), "gke-mcp-setup-"));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(configRoot, relativePath), "utf8"));
}

function runSetup(...args) {
  execFileSync(process.execPath, [setupScript, ...args], {
    cwd: repoRoot,
    env: { ...process.env, GKE_MCP_CONFIG_ROOT: configRoot },
    stdio: "pipe",
  });
}

try {
  mkdirSync(join(configRoot, ".vscode"), { recursive: true });
  writeFileSync(
    join(configRoot, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { existing: { command: "existing-server" } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(configRoot, ".vscode", "mcp.json"),
    `${JSON.stringify({ servers: { existing: { command: "existing-server" } } }, null, 2)}\n`,
  );
  writeFileSync(join(configRoot, ".gitignore"), "already-ignored\n");

  runSetup("--client", "github-copilot", "--no-writes", "--skip-smoke");

  const projectConfig = readJson(".mcp.json");
  const vscodeConfig = readJson(join(".vscode", "mcp.json"));
  const projectServer = projectConfig.mcpServers.kb;
  const vscodeServer = vscodeConfig.servers.kb;

  assert.deepEqual(projectConfig.mcpServers.existing, { command: "existing-server" });
  assert.deepEqual(vscodeConfig.servers.existing, { command: "existing-server" });
  assert.equal(projectServer.type, "stdio");
  assert.equal(vscodeServer.type, "stdio");
  assert.equal(projectServer.command, process.execPath);
  assert.equal(vscodeServer.command, process.execPath);
  assert.equal(projectServer.args.length, 2);
  assert.deepEqual(vscodeServer.args, projectServer.args);
  assert.equal(projectServer.env.KB_MCP_PROFILE, "core");
  assert.equal(projectServer.env.KB_MCP_ENABLE_WRITES, undefined);
  assert.deepEqual(vscodeServer.env, projectServer.env);
  assert.ok(projectServer.args.every((arg) => arg.startsWith(repoRoot)));

  const gitignore = readFileSync(join(configRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^already-ignored$/m);
  assert.match(gitignore, /^\.mcp\.json$/m);
  assert.match(gitignore, /^\.vscode\/mcp\.json$/m);

  runSetup("--client=all", "--profile=full", "--skip-smoke");
  const updatedProjectServer = readJson(".mcp.json").mcpServers.kb;
  const updatedVscodeServer = readJson(join(".vscode", "mcp.json")).servers.kb;
  const claudeSettings = readJson(join(".claude", "settings.local.json"));
  const geminiServer = readJson(join(".gemini", "settings.json")).mcpServers.kb;
  const codexConfig = readFileSync(join(configRoot, ".codex", "config.toml"), "utf8");
  assert.equal(updatedProjectServer.env.KB_MCP_PROFILE, "full");
  assert.equal(updatedProjectServer.env.KB_MCP_ENABLE_WRITES, "true");
  assert.deepEqual(updatedVscodeServer, updatedProjectServer);
  assert.ok(claudeSettings.enabledMcpjsonServers.includes("kb"));
  assert.equal(geminiServer.env.KB_MCP_PROFILE, "full");
  assert.equal(geminiServer.env.KB_MCP_ENABLE_WRITES, "true");
  assert.match(codexConfig, /^\[mcp_servers\.kb\]$/m);
  assert.match(codexConfig, /^KB_MCP_PROFILE = "full"$/m);
  assert.match(codexConfig, /^KB_MCP_ENABLE_WRITES = "true"$/m);

  console.log("MCP setup adapter test passed.");
} finally {
  rmSync(configRoot, { recursive: true, force: true });
}
