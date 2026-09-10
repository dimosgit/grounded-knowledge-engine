import fs from "node:fs/promises";
import path from "node:path";
import { resolveDomainProfile } from "./domain-profile.js";
import {
  type LoadWorkspaceContextOptions,
  type WorkspaceConfigFile,
  type WorkspaceContext,
  type WorkspaceFocusAreaConfig,
  type WorkspaceFocusAreaIcon,
  type WorkspaceFocusTaskConfig,
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
  const focusAreas = normalizeFocusAreas(config.focusAreas);
  const requestedFocusAreaId =
    typeof config.defaultFocusAreaId === "string" ? config.defaultFocusAreaId.trim() : "";
  const defaultFocusAreaId =
    requestedFocusAreaId && focusAreas.some((area) => area.id === requestedFocusAreaId)
      ? requestedFocusAreaId
      : undefined;
  return Object.freeze({
    ...(sourceFolders ? { sourceFolders: Object.freeze(sourceFolders) } : {}),
    ...(rootFiles ? { rootFiles: Object.freeze(rootFiles) } : {}),
    ...(defaultActiveTrack ? { defaultActiveTrack } : {}),
    ...(focusAreas.length ? { focusAreas: Object.freeze(focusAreas) } : {}),
    ...(defaultFocusAreaId ? { defaultFocusAreaId } : {}),
  });
}

const FOCUS_AREA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const FOCUS_TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AREA_ICONS = new Set<WorkspaceFocusAreaIcon>(["briefcase", "sparkles", "graduation-cap"]);

function normalizeFocusAreas(value: unknown): WorkspaceFocusAreaConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const areas: WorkspaceFocusAreaConfig[] = [];
  for (const candidate of value.slice(0, 12)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    const label = typeof raw.label === "string" ? raw.label.trim().replace(/\s+/g, " ") : "";
    if (!FOCUS_AREA_ID.test(id) || !label || label.length > 80 || seen.has(id)) continue;
    seen.add(id);
    const description =
      typeof raw.description === "string"
        ? raw.description.trim().replace(/\s+/g, " ").slice(0, 240)
        : "";
    const icon = AREA_ICONS.has(raw.icon as WorkspaceFocusAreaIcon)
      ? (raw.icon as WorkspaceFocusAreaIcon)
      : undefined;
    const projectIds = normalizeProjectIds(raw.projectIds);
    const documentPaths = normalizeDocumentPaths(raw.documentPaths);
    const focusTasks = normalizeFocusTasks(raw.focusTasks);
    const focusRecordIds = normalizeFocusRecordIds(
      raw.focusRecordIds,
      projectIds,
      documentPaths,
      focusTasks,
    );
    areas.push(
      Object.freeze({
        id,
        label,
        ...(description ? { description } : {}),
        ...(icon ? { icon } : {}),
        ...(projectIds.length ? { projectIds: Object.freeze(projectIds) } : {}),
        ...(documentPaths.length ? { documentPaths: Object.freeze(documentPaths) } : {}),
        ...(focusTasks.length ? { focusTasks: Object.freeze(focusTasks) } : {}),
        ...(focusRecordIds.length ? { focusRecordIds: Object.freeze(focusRecordIds) } : {}),
      }),
    );
  }
  return areas;
}

function normalizeProjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((item) => `${item}`.trim()).filter((item) => PROJECT_ID.test(item))),
  ].slice(0, 160);
}

function normalizeDocumentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeDocumentPath(item)).filter(Boolean))].slice(
    0,
    320,
  );
}

function normalizeDocumentPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    normalized.includes("..")
  ) {
    return "";
  }
  return normalized.startsWith("kb/") && normalized.endsWith(".md") ? normalized : "";
}

function normalizeFocusTasks(value: unknown): WorkspaceFocusTaskConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tasks: WorkspaceFocusTaskConfig[] = [];
  for (const candidate of value.slice(0, 24)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    const title =
      typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ").slice(0, 240) : "";
    if (!FOCUS_TASK_ID.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    tasks.push(Object.freeze({ id, title }));
  }
  return tasks;
}

function normalizeFocusRecordIds(
  value: unknown,
  projectIds: string[],
  documentPaths: string[],
  focusTasks: WorkspaceFocusTaskConfig[],
): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set([
    ...projectIds.map((id) => `project:${id}`),
    ...documentPaths.map((path) => `document:${path}`),
    ...focusTasks.map((task) => `task:${task.id}`),
  ]);
  return [
    ...new Set(value.map((item) => `${item}`.trim()).filter((item) => valid.has(item))),
  ].slice(0, 24);
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
