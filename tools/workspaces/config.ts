import fs from "node:fs/promises";
import path from "node:path";
import { resolveDomainProfile } from "./domain-profile.js";
import {
  type LoadWorkspaceContextOptions,
  type WorkspaceConfigFile,
  type WorkspaceContext,
  type WorkspaceSensitivity,
  type WorkspaceUiConfig,
} from "./types.js";

const DEFAULT_SCAN_ROOTS = ["demo-kb", "kb"];
const DEFAULT_WRITE_ROOTS = ["kb", ".gke", ".cache"];
const SENSITIVITIES = new Set<WorkspaceSensitivity>([
  "personal",
  "internal",
  "sensitive",
  "restricted",
]);

/**
 * Load one immutable workspace boundary. Configuration is intentionally read
 * only once by a server process; callers must start another process to select
 * a different workspace.
 */
export async function loadWorkspaceContext(
  options: LoadWorkspaceContextOptions = {},
): Promise<WorkspaceContext> {
  const environment = options.environment ?? process.env;
  const requestedRoot = options.repoRoot ?? environment.KB_MCP_REPO_ROOT ?? process.cwd();
  const repoRoot = path.resolve(requestedRoot);
  let realRepoRoot: string;
  try {
    realRepoRoot = await fs.realpath(repoRoot);
  } catch {
    throw new Error("Workspace root does not exist or cannot be resolved.");
  }

  const config = await readWorkspaceConfig(repoRoot);
  const scanRoots = normalizeRoots(
    config?.scanRoots ?? options.scanRoots ?? environment.KB_MCP_SCAN_ROOTS ?? DEFAULT_SCAN_ROOTS,
    "scan",
  );
  const writeRoots = normalizeRoots(
    config?.writeRoots ??
      options.writeRoots ??
      environment.KB_MCP_WRITE_ROOTS ??
      DEFAULT_WRITE_ROOTS,
    "write",
  );
  const realScanRoots = await resolveRoots(repoRoot, realRepoRoot, scanRoots, "scan");
  const realWriteRoots = await resolveRoots(repoRoot, realRepoRoot, writeRoots, "write");
  const id = normalizeIdentifier(config?.id ?? environment.KB_MCP_WORKSPACE_ID ?? "default");
  const label = normalizeLabel(config?.label ?? environment.KB_MCP_WORKSPACE_LABEL ?? id);
  const sensitivity = normalizeSensitivity(
    config?.sensitivity ?? environment.KB_MCP_WORKSPACE_SENSITIVITY ?? "internal",
  );
  const readOnly =
    typeof config?.readOnly === "boolean"
      ? config.readOnly
      : parseBoolean(environment.KB_MCP_WORKSPACE_READ_ONLY, false);

  const domain = resolveDomainProfile(config?.domain);
  const ui = normalizeUiConfig(config?.ui);

  return Object.freeze({
    id,
    label,
    repoRoot,
    realRepoRoot,
    scanRoots: Object.freeze(scanRoots),
    realScanRoots: Object.freeze(realScanRoots),
    writeRoots: Object.freeze(writeRoots),
    realWriteRoots: Object.freeze(realWriteRoots),
    readOnly,
    sensitivity,
    domain,
    ui,
  });
}

async function readWorkspaceConfig(repoRoot: string): Promise<WorkspaceConfigFile | null> {
  const configPath = path.join(repoRoot, ".gke", "workspace.json");
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Workspace configuration cannot be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Workspace configuration must be a JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workspace configuration must be a JSON object.");
  }
  return validateWorkspaceConfig(parsed);
}

function validateWorkspaceConfig(value: object): WorkspaceConfigFile {
  const config = value as Record<string, unknown>;
  assertOptionalString(config, "id");
  assertOptionalString(config, "label");
  assertOptionalStringArray(config, "scanRoots");
  assertOptionalStringArray(config, "writeRoots");
  assertOptionalString(config, "sensitivity");
  if ("readOnly" in config && typeof config.readOnly !== "boolean") {
    throw new Error("Workspace configuration readOnly must be a boolean.");
  }
  assertOptionalObject(config, "domain");
  assertOptionalObject(config, "ui");
  return config as WorkspaceConfigFile;
}

