import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { WorkspaceContext } from "../../../tools/workspaces/types.js";
import { isSafeWorkspaceText } from "../src/domain/workspace-display.js";
import {
  assertLocalRequest,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  sendJson,
} from "./local-dev-api.js";

const WORKSPACE_CONTEXT_PATH = "/__gke/workspace/context";

/** The only fields projected out of the immutable workspace context. */
export interface SafeWorkspaceProjection {
  id: string;
  label: string;
  readOnly: boolean;
  sensitivity: WorkspaceContext["sensitivity"];
}

export interface WorkspaceContextPluginOptions {
  /**
   * The single workspace resolved at Vite startup. The adapter never loads the
   * registry and never accepts a workspace ID, so one dev process keeps serving
   * exactly one immutable workspace identity.
   */
  workspace: WorkspaceContext;
}

export function createWorkspaceContextPlugin(options: WorkspaceContextPluginOptions): Plugin {
  return {
    name: "workspace-context-local-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        try {
          if (!handleWorkspaceContextRequest(req, res, options)) next();
        } catch (error) {
          server.config.logger.error(
            `Workspace context middleware failed: ${error instanceof Error ? error.name : "unknown error"}`,
          );
          if (!res.headersSent) {
            sendJson(res, 500, {
              error: "Workspace context request failed.",
              code: "internal_error",
            });
          } else {
            res.end();
          }
        }
      });
    },
  };
}

export function handleWorkspaceContextRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WorkspaceContextPluginOptions,
): boolean {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== WORKSPACE_CONTEXT_PATH) return false;

  try {
    assertLocalRequest(getLocalRequestIdentity(req), false);
    if ((req.method || "GET").toUpperCase() !== "GET") throw methodNotAllowed("GET");
    assertNoQuery(requestUrl.searchParams);
    sendJson(res, 200, { workspace: toSafeWorkspace(options.workspace) });
  } catch (error) {
    if (error instanceof LocalApiRequestError) {
      sendJson(res, error.statusCode, { error: error.message, code: error.code });
    } else {
      sendJson(res, 500, { error: "Workspace context request failed.", code: "internal_error" });
    }
  }
  return true;
}

/**
 * Allowlists four fields by name. The workspace context is never serialized
 * directly, so roots, real roots, domain profile, and UI config cannot leak
 * even if the context type grows new fields.
 */
export function toSafeWorkspace(workspace: WorkspaceContext): SafeWorkspaceProjection {
  const projection = {
    id: workspace.id,
    label: workspace.label,
    readOnly: workspace.readOnly,
    sensitivity: workspace.sensitivity,
  };
  if (!isSafeWorkspaceText(projection.id) || !isSafeWorkspaceText(projection.label)) {
    throw new LocalApiRequestError(500, "invalid_workspace", "Workspace identity is unavailable.");
  }
  return projection;
}

/** The endpoint takes no input at all, so any parameter fails closed. */
function assertNoQuery(searchParams: URLSearchParams): void {
  if ([...searchParams.keys()].length > 0) {
    throw new LocalApiRequestError(
      400,
      "invalid_query",
      "Workspace context takes no query parameters.",
    );
  }
}
