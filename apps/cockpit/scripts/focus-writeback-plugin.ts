import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { loadWorkspaceContext } from "../../../tools/workspaces/config.js";
import type { WorkspaceContext } from "../../../tools/workspaces/types.js";
import {
  assertLocalRequest,
  assertOnlyKeys,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  readJsonObject,
  sendJson,
} from "./local-dev-api.js";

const FOCUS_WRITE_PATH = "/__gke/focus";
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const AREA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DOCUMENT_PATH = /^kb\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/;
const MAX_FOCUS_RECORDS = 24;
const MAX_LINKED_PROJECTS = 160;
const MAX_LINKED_DOCUMENTS = 320;
const MAX_FOCUS_TASKS = 24;

type FocusAction = "add-record" | "add-task" | "make-current" | "move" | "remove";

export interface FocusWritebackPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
}

type FocusWritebackRequestOptions = Omit<FocusWritebackPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

interface MutableFocusArea {
  id: string;
  label?: string;
  projectIds: string[];
  documentPaths: string[];
  focusTasks: Array<{ id: string; title: string }>;
  focusRecordIds: string[];
  raw: Record<string, unknown>;
}

const focusWriteQueues = new Map<string, Promise<void>>();

/**
 * Local-only Focus editor. It deliberately updates just `.gke/workspace.json`
 * through Vite's loopback middleware, never a deployed Cockpit build.
 */
export function createFocusWritebackPlugin(options: FocusWritebackPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));

  return {
    name: "focus-writeback",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) => handleFocusWritebackRequest(req, res, { repoRoot, workspace }))
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Focus writeback middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Focus update failed.",
                code: "internal_error",
              });
            } else {
              res.end();
            }
          });
      });
    },
  };
}

export async function handleFocusWritebackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: FocusWritebackRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== FOCUS_WRITE_PATH) return false;

  try {
    const method = (req.method || "GET").toUpperCase();
    assertLocalRequest(getLocalRequestIdentity(req), method !== "GET" && method !== "HEAD");
    if (method === "GET") {
      if ([...requestUrl.searchParams.keys()].length) {
        throw new LocalApiRequestError(400, "invalid_query", "Focus settings take no query.");
      }
      const config = await readWorkspaceConfig(
        path.join(options.repoRoot, ".gke", "workspace.json"),
      );
      const ui = getMutableObject(config.ui, "ui");
      sendJson(res, 200, { focusAreas: toSafeFocusAreas(getFocusAreas(ui)) });
      return true;
    }
    if (method !== "POST") throw methodNotAllowed("GET, POST");
    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Focus update",
    });
    assertOnlyKeys(body, ["action", "areaId", "recordId", "title", "direction"]);
    const result = await enqueueFocusWrite(options.repoRoot, () =>
      applyFocusMutation(body, options),
    );
    sendJson(res, 200, { focusAreas: result });
    return true;
  } catch (error) {
    sendFocusError(res, error);
    return true;
  }
}

function enqueueFocusWrite<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const previous = focusWriteQueues.get(repoRoot) || Promise.resolve();
  const run: Promise<T> = previous.catch((): void => undefined).then(operation);
  focusWriteQueues.set(
    repoRoot,
    run.then(
      (): void => undefined,
      (): void => undefined,
    ),
  );
  return run;
}