function assertOptionalObject(config: Record<string, unknown>, field: string): void {
  if (!(field in config)) return;
  const value = config[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Workspace configuration ${field} must be an object.`);
  }
}

function normalizeUiConfig(value: unknown): WorkspaceUiConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  const config = value as WorkspaceUiConfig;
  const sourceFolders = Array.isArray(config.sourceFolders)
    ? config.sourceFolders
        .filter((item) => item && typeof item.from === "string" && item.from.trim())
        .map((item) => Object.freeze({ from: item.from.trim(), to: (item.to ?? item.from).trim() }))
    : undefined;
  const rootFiles = Array.isArray(config.rootFiles)
    ? config.rootFiles.map((item) => `${item}`.trim()).filter(Boolean)
    : undefined;
  const defaultActiveTrack =
    typeof config.defaultActiveTrack === "string" && config.defaultActiveTrack.trim()
      ? config.defaultActiveTrack.trim()
      : undefined;
  return Object.freeze({
    ...(sourceFolders ? { sourceFolders: Object.freeze(sourceFolders) } : {}),
    ...(rootFiles ? { rootFiles: Object.freeze(rootFiles) } : {}),
    ...(defaultActiveTrack ? { defaultActiveTrack } : {}),
  });
}

function assertOptionalString(config: Record<string, unknown>, field: string): void {
  if (field in config && typeof config[field] !== "string") {
    throw new Error(`Workspace configuration ${field} must be a string.`);
  }
}

function assertOptionalStringArray(config: Record<string, unknown>, field: string): void {
  if (!(field in config)) return;
  const value = config[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Workspace configuration ${field} must be an array of strings.`);
  }
}

function normalizeRoots(value: string[] | string, kind: "scan" | "write"): string[] {
  const values = Array.isArray(value) ? value : value.split(",");
  const roots = [...new Set(values.map((item) => normalizeRoot(item, kind)))];
  if (!roots.length) throw new Error(`Workspace ${kind} roots cannot be empty.`);
  return roots;
}

function normalizeRoot(value: string, kind: "scan" | "write"): string {
  const raw = `${value ?? ""}`.trim().replaceAll("\\", "/");
  if (!raw) throw new Error(`Workspace ${kind} roots cannot contain an empty path.`);
  if (path.isAbsolute(raw) || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error(`Workspace ${kind} roots must be workspace-relative.`);
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\/+/, ""));
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Workspace ${kind} roots cannot traverse outside the workspace.`);
  }
  if (kind === "scan" && normalized.split("/").some((part) => part === ".gke")) {
    throw new Error("Workspace scan roots cannot include operational state.");
  }
  return normalized;
}

async function resolveRoots(
  repoRoot: string,
  realRepoRoot: string,
  roots: string[],
  kind: "scan" | "write",
): Promise<string[]> {
  const resolved: string[] = [];
  for (const root of roots) {
    const logicalPath = path.resolve(repoRoot, root);
    assertContained(repoRoot, logicalPath, kind);
    const canonicalPath = path.resolve(realRepoRoot, root);
    try {
      const realPath = await fs.realpath(canonicalPath);
      assertContained(realRepoRoot, realPath, kind);
      resolved.push(realPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (kind === "scan") {
        throw new Error(
          "Configured workspace scan root does not exist. Update the workspace configuration.",
        );
      }
      // A write root may be created lazily. It is still lexically confined here
      // and its nearest existing parent is checked before every write.
      resolved.push(canonicalPath);
    }
  }
  return resolved;
}

function assertContained(root: string, target: string, kind: "scan" | "write"): void {
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Configured workspace ${kind} root resolves outside the workspace.`);
}

function normalizeIdentifier(value: unknown): string {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw new Error("Workspace ID must be a lowercase slug.");
  }
  return normalized;
}

function normalizeLabel(value: unknown): string {
  const normalized = `${value ?? ""}`.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) throw new Error("Workspace label is invalid.");
  return normalized;
}

function normalizeSensitivity(value: unknown): WorkspaceSensitivity {
  const normalized = `${value ?? ""}`.trim().toLowerCase() as WorkspaceSensitivity;
  if (!SENSITIVITIES.has(normalized)) throw new Error("Workspace sensitivity is invalid.");
  return normalized;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("Workspace read-only setting is invalid.");
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  throw new Error("Workspace read-only setting is invalid.");
}
