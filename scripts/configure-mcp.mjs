#!/usr/bin/env node
// Register the default GKE workspace or separately named local workspace vaults
// with Claude Code, Codex, Gemini CLI, and GitHub Copilot.
//
//   node scripts/configure-mcp.mjs
//   node scripts/configure-mcp.mjs --client codex
//   node scripts/configure-mcp.mjs --client github-copilot
//   node scripts/configure-mcp.mjs --profile full
//   node scripts/configure-mcp.mjs --no-writes
//   node scripts/configure-mcp.mjs --workspace client-alpha --workspace-root ../client-alpha
//   node scripts/configure-mcp.mjs --workspace client-alpha
//   node scripts/configure-mcp.mjs --list-workspaces
//   node scripts/configure-mcp.mjs --skip-smoke
//
// The clients use different project-local config files, but every adapter launches
// the same tools/kb-mcp-server/server.ts process with the same environment.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVER_NAME = "kb";
const SERVER_ENTRY_REL = "tools/kb-mcp-server/server.ts";
const SMOKE_TEST_REL = "tools/kb-mcp-server/smoke-test.ts";
const WORKSPACE_REGISTRY_REL = ".gke/workspaces.json";
const SUPPORTED_CLIENTS = new Set(["claude", "codex", "gemini", "github-copilot", "all"]);
const LEGACY_MANAGED_TOML_START = "# >>> Grounded Knowledge Engine MCP (managed by setup:mcp)";
const LEGACY_MANAGED_TOML_END = "# <<< Grounded Knowledge Engine MCP";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = process.env.GKE_MCP_CONFIG_ROOT
  ? resolve(process.env.GKE_MCP_CONFIG_ROOT)
  : repoRoot;
const cliArgs = process.argv.slice(2);
const requestedWorkspace = normalizeWorkspaceId(readOption(cliArgs, "--workspace"), true);
const requestedWorkspaceRoot = readOption(cliArgs, "--workspace-root");
const listWorkspaces = cliArgs.includes("--list-workspaces");
const explicitlyEnableWrites = cliArgs.includes("--writes");
const explicitlyDisableWrites = cliArgs.includes("--no-writes");
if (explicitlyEnableWrites && explicitlyDisableWrites) {
  fail("Use only one of --writes or --no-writes.");
}
if (listWorkspaces && (requestedWorkspace || requestedWorkspaceRoot)) {
  fail("--list-workspaces cannot be combined with --workspace or --workspace-root.");
}
if (listWorkspaces) {
  printRegisteredWorkspaces();
  process.exit(0);
}

const skipSmoke = cliArgs.includes("--skip-smoke");
const requestedClient = (readOption(cliArgs, "--client") || "all").toLowerCase();
const requestedProfile = (readOption(cliArgs, "--profile") || "core").toLowerCase();
if (!SUPPORTED_CLIENTS.has(requestedClient)) {
  fail(
    `Unsupported client "${requestedClient}". Use claude, codex, gemini, github-copilot, or all.`,
  );
}
if (!new Set(["core", "full"]).has(requestedProfile)) {
  fail(`Unsupported profile "${requestedProfile}". Use core or full.`);
}

const workspace = resolveWorkspaceSelection(requestedWorkspace, requestedWorkspaceRoot);
const serverName = workspace ? `${DEFAULT_SERVER_NAME}-${workspace.id}` : DEFAULT_SERVER_NAME;
const enableWrites = workspace
  ? explicitlyEnableWrites
  : explicitlyEnableWrites || !explicitlyDisableWrites;
if (workspace?.readOnly && enableWrites) {
  fail(
    `Workspace "${workspace.id}" is read-only. Update its .gke/workspace.json before using --writes.`,
  );
}
const clients =
  requestedClient === "all" ? ["claude", "codex", "gemini", "github-copilot"] : [requestedClient];
