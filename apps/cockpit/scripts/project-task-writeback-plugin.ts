import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { completeProjectTask } from "../../../tools/projects/project-service.js";
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

const COMPLETE_TASK_PATH = "/__gke/projects/tasks/complete";
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

export interface ProjectTaskWritebackPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
}

type ProjectTaskWritebackRequestOptions = Omit<ProjectTaskWritebackPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

export function createProjectTaskWritebackPlugin(
  options: ProjectTaskWritebackPluginOptions,
): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));

  return {
    name: "project-task-writeback",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) => handleProjectTaskWritebackRequest(req, res, { repoRoot, workspace }))
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Project task writeback middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Project task writeback request failed.",
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

export async function handleProjectTaskWritebackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ProjectTaskWritebackRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== COMPLETE_TASK_PATH) return false;

  try {
    const method = (req.method || "GET").toUpperCase();
    assertLocalRequest(getLocalRequestIdentity(req), method !== "GET" && method !== "HEAD");
    if (method !== "POST") throw methodNotAllowed("POST");

    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Project task completion",
    });
    assertOnlyKeys(body, ["projectId", "taskText"]);
    const projectId = requireText(body.projectId, "project_id");
    const taskText = requireText(body.taskText, "task_text");
    const result = await completeProjectTask({
      repoRoot: options.repoRoot,
      workspace: options.workspace,
      projectId,
      text: taskText,
    });

    sendJson(res, 200, { result });
    return true;
  } catch (error) {
    sendProjectTaskError(res, error);
    return true;
  }
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000) {
    throw new LocalApiRequestError(400, `invalid_${code}`, `${code} is invalid.`);
  }
  return value.trim();
}

function sendProjectTaskError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof Error && /workspace is read-only/i.test(error.message)) {
    sendJson(res, 403, { error: "Workspace is read-only.", code: "workspace_read_only" });
    return;
  }
  if (error instanceof Error && /outside an allowed write root/i.test(error.message)) {
    sendJson(res, 403, {
      error: "Project source is read-only in this workspace.",
      code: "project_read_only",
    });
    return;
  }
  if (
    error instanceof Error &&
    /project task was not found|project not found/i.test(error.message)
  ) {
    sendJson(res, 404, { error: "Project task was not found.", code: "task_not_found" });
    return;
  }
  if (
    error instanceof Error &&
    /project task is ambiguous|already being updated/i.test(error.message)
  ) {
    sendJson(res, 409, { error: error.message, code: "task_conflict" });
    return;
  }
  if (error instanceof Error && /project id|required|canonical/i.test(error.message)) {
    sendJson(res, 400, { error: "Project task request is invalid.", code: "invalid_request" });
    return;
  }
  sendJson(res, 500, {
    error: "Project task writeback request failed.",
    code: "internal_error",
  });
}
