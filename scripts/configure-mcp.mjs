#!/usr/bin/env node
// Register the default GKE workspace or separately named local workspace vaults
// with Claude Code, Codex, Gemini CLI, and GitHub Copilot.
//
//   node scripts/configure-mcp.mjs
//   node scripts/configure-mcp.mjs --client codex
//   node scripts/configure-mcp.mjs --client github-copilot
//   node scripts/configure-mcp.mjs --profile full
//   node scripts/configure-mcp.mjs --no-writes
//   node scripts/configure-mcp.mjs --scope user
//   node scripts/configure-mcp.mjs --workspace client-alpha --workspace-root ../client-alpha
//   node scripts/configure-mcp.mjs --workspace client-alpha
//   node scripts/configure-mcp.mjs --list-workspaces
//   node scripts/configure-mcp.mjs --skip-smoke
//
// The clients use different config files, but every adapter launches the same
// compiled server in a release package or TypeScript server in a source checkout.
//
// Scope decides *where the registration lives*, never which knowledge base the
// server reads:
//   --scope project (default) writes repo-local config, so only sessions opened
//     in this checkout see the server.
//   --scope user writes each client's home-directory config, so sessions opened
//     in any folder see the server. The server still grounds against
//     KB_MCP_REPO_ROOT (this checkout, or --workspace's root), which is an
//     absolute path, so it resolves identically from every working directory.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVER_NAME = "kb";
const SERVER_ENTRY_REL = "tools/kb-mcp-server/server.ts";
const SMOKE_TEST_REL = "tools/kb-mcp-server/smoke-test.ts";
const COMPILED_SERVER_ENTRY_REL = "dist/tools/kb-mcp-server/server.js";
const COMPILED_SMOKE_TEST_REL = "dist/tools/kb-mcp-server/smoke-test.js";
const WORKSPACE_REGISTRY_REL = ".gke/workspaces.json";
const SUPPORTED_CLIENTS = new Set(["claude", "codex", "gemini", "github-copilot", "all"]);
const SUPPORTED_SCOPES = new Set(["project", "user"]);
const LEGACY_MANAGED_TOML_START = "# >>> Grounded Knowledge Engine MCP (managed by setup:mcp)";
const LEGACY_MANAGED_TOML_END = "# <<< Grounded Knowledge Engine MCP";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = process.env.GKE_MCP_CONFIG_ROOT
  ? resolve(process.env.GKE_MCP_CONFIG_ROOT)
  : repoRoot;
// GKE_MCP_HOME lets the adapter test redirect user-scope writes away from the
// real home directory.
const homeRoot = process.env.GKE_MCP_HOME ? resolve(process.env.GKE_MCP_HOME) : homedir();
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
if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}
if (listWorkspaces) {
  printRegisteredWorkspaces();
  process.exit(0);
}

const skipSmoke = cliArgs.includes("--skip-smoke");
const forceScope = cliArgs.includes("--force");
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