const isWindows = process.platform === "win32";
const nodeBin = process.execPath;
const tsxBin = join(repoRoot, "node_modules", ".bin", isWindows ? "tsx.cmd" : "tsx");
const serverEntry = join(repoRoot, SERVER_ENTRY_REL);
const serverEnv = {
  KB_MCP_PROFILE: requestedProfile,
  ...(workspace
    ? {
        KB_MCP_REPO_ROOT: workspace.repoRoot,
        KB_MCP_WORKSPACE_ID: workspace.id,
        KB_MCP_WORKSPACE_READ_ONLY: String(workspace.readOnly),
      }
    : {}),
  ...(enableWrites ? { KB_MCP_ENABLE_WRITES: "true" } : {}),
};

function readOption(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`\n✗ Cannot safely update invalid JSON at ${path}: ${error.message}`);
    process.exit(1);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

function normalizeWorkspaceId(value, optional = false) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized && optional) return "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    fail("Workspace ID must be a lowercase slug.");
  }
  return normalized;
}

function readWorkspaceRegistry() {
  const registryPath = join(configRoot, WORKSPACE_REGISTRY_REL);
  const parsed = readJson(registryPath);
  if (Object.keys(parsed).length === 0) {
    return { schemaVersion: 1, workspaces: {} };
  }
  if (
    parsed.schemaVersion !== 1 ||
    !parsed.workspaces ||
    typeof parsed.workspaces !== "object" ||
    Array.isArray(parsed.workspaces)
  ) {
    fail(`Workspace registry is invalid: ${registryPath}`);
  }
  for (const [id, entry] of Object.entries(parsed.workspaces)) {
    normalizeWorkspaceId(id);
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.repoRoot !== "string" ||
      !entry.repoRoot.trim()
    ) {
      fail(`Workspace registry entry "${id}" is invalid.`);
    }
  }
  return parsed;
}

function readWorkspaceConfigSummary(workspaceRoot) {
  const configPath = join(workspaceRoot, ".gke", "workspace.json");
  if (!existsSync(configPath)) {
    return { id: "", label: "", readOnly: true };
  }
  const config = readJson(configPath);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail(`Workspace configuration must be a JSON object: ${configPath}`);
  }
  const id = config.id === undefined ? "" : normalizeWorkspaceId(config.id);
  if (config.readOnly !== undefined && typeof config.readOnly !== "boolean") {
    fail(`Workspace configuration readOnly must be a boolean: ${configPath}`);
  }
  return {
    id,
    label: typeof config.label === "string" ? config.label.trim() : "",
    readOnly: config.readOnly !== false,
  };
}

function resolveExistingWorkspaceRoot(value) {
  const requestedRoot = resolve(value);
  let realRoot;
  try {
    realRoot = realpathSync(requestedRoot);
  } catch {
    fail(`Workspace root does not exist: ${requestedRoot}`);
  }
  if (!statSync(realRoot).isDirectory()) {
    fail(`Workspace root is not a directory: ${requestedRoot}`);
  }
  return realRoot;
}

function resolveWorkspaceSelection(workspaceId, workspaceRootOption) {
  if (!workspaceId && !workspaceRootOption) return null;
  const registry = readWorkspaceRegistry();
  let workspaceRoot;
  if (workspaceRootOption) {
    workspaceRoot = resolveExistingWorkspaceRoot(workspaceRootOption);
  } else {
    const registered = registry.workspaces[workspaceId];
    if (!registered) {
      fail(
        `Workspace "${workspaceId}" is not registered. Re-run with --workspace-root <directory>.`,
      );
    }
    workspaceRoot = resolveExistingWorkspaceRoot(registered.repoRoot);
  }

  const config = readWorkspaceConfigSummary(workspaceRoot);
  const resolvedId = normalizeWorkspaceId(workspaceId || config.id);
  if (config.id && config.id !== resolvedId) {
    fail(`Workspace ID "${resolvedId}" does not match .gke/workspace.json ID "${config.id}".`);
  }
  if (workspaceRootOption) {
    registry.workspaces[resolvedId] = { repoRoot: workspaceRoot };
    writeJson(join(configRoot, WORKSPACE_REGISTRY_REL), registry);
  }
  return {
    id: resolvedId,
    repoRoot: workspaceRoot,
    label: config.label || resolvedId,
    readOnly: config.readOnly,
  };
}