async function applyFocusMutation(
  body: Record<string, unknown>,
  options: FocusWritebackRequestOptions,
): Promise<unknown[]> {
  assertWorkspaceCanWriteFocus(options.workspace);
  const action = requireAction(body.action);
  const areaId = requireAreaId(body.areaId);
  const configPath = path.join(options.repoRoot, ".gke", "workspace.json");
  const config = await readWorkspaceConfig(configPath);
  const ui = getMutableObject(config.ui, "ui");
  const rawAreas = getFocusAreas(ui);
  const area = findArea(rawAreas, areaId);
  if (!area) {
    throw new LocalApiRequestError(404, "area_not_found", "Focus area was not found.");
  }

  switch (action) {
    case "add-record":
      addRecord(area, requireRecordId(body.recordId));
      break;
    case "add-task":
      addTask(area, requireTaskTitle(body.title));
      break;
    case "make-current":
      makeCurrent(area, requireRecordId(body.recordId));
      break;
    case "move":
      moveRecord(area, requireRecordId(body.recordId), requireDirection(body.direction));
      break;
    case "remove":
      removeRecord(area, requireRecordId(body.recordId));
      break;
  }

  writeArea(area);
  await writeWorkspaceConfig(configPath, config);
  return toSafeFocusAreas(rawAreas);
}

function assertWorkspaceCanWriteFocus(workspace: WorkspaceContext): void {
  if (workspace.readOnly) {
    throw new LocalApiRequestError(403, "workspace_read_only", "Workspace is read-only.");
  }
  if (!workspace.writeRoots.includes(".gke")) {
    throw new LocalApiRequestError(
      403,
      "focus_read_only",
      "Focus settings are not writable in this workspace.",
    );
  }
}

async function readWorkspaceConfig(configPath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocalApiRequestError(
        404,
        "focus_config_missing",
        "Focus settings are unavailable.",
      );
    }
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new LocalApiRequestError(400, "focus_config_invalid", "Focus settings are invalid.");
  }
}

function getMutableObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalApiRequestError(400, "focus_config_invalid", `Focus ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function getFocusAreas(ui: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(ui.focusAreas)) {
    throw new LocalApiRequestError(400, "focus_config_invalid", "Focus areas are unavailable.");
  }
  const areas = ui.focusAreas.filter(
    (area): area is Record<string, unknown> =>
      Boolean(area) && typeof area === "object" && !Array.isArray(area),
  );
  if (areas.length !== ui.focusAreas.length) {
    throw new LocalApiRequestError(400, "focus_config_invalid", "Focus areas are invalid.");
  }
  return areas;
}

function findArea(rawAreas: Record<string, unknown>[], areaId: string): MutableFocusArea | null {
  const raw = rawAreas.find((candidate) => normalizeAreaId(candidate.id) === areaId);
  return raw ? normalizeArea(raw) : null;
}

function normalizeArea(raw: Record<string, unknown>): MutableFocusArea {
  const id = normalizeAreaId(raw.id);
  if (!id) {
    throw new LocalApiRequestError(400, "focus_config_invalid", "Focus area is invalid.");
  }
  const projectIds = uniqueStrings(
    raw.projectIds,
    (value) => PROJECT_ID.test(value),
    MAX_LINKED_PROJECTS,
  );
  const documentPaths = uniqueStrings(raw.documentPaths, isDocumentPath, MAX_LINKED_DOCUMENTS);
  const focusTasks = normalizeTasks(raw.focusTasks);
  const validRecordIds = new Set([
    ...projectIds.map((id) => `project:${id}`),
    ...documentPaths.map((documentPath) => `document:${documentPath}`),
    ...focusTasks.map((task) => `task:${task.id}`),
  ]);
  return {
    id,
    projectIds,
    documentPaths,
    focusTasks,
    focusRecordIds: uniqueStrings(
      raw.focusRecordIds,
      (value) => validRecordIds.has(value),
      MAX_FOCUS_RECORDS,
    ),
    raw,
  };
}

function normalizeTasks(value: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tasks: Array<{ id: string; title: string }> = [];
  for (const item of value.slice(0, MAX_FOCUS_TASKS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    const title = normalizeTaskTitle(raw.title);
    if (!TASK_ID.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    tasks.push({ id, title });
  }
  return tasks;
}

function addRecord(area: MutableFocusArea, recordId: string): void {
  const parsed = parseRecordId(recordId);
  if (parsed.kind === "project") {
    if (!area.projectIds.includes(parsed.value) && area.projectIds.length >= MAX_LINKED_PROJECTS) {
      throw new LocalApiRequestError(
        400,
        "focus_limit",
        "This area already has the maximum projects.",
      );
    }
    if (!area.projectIds.includes(parsed.value)) area.projectIds.push(parsed.value);
  } else if (parsed.kind === "document") {
    if (
      !area.documentPaths.includes(parsed.value) &&
      area.documentPaths.length >= MAX_LINKED_DOCUMENTS
    ) {
      throw new LocalApiRequestError(
        400,
        "focus_limit",
        "This area already has the maximum notes.",
      );
    }
    if (!area.documentPaths.includes(parsed.value)) area.documentPaths.push(parsed.value);
  } else {
    throw new LocalApiRequestError(400, "invalid_record", "Tasks are created from the task field.");
  }
  appendFocusRecord(area, recordId);
}

function addTask(area: MutableFocusArea, title: string): void {
  if (area.focusTasks.length >= MAX_FOCUS_TASKS) {
    throw new LocalApiRequestError(
      400,
      "focus_limit",
      "This area already has the maximum focus tasks.",
    );
  }
  const id = `task-${randomUUID().replaceAll("-", "")}`;
  area.focusTasks.push({ id, title });
  appendFocusRecord(area, `task:${id}`);
}

function makeCurrent(area: MutableFocusArea, recordId: string): void {
  assertAreaHasRecord(area, recordId);
  area.focusRecordIds = [recordId, ...area.focusRecordIds.filter((item) => item !== recordId)];
}

function moveRecord(area: MutableFocusArea, recordId: string, direction: "up" | "down"): void {
  assertAreaHasRecord(area, recordId);
  const index = area.focusRecordIds.indexOf(recordId);
  if (index === -1) {
    throw new LocalApiRequestError(404, "focus_record_not_found", "Focus item was not found.");
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= area.focusRecordIds.length) return;
  [area.focusRecordIds[index], area.focusRecordIds[target]] = [
    area.focusRecordIds[target],
    area.focusRecordIds[index],
  ];
}

function removeRecord(area: MutableFocusArea, recordId: string): void {
  const parsed = parseRecordId(recordId);
  assertAreaHasRecord(area, recordId);
  area.focusRecordIds = area.focusRecordIds.filter((item) => item !== recordId);
  if (parsed.kind === "project") {
    area.projectIds = area.projectIds.filter((id) => id !== parsed.value);
  } else if (parsed.kind === "document") {
    area.documentPaths = area.documentPaths.filter((documentPath) => documentPath !== parsed.value);
  } else {
    area.focusTasks = area.focusTasks.filter((task) => task.id !== parsed.value);
  }
}

function assertAreaHasRecord(area: MutableFocusArea, recordId: string): void {
  const parsed = parseRecordId(recordId);
  const exists =
    (parsed.kind === "project" && area.projectIds.includes(parsed.value)) ||
    (parsed.kind === "document" && area.documentPaths.includes(parsed.value)) ||
    (parsed.kind === "task" && area.focusTasks.some((task) => task.id === parsed.value));
  if (!exists) {
    throw new LocalApiRequestError(404, "focus_record_not_found", "Focus item was not found.");
  }
}

function appendFocusRecord(area: MutableFocusArea, recordId: string): void {
  if (area.focusRecordIds.includes(recordId)) return;
  if (area.focusRecordIds.length >= MAX_FOCUS_RECORDS) {
    throw new LocalApiRequestError(
      400,
      "focus_limit",
      "This area already has the maximum focus items.",
    );
  }
  area.focusRecordIds.push(recordId);
}

function writeArea(area: MutableFocusArea): void {
  area.raw.id = area.id;
  setArray(area.raw, "projectIds", area.projectIds);
  setArray(area.raw, "documentPaths", area.documentPaths);
  setArray(area.raw, "focusTasks", area.focusTasks);
  setArray(area.raw, "focusRecordIds", area.focusRecordIds);
}

/** Never return arbitrary `.gke/workspace.json` fields to the browser. */
function toSafeFocusAreas(rawAreas: Record<string, unknown>[]): Array<Record<string, unknown>> {
  return rawAreas.flatMap((raw) => {
    let area: MutableFocusArea;
    try {
      area = normalizeArea(raw);
    } catch {
      return [];
    }
    const label = typeof raw.label === "string" ? raw.label.trim().replace(/\s+/g, " ") : "";
    if (!label || label.length > 80) return [];
    const description =
      typeof raw.description === "string"
        ? raw.description.trim().replace(/\s+/g, " ").slice(0, 240)
        : "";
    const icon =
      raw.icon === "briefcase" || raw.icon === "sparkles" || raw.icon === "graduation-cap"
        ? raw.icon
        : "briefcase";
    return [
      {
        id: area.id,
        label,
        ...(description ? { description } : {}),
        icon,
        ...(area.projectIds.length ? { projectIds: area.projectIds } : {}),
        ...(area.documentPaths.length ? { documentPaths: area.documentPaths } : {}),
        ...(area.focusTasks.length ? { focusTasks: area.focusTasks } : {}),
        ...(area.focusRecordIds.length ? { focusRecordIds: area.focusRecordIds } : {}),
      },
    ];
  });
}

function setArray(value: Record<string, unknown>, key: string, next: unknown[]): void {
  if (next.length) value[key] = next;
  else delete value[key];
}

async function writeWorkspaceConfig(
  configPath: string,
  config: Record<string, unknown>,
): Promise<void> {
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, configPath);
}

function requireAction(value: unknown): FocusAction {
  if (
    value === "add-record" ||
    value === "add-task" ||
    value === "make-current" ||
    value === "move" ||
    value === "remove"
  ) {
    return value;
  }
  throw new LocalApiRequestError(400, "invalid_action", "Focus action is invalid.");
}

function requireAreaId(value: unknown): string {
  const areaId = normalizeAreaId(value);
  if (!areaId) throw new LocalApiRequestError(400, "invalid_area", "Focus area is invalid.");
  return areaId;
}

function normalizeAreaId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AREA_ID.test(id) ? id : "";
}

function requireRecordId(value: unknown): string {
  if (typeof value !== "string") {
    throw new LocalApiRequestError(400, "invalid_record", "Focus item is invalid.");
  }
  const recordId = value.trim();
  parseRecordId(recordId);
  return recordId;
}

function parseRecordId(recordId: string): { kind: "project" | "document" | "task"; value: string } {
  const separator = recordId.indexOf(":");
  const kind = recordId.slice(0, separator);
  const value = recordId.slice(separator + 1);
  if (kind === "project" && PROJECT_ID.test(value)) return { kind, value };
  if (kind === "document" && isDocumentPath(value)) return { kind, value };
  if (kind === "task" && TASK_ID.test(value)) return { kind, value };
  throw new LocalApiRequestError(400, "invalid_record", "Focus item is invalid.");
}

function requireTaskTitle(value: unknown): string {
  const title = normalizeTaskTitle(value);
  if (!title) throw new LocalApiRequestError(400, "invalid_task", "Focus task is invalid.");
  return title;
}

function normalizeTaskTitle(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "";
}

function requireDirection(value: unknown): "up" | "down" {
  if (value === "up" || value === "down") return value;
  throw new LocalApiRequestError(400, "invalid_direction", "Focus move is invalid.");
}

function uniqueStrings(
  value: unknown,
  predicate: (item: string) => boolean,
  limit: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item && predicate(item));
  return [...new Set(normalized)].slice(0, limit);
}

function isDocumentPath(value: string): boolean {
  return (
    value.length <= 240 &&
    !value.includes("\\") &&
    !value.includes("..") &&
    DOCUMENT_PATH.test(value)
  );
}

function sendFocusError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  sendJson(res, 500, { error: "Focus update failed.", code: "internal_error" });
}