const requestedScope = (readOption(cliArgs, "--scope") || "project").toLowerCase();
if (!SUPPORTED_SCOPES.has(requestedScope)) {
  fail(`Unsupported scope "${requestedScope}". Use project or user.`);
}
const userScope = requestedScope === "user";

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
const tsxEntry = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const compiledServerEntry = join(repoRoot, COMPILED_SERVER_ENTRY_REL);
const compiledSmokeTest = join(repoRoot, COMPILED_SMOKE_TEST_REL);
const useCompiledRuntime = existsSync(compiledServerEntry) && existsSync(compiledSmokeTest);
const serverEntry = useCompiledRuntime ? compiledServerEntry : join(repoRoot, SERVER_ENTRY_REL);
const smokeTestEntry = useCompiledRuntime ? compiledSmokeTest : join(repoRoot, SMOKE_TEST_REL);
const serverArgs = useCompiledRuntime ? [serverEntry] : [tsxEntry, serverEntry];
// The knowledge base the server reads. Independent of --scope: an absolute path
// so every client resolves the same KB from any working directory.
const kbRoot = workspace?.repoRoot || configRoot;
const serverEnv = {
  KB_MCP_PROFILE: requestedProfile,
  KB_MCP_REPO_ROOT: kbRoot,
  ...(workspace
    ? {
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

function printUsage() {
  console.log(`Configure the GKE MCP server for local agent clients.

Usage:
  node scripts/configure-mcp.mjs [options]
  gke setup [options]

Options:
  --client <name>          claude | codex | gemini | github-copilot | all (default: all)
  --scope <scope>          project (default) | user
  --profile <name>         core (default) | full
  --writes | --no-writes   Enable or disable canonical writes
  --workspace <id>         Register a separately named vault adapter
  --workspace-root <path>  Root for --workspace, required on first registration
  --list-workspaces        Print the registered vaults and exit
  --force                  Repoint an existing user-scope entry at a new knowledge base
  --skip-smoke             Skip the handshake verification
  --help                   Show this message

Scope:
  project  Writes config inside the workspace. Only clients opened in that
           folder see the server.
  user     Writes each client's home config. Clients see the server from every
           folder, still grounded against this workspace's absolute path.

Examples:
  gke setup
  gke setup --scope user
  gke setup --scope user --workspace client-alpha --workspace-root /path/to/vault`);
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

// Keep one pristine copy of a home-directory config the first time we touch it.
function backupUserConfig(path) {
  if (!existsSync(path)) return;
  const backupPath = `${path}.gke-backup`;
  if (existsSync(backupPath)) return;
  copyFileSync(path, backupPath);
  console.log(`  backed up ${path} → ${backupPath}`);
}

function vscodeUserConfigPath() {
  if (process.platform === "darwin") {
    return join(homeRoot, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (process.platform === "win32") {
    const appData =
      !process.env.GKE_MCP_HOME && process.env.APPDATA
        ? resolve(process.env.APPDATA)
        : join(homeRoot, "AppData", "Roaming");
    return join(appData, "Code", "User", "mcp.json");
  }
  return join(homeRoot, ".config", "Code", "User", "mcp.json");
}

// The knowledge base an existing user-scope registration already points at.
function readUserScopeKbRoot(client) {
  if (client === "claude") {
    return readJson(join(homeRoot, ".claude.json")).mcpServers?.[serverName]?.env?.KB_MCP_REPO_ROOT;
  }
  if (client === "gemini") {
    return readJson(join(homeRoot, ".gemini", "settings.json")).mcpServers?.[serverName]?.env
      ?.KB_MCP_REPO_ROOT;
  }
  if (client === "github-copilot") {
    return readJson(vscodeUserConfigPath()).servers?.[serverName]?.env?.KB_MCP_REPO_ROOT;
  }
  if (client === "codex") {
    const configPath = join(homeRoot, ".codex", "config.toml");
    if (!existsSync(configPath)) return undefined;
    const section = readFileSync(configPath, "utf8").split(`[mcp_servers.${serverName}.env]`)[1];
    const match = section?.match(/^KB_MCP_REPO_ROOT = (".*")$/m);
    return match ? JSON.parse(match[1]) : undefined;
  }
  return undefined;
}

// User-scope server names share one namespace across every folder, so two
// checkouts both registering the default "kb" would silently shadow each other.
function assertNoUserScopeCollision() {
  for (const client of clients) {
    const existing = readUserScopeKbRoot(client);
    if (!existing || existing === kbRoot) continue;
    fail(
      [
        `"${serverName}" is already registered at user scope for ${client}, against a different knowledge base:`,
        `    existing: ${existing}`,
        `    new:      ${kbRoot}`,
        `  Give this vault its own name with --workspace <id> --workspace-root <path>,`,
        `  or pass --force to repoint the existing entry.`,
      ].join("\n"),
    );
  }
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
      args: serverArgs,
      env: serverEnv,
    },
  };
  writeJson(mcpPath, mcp);
}

function configureClaude() {
  if (userScope) {
    step("Registering with Claude Code at user scope (~/.claude.json)…");
    const settingsPath = join(homeRoot, ".claude.json");
    backupUserConfig(settingsPath);
    const settings = readJson(settingsPath);
    // Top-level mcpServers is Claude Code's user scope: available in every
    // directory, and not subject to per-project .mcp.json approval.
    settings.mcpServers = {
      ...(settings.mcpServers ?? {}),
      [serverName]: {
        type: "stdio",
        command: nodeBin,
        args: serverArgs,
        env: serverEnv,
      },
    };
    writeJson(settingsPath, settings);
    return;
  }
  step("Approving the shared entry for Claude Code (.claude/settings.local.json)…");
  const settingsPath = join(configRoot, ".claude", "settings.local.json");
  const settings = readJson(settingsPath);
  const approved = new Set(settings.enabledMcpjsonServers ?? []);
  approved.add(serverName);
  settings.enabledMcpjsonServers = [...approved];
  writeJson(settingsPath, settings);
}

function configureCodex() {
  const configPath = userScope
    ? join(homeRoot, ".codex", "config.toml")
    : join(configRoot, ".codex", "config.toml");
  step(`Configuring Codex (${userScope ? "~/.codex/config.toml" : ".codex/config.toml"})…`);
  if (userScope) backupUserConfig(configPath);
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const envLines = [
    `[mcp_servers.${serverName}.env]`,
    `KB_MCP_PROFILE = ${quoteToml(requestedProfile)}`,
    `KB_MCP_REPO_ROOT = ${quoteToml(kbRoot)}`,
  ];
  if (workspace) {
    envLines.push(`KB_MCP_WORKSPACE_ID = ${quoteToml(workspace.id)}`);
    envLines.push(`KB_MCP_WORKSPACE_READ_ONLY = ${quoteToml(String(workspace.readOnly))}`);
  }
  if (enableWrites) envLines.push(`KB_MCP_ENABLE_WRITES = "true"`);
  const envBlock = `\n${envLines.join("\n")}\n`;
  const block = [
    managedTomlStart(serverName),
    `[mcp_servers.${serverName}]`,
    `command = ${quoteToml(nodeBin)}`,
    `args = [${serverArgs.map(quoteToml).join(", ")}]`,
    envBlock.trimEnd(),
    managedTomlEnd(serverName),
  ]
    .filter(Boolean)
    .join("\n");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, replaceManagedTomlBlock(current, block, serverName));
}

function configureGemini() {
  const settingsPath = userScope
    ? join(homeRoot, ".gemini", "settings.json")
    : join(configRoot, ".gemini", "settings.json");
  step(
    `Configuring Gemini CLI (${userScope ? "~/.gemini/settings.json" : ".gemini/settings.json"})…`,
  );
  if (userScope) backupUserConfig(settingsPath);
  const settings = readJson(settingsPath);
  settings.mcpServers = {
    ...(settings.mcpServers ?? {}),
    [serverName]: {
      command: nodeBin,
      args: serverArgs,
      cwd: kbRoot,
      env: serverEnv,
    },
  };
  writeJson(settingsPath, settings);
}

function configureGithubCopilot() {
  const settingsPath = userScope ? vscodeUserConfigPath() : join(configRoot, ".vscode", "mcp.json");
  step(`Configuring GitHub Copilot in VS Code (${userScope ? settingsPath : ".vscode/mcp.json"})…`);
  if (userScope) backupUserConfig(settingsPath);
  const settings = readJson(settingsPath);
  settings.servers = {
    ...(settings.servers ?? {}),
    [serverName]: {
      type: "stdio",
      command: nodeBin,
      args: serverArgs,
      env: serverEnv,
    },
  };
  writeJson(settingsPath, settings);
}

// 1. Dependencies -------------------------------------------------------------
if (!useCompiledRuntime && !existsSync(tsxEntry)) {
  step("Installing dependencies (npm install)…");
  execFileSync(isWindows ? "npm.cmd" : "npm", ["install"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
if (!useCompiledRuntime && !existsSync(tsxEntry)) {
  console.error(`\n✗ tsx not found at ${tsxEntry} even after npm install. Aborting.`);
  process.exit(1);
}
if (!existsSync(serverEntry)) {
  console.error(`\n✗ Server entry not found at ${serverEntry}. Aborting.`);
  process.exit(1);
}

// 2. Client adapters ----------------------------------------------------------
if (userScope && !forceScope) {
  assertNoUserScopeCollision();
}

// .mcp.json is project scope by definition — user scope registers each client
// in its own home config instead.
if (!userScope && (clients.includes("claude") || clients.includes("github-copilot"))) {
  configureSharedMcpJson();
}
for (const client of clients) {
  if (client === "claude") configureClaude();
  if (client === "codex") configureCodex();
  if (client === "gemini") configureGemini();
  if (client === "github-copilot") configureGithubCopilot();
}

// 3. Ignore generated machine-specific files ---------------------------------
// User scope writes nothing inside the checkout except the workspace registry.
if (userScope) {
  step("Updating .gitignore…");
  ensureGitignore([".gke/workspaces.json"]);
} else {
  step("Updating .gitignore…");
  ensureGitignore([
    ".gke/workspaces.json",
    ".mcp.json",
    ".claude/settings.local.json",
    ".codex/config.toml",
    ".gemini/settings.json",
    ".vscode/mcp.json",
  ]);
}

// 4. Verify the one shared server ---------------------------------------------
if (skipSmoke) {
  console.log("\n(skipping smoke test)");
} else {
  step("Verifying the shared MCP server handshake…");
  try {
    execFileSync(nodeBin, useCompiledRuntime ? [smokeTestEntry] : [tsxEntry, smokeTestEntry], {
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
   Scope: ${userScope ? "user (available from every folder)" : "project (this checkout only)"}
   Knowledge base: ${kbRoot}
   Restart the configured client(s)${userScope ? "" : " from this workspace"} to load the tools.
`);
