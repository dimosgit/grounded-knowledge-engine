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
import { createProjectApplicationService } from "../../../tools/projects/project-application-service.js";
import { ProjectLifecycleError } from "../../../tools/projects/project-lifecycle.js";

const LIFECYCLE_PATH = "/__board/lifecycle";
const MAX_REQUEST_BODY_BYTES = 4 * 1024;

export interface LifecycleWritebackPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
}

type LifecycleWritebackRequestOptions = Omit<LifecycleWritebackPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

export function createLifecycleWritebackPlugin(options: LifecycleWritebackPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));
  return {
    name: "board-lifecycle-writeback",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) => handleLifecycleWritebackRequest(req, res, { repoRoot, workspace }))
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Lifecycle writeback middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Lifecycle writeback request failed.",
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

export async function handleLifecycleWritebackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: LifecycleWritebackRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== LIFECYCLE_PATH) return false;

  try {
    const method = (req.method || "GET").toUpperCase();
    assertLocalRequest(getLocalRequestIdentity(req), method !== "GET" && method !== "HEAD");
    if (method !== "POST") throw methodNotAllowed("POST");

    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Lifecycle writeback",
    });
    assertOnlyKeys(body, ["path", "lifecycle"]);

    const service = createProjectApplicationService(options);
    const result = await service.setLifecycle({ path: body.path, lifecycle: body.lifecycle });
    sendJson(res, 200, { ok: true, path: result.path, lifecycle: result.lifecycle });
    return true;
  } catch (error) {
    sendLifecycleError(res, error);
    return true;
  }
}

function sendLifecycleError(res: ServerResponse, error: unknown): void {
  if (error instanceof ProjectLifecycleError) {
    sendJson(res, error.code === "not_found" ? 404 : 400, {
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof Error && /workspace is read-only/i.test(error.message)) {
    sendJson(res, 403, { error: "Workspace is read-only.", code: "workspace_read_only" });
    return;
  }
  sendJson(res, 500, {
    error: "Lifecycle writeback request failed.",
    code: "internal_error",
  });
}
