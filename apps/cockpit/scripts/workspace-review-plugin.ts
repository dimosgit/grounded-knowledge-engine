import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { ReviewWorkspaceArgs } from "../../../tools/projects/project-review.js";
import type { WorkspaceReviewReport } from "../../../tools/projects/types.js";
import { loadWorkspaceContext } from "../../../tools/workspaces/config.js";
import type { WorkspaceContext } from "../../../tools/workspaces/types.js";
import {
  assertLocalRequest,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  sendJson,
} from "./local-dev-api.js";

const REVIEW_PATH = "/__gke/review";
const REVIEW_QUERY_KEYS = ["asOf", "since"] as const;
const ALLOWED_QUERY_KEYS = new Set<string>(REVIEW_QUERY_KEYS);
const MAX_QUERY_VALUE_LENGTH = 64;
const DEFAULT_TIMEOUT_MS = 8_000;

interface ReviewResult {
  contentText: string;
  structured: WorkspaceReviewReport;
}

export interface WorkspaceReviewPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
  timeoutMs?: number;
  review?: (
    args: ReviewWorkspaceArgs,
    repoRoot: string,
    scanRoots: string[],
    workspace: WorkspaceContext,
  ) => Promise<ReviewResult>;
}

type WorkspaceReviewRequestOptions = Omit<WorkspaceReviewPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

export function createWorkspaceReviewPlugin(options: WorkspaceReviewPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));

  return {
    name: "workspace-review-local-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) =>
            handleWorkspaceReviewRequest(req, res, { ...options, repoRoot, workspace }),
          )
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Workspace review middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Workspace review request failed.",
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

export async function handleWorkspaceReviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WorkspaceReviewRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== REVIEW_PATH) return false;

  try {
    assertLocalRequest(getLocalRequestIdentity(req), false);
    if ((req.method || "GET").toUpperCase() !== "GET") throw methodNotAllowed("GET");
    const args = parseReviewQuery(requestUrl.searchParams);
    const review = options.review || runWorkspaceReview;
    const result = await withTimeout(
      review(args, options.repoRoot, [...options.workspace.scanRoots], options.workspace),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    sendJson(res, 200, { review: result.structured });
    return true;
  } catch (error) {
    sendReviewError(res, error);
    return true;
  }
}

async function runWorkspaceReview(
  args: ReviewWorkspaceArgs,
  repoRoot: string,
  scanRoots: string[],
  workspace: WorkspaceContext,
): Promise<ReviewResult> {
  const { reviewWorkspace } = await import("../../../tools/projects/project-review.js");
  return reviewWorkspace(args, repoRoot, scanRoots, workspace);
}

function parseReviewQuery(searchParams: URLSearchParams): ReviewWorkspaceArgs {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new LocalApiRequestError(400, "invalid_query", "Review query has unknown fields.");
    }
  }
  const args: ReviewWorkspaceArgs = {};
  for (const key of REVIEW_QUERY_KEYS) {
    const values = searchParams.getAll(key);
    if (values.length > 1) {
      throw new LocalApiRequestError(400, "invalid_query", `Review ${key} must appear once.`);
    }
    const value = values[0]?.trim();
    if (!value) continue;
    if (value.length > MAX_QUERY_VALUE_LENGTH) {
      throw new LocalApiRequestError(400, "invalid_query", `Review ${key} is too long.`);
    }
    args[key] = value;
  }
  return args;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new LocalApiRequestError(
                504,
                "review_timeout",
                "Workspace review timed out. Try a narrower date range.",
              ),
            ),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendReviewError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  if (
    error instanceof Error &&
    /must be an ISO date or timestamp|since must not be later than asOf/i.test(error.message)
  ) {
    sendJson(res, 400, { error: error.message, code: "invalid_query" });
    return;
  }
  sendJson(res, 500, { error: "Workspace review request failed.", code: "internal_error" });
}