function printRegisteredWorkspaces() {
  const registry = readWorkspaceRegistry();
  const entries = Object.entries(registry.workspaces).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (!entries.length) {
    console.log("No registered GKE workspaces.");
    return;
  }
  console.log("Registered GKE workspaces:");
  for (const [id, entry] of entries) {
    let rootStatus = "";
    let summary = { label: id, readOnly: true };
    try {
      const realRoot = realpathSync(resolve(entry.repoRoot));
      if (!statSync(realRoot).isDirectory()) throw new Error("not a directory");
      const config = readWorkspaceConfigSummary(realRoot);
      summary = {
        label: config.label || id,
        readOnly: config.readOnly,
      };
    } catch {
      rootStatus = " [missing]";
    }
    const mode = summary.readOnly ? "read-only" : "writable";
    console.log(`- ${id}: ${summary.label || id} (${mode})${rootStatus} — ${entry.repoRoot}`);
  }
}

function quoteToml(value) {
  return JSON.stringify(value);
}

function removeTomlTables(current, tableNames) {
  const kept = [];
  let skip = false;
  for (const line of current.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) skip = tableNames.has(header[1]);
    if (!skip) kept.push(line);
  }
  return kept.join("\n").trimEnd();
}

function managedTomlStart(name) {
  return name === DEFAULT_SERVER_NAME
    ? LEGACY_MANAGED_TOML_START
    : `# >>> Grounded Knowledge Engine MCP ${name} (managed by setup:mcp)`;
}

function managedTomlEnd(name) {
  return name === DEFAULT_SERVER_NAME
    ? LEGACY_MANAGED_TOML_END
    : `# <<< Grounded Knowledge Engine MCP ${name}`;
}

function replaceManagedTomlBlock(current, block, name) {
  const startMarker = managedTomlStart(name);
  const endMarker = managedTomlEnd(name);
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (start >= 0 && end >= start) {
    const afterEnd = end + endMarker.length;
    return `${current.slice(0, start)}${block}${current.slice(afterEnd)}`.trimEnd() + "\n";
  }

  // Upgrade an existing unmanaged entry without duplicating TOML tables.
  const prefix = removeTomlTables(
    current,
    new Set([`mcp_servers.${name}`, `mcp_servers.${name}.env`]),
  );
  return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
}

function ensureGitignore(entries) {
  const path = join(configRoot, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return;
  const header = "\n# Agent-local MCP config (generated by scripts/configure-mcp.mjs)\n";
  const block = `${header}${missing.join("\n")}\n`;
  writeFileSync(
    path,
    current.endsWith("\n") || current === "" ? current + block : `${current}\n${block}`,
  );
}

function configureSharedMcpJson() {
  step("Configuring shared MCP project entry (.mcp.json)…");
  const mcpPath = join(configRoot, ".mcp.json");
  const mcp = readJson(mcpPath);
  mcp.mcpServers = {
    ...(mcp.mcpServers ?? {}),
    [serverName]: {
      type: "stdio",
      command: nodeBin,
      args: [tsxBin, serverEntry],
      env: serverEnv,
    },
  };
  writeJson(mcpPath, mcp);
}

function configureClaude() {
  step("Approving the shared entry for Claude Code (.claude/settings.local.json)…");
  const settingsPath = join(configRoot, ".claude", "settings.local.json");
  const settings = readJson(settingsPath);
  const approved = new Set(settings.enabledMcpjsonServers ?? []);
  approved.add(serverName);
  settings.enabledMcpjsonServers = [...approved];
  writeJson(settingsPath, settings);
}

function configureCodex() {
  step("Configuring Codex (.codex/config.toml)…");
  const configPath = join(configRoot, ".codex", "config.toml");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const envLines = [
    `[mcp_servers.${serverName}.env]`,
    `KB_MCP_PROFILE = ${quoteToml(requestedProfile)}`,
  ];
  if (workspace) {
    envLines.push(`KB_MCP_REPO_ROOT = ${quoteToml(workspace.repoRoot)}`);
    envLines.push(`KB_MCP_WORKSPACE_ID = ${quoteToml(workspace.id)}`);
    envLines.push(`KB_MCP_WORKSPACE_READ_ONLY = ${quoteToml(String(workspace.readOnly))}`);
  }
  if (enableWrites) envLines.push(`KB_MCP_ENABLE_WRITES = "true"`);
  const envBlock = `\n${envLines.join("\n")}\n`;
  const block = [
    managedTomlStart(serverName),
    `[mcp_servers.${serverName}]`,
    `command = ${quoteToml(nodeBin)}`,
    `args = [${quoteToml(tsxBin)}, ${quoteToml(serverEntry)}]`,
    envBlock.trimEnd(),
    managedTomlEnd(serverName),
  ]
    .filter(Boolean)
    .join("\n");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, replaceManagedTomlBlock(current, block, serverName));
}

