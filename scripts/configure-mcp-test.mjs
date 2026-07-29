#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = join(repoRoot, "scripts", "configure-mcp.mjs");
const configRoot = mkdtempSync(join(tmpdir(), "gke-mcp-setup-"));
const workspaceParent = mkdtempSync(join(tmpdir(), "gke-mcp-workspaces-"));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(configRoot, relativePath), "utf8"));
}

function runSetup(...args) {
  return execFileSync(process.execPath, [setupScript, ...args], {
    cwd: repoRoot,
    env: { ...process.env, GKE_MCP_CONFIG_ROOT: configRoot },
    stdio: "pipe",
    encoding: "utf8",
  });
}

function writeWorkspace(name, config) {
  const workspaceRoot = join(workspaceParent, name);
  mkdirSync(join(workspaceRoot, ".gke"), { recursive: true });
  mkdirSync(join(workspaceRoot, "kb"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, ".gke", "workspace.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  writeFileSync(join(workspaceRoot, "kb", "marker.md"), `# ${config.label}\n`);
  return workspaceRoot;
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

  const alphaRoot = writeWorkspace("Client Alpha Vault", {
    id: "client-alpha",
    label: "Client Alpha",
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
    readOnly: true,
    sensitivity: "sensitive",
  });
  const betaRoot = writeWorkspace("Client Beta Vault", {
    id: "client-beta",
    label: "Client Beta",
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
    readOnly: false,
    sensitivity: "internal",
  });

  runSetup(
    "--client=all",
    "--workspace=client-alpha",
    "--workspace-root",
    alphaRoot,
    "--skip-smoke",
  );
  runSetup("--client=all", "--workspace=client-beta", "--workspace-root", betaRoot, "--skip-smoke");

  const registry = readJson(join(".gke", "workspaces.json"));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.workspaces["client-alpha"].repoRoot, realpathSync(alphaRoot));
  assert.equal(registry.workspaces["client-beta"].repoRoot, realpathSync(betaRoot));
  if (process.platform !== "win32") {
    assert.equal(statSync(join(configRoot, ".gke", "workspaces.json")).mode & 0o777, 0o600);
  }

  const multiProjectConfig = readJson(".mcp.json").mcpServers;
  const multiVscodeConfig = readJson(join(".vscode", "mcp.json")).servers;
  const multiGeminiConfig = readJson(join(".gemini", "settings.json")).mcpServers;
  const multiClaudeSettings = readJson(join(".claude", "settings.local.json"));
  const alphaServer = multiProjectConfig["kb-client-alpha"];
  const betaServer = multiProjectConfig["kb-client-beta"];
  assert.ok(multiProjectConfig.kb);
  assert.equal(alphaServer.env.KB_MCP_REPO_ROOT, realpathSync(alphaRoot));
  assert.equal(alphaServer.env.KB_MCP_WORKSPACE_ID, "client-alpha");
  assert.equal(alphaServer.env.KB_MCP_WORKSPACE_READ_ONLY, "true");
  assert.equal(alphaServer.env.KB_MCP_ENABLE_WRITES, undefined);
  assert.equal(betaServer.env.KB_MCP_REPO_ROOT, realpathSync(betaRoot));
  assert.equal(betaServer.env.KB_MCP_WORKSPACE_READ_ONLY, "false");
  assert.equal(betaServer.env.KB_MCP_ENABLE_WRITES, undefined);
  for (const name of ["kb-client-alpha", "kb-client-beta"]) {
    assert.deepEqual(multiVscodeConfig[name], multiProjectConfig[name]);
    assert.equal(multiGeminiConfig[name].env.KB_MCP_WORKSPACE_ID, name.slice(3));
    assert.ok(multiClaudeSettings.enabledMcpjsonServers.includes(name));
  }

  const multiCodexConfig = readFileSync(join(configRoot, ".codex", "config.toml"), "utf8");
  assert.match(multiCodexConfig, /^\[mcp_servers\.kb-client-alpha\]$/m);
  assert.match(multiCodexConfig, /^\[mcp_servers\.kb-client-beta\]$/m);
  assert.equal((multiCodexConfig.match(/\[mcp_servers\.kb-client-alpha\]/g) || []).length, 1);
  assert.equal((multiCodexConfig.match(/\[mcp_servers\.kb-client-beta\]/g) || []).length, 1);

  runSetup("--client=codex", "--workspace=client-beta", "--writes", "--skip-smoke");
  const writableCodexConfig = readFileSync(join(configRoot, ".codex", "config.toml"), "utf8");
  assert.match(
    writableCodexConfig,
    /\[mcp_servers\.kb-client-beta\.env\][\s\S]*?KB_MCP_ENABLE_WRITES = "true"/,
  );
  assert.equal((writableCodexConfig.match(/\[mcp_servers\.kb-client-beta\]/g) || []).length, 1);
  assert.throws(
    () => runSetup("--workspace=client-alpha", "--writes", "--client=codex", "--skip-smoke"),
    /read-only/i,
  );
  assert.throws(
    () => runSetup("--workspace=not-registered", "--client=codex", "--skip-smoke"),
    /not registered/i,
  );

  const listed = runSetup("--list-workspaces");
  assert.match(listed, /client-alpha: Client Alpha \(read-only\)/);
  assert.match(listed, /client-beta: Client Beta \(writable\)/);
  assert.match(listed, /Client Alpha Vault/);
  assert.match(readFileSync(join(configRoot, ".gitignore"), "utf8"), /^\.gke\/workspaces\.json$/m);

  console.log("MCP setup adapter test passed.");
} finally {
  rmSync(configRoot, { recursive: true, force: true });
  rmSync(workspaceParent, { recursive: true, force: true });
}