function configureGemini() {
  step("Configuring Gemini CLI (.gemini/settings.json)…");
  const settingsPath = join(configRoot, ".gemini", "settings.json");
  const settings = readJson(settingsPath);
  settings.mcpServers = {
    ...(settings.mcpServers ?? {}),
    [serverName]: {
      command: nodeBin,
      args: [tsxBin, serverEntry],
      cwd: repoRoot,
      env: serverEnv,
    },
  };
  writeJson(settingsPath, settings);
}

function configureGithubCopilot() {
  step("Configuring GitHub Copilot in VS Code (.vscode/mcp.json)…");
  const settingsPath = join(configRoot, ".vscode", "mcp.json");
  const settings = readJson(settingsPath);
  settings.servers = {
    ...(settings.servers ?? {}),
    [serverName]: {
      type: "stdio",
      command: nodeBin,
      args: [tsxBin, serverEntry],
      env: serverEnv,
    },
  };
  writeJson(settingsPath, settings);
}

// 1. Dependencies -------------------------------------------------------------
if (!existsSync(tsxBin)) {
  step("Installing dependencies (npm install)…");
  execFileSync(isWindows ? "npm.cmd" : "npm", ["install"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
if (!existsSync(tsxBin)) {
  console.error(`\n✗ tsx not found at ${tsxBin} even after npm install. Aborting.`);
  process.exit(1);
}
if (!existsSync(serverEntry)) {
  console.error(`\n✗ Server entry not found at ${serverEntry}. Aborting.`);
  process.exit(1);
}

// 2. Client adapters ----------------------------------------------------------
if (clients.includes("claude") || clients.includes("github-copilot")) {
  configureSharedMcpJson();
}
for (const client of clients) {
  if (client === "claude") configureClaude();
  if (client === "codex") configureCodex();
  if (client === "gemini") configureGemini();
  if (client === "github-copilot") configureGithubCopilot();
}

// 3. Ignore generated machine-specific files ---------------------------------
step("Updating .gitignore…");
ensureGitignore([
  ".gke/workspaces.json",
  ".mcp.json",
  ".claude/settings.local.json",
  ".codex/config.toml",
  ".gemini/settings.json",
  ".vscode/mcp.json",
]);

// 4. Verify the one shared server ---------------------------------------------
if (skipSmoke) {
  console.log("\n(skipping smoke test)");
} else {
  step("Verifying the shared MCP server handshake…");
  try {
    execFileSync(nodeBin, [tsxBin, join(repoRoot, SMOKE_TEST_REL)], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, KB_MCP_ENABLE_WRITES: enableWrites ? "true" : "" },
    });
  } catch {
    console.error("\n✗ Smoke test failed — the server did not complete the handshake.");
    process.exit(1);
  }
}

console.log(`
✅ The "${serverName}" MCP server is configured for: ${clients.join(", ")}.

   All clients launch the same server:
   ${serverEntry}

   Writes: ${enableWrites ? "enabled" : "disabled (dryRun remains available)"}
   Profile: ${requestedProfile}
   Workspace: ${workspace ? `${workspace.label} (${workspace.id})` : "default"}
   Restart the configured client(s) from this repository to load the tools.
`);
