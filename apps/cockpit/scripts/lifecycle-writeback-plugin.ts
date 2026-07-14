import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  assertLocalRequest,
  assertOnlyKeys,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  readJsonObject,
  sendJson,
} from "./local-dev-api.js";
import { setLifecycle, VALID_LIFECYCLES } from "./lifecycle-frontmatter.js";

const LIFECYCLE_PATH = "/__board/lifecycle";
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const ALLOWED_ROOTS = ["demo-kb", "kb"] as const;

export interface LifecycleWritebackPluginOptions {
  repoRoot: string;
}

export function createLifecycleWritebackPlugin(options: LifecycleWritebackPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  return {
    name: "board-lifecycle-writeback",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void handleLifecycleWritebackRequest(req, res, { repoRoot })
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
  options: LifecycleWritebackPluginOptions,
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

    const normalizedPath = normalizeLifecyclePath(body.path);
    const lifecycle = normalizeLifecycle(body.lifecycle);
    const targetPath = await resolveLifecycleTarget(options.repoRoot, normalizedPath);
    const original = await fs.readFile(targetPath, "utf8");
    const updated = setLifecycle(original, lifecycle);
    if (updated !== original) await fs.writeFile(targetPath, updated, "utf8");

    sendJson(res, 200, { ok: true, path: normalizedPath, lifecycle });
    return true;
  } catch (error) {
    sendLifecycleError(res, error);
    return true;
  }
}

function normalizeLifecyclePath(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\\/g, "/") : "";
  const segments = normalized.split("/");
  const root = segments[0];
  const valid =
    normalized.endsWith(".md") &&
    !path.posix.isAbsolute(normalized) &&
    segments.length > 1 &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    ALLOWED_ROOTS.includes(root as (typeof ALLOWED_ROOTS)[number]);
  if (!valid) {
    throw new LocalApiRequestError(400, "invalid_path", "Lifecycle path is invalid.");
  }
  return normalized;
}

function normalizeLifecycle(value: unknown): string {
  if (typeof value !== "string") {
    throw new LocalApiRequestError(400, "invalid_lifecycle", "Lifecycle value is invalid.");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "" && !(VALID_LIFECYCLES as readonly string[]).includes(normalized)) {
    throw new LocalApiRequestError(400, "invalid_lifecycle", "Lifecycle value is invalid.");
  }
  return normalized;
}

async function resolveLifecycleTarget(
  repoRootInput: string,
  normalizedPath: string,
): Promise<string> {
  const repoRoot = path.resolve(repoRootInput);
  const candidates = normalizedPath.startsWith("kb/")
    ? [normalizedPath, `demo-kb/${normalizedPath.slice("kb/".length)}`]
    : [normalizedPath];

  for (const candidate of candidates) {
    const candidatePath = path.resolve(repoRoot, candidate);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(candidatePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }

    const rootName = candidate.split("/", 1)[0];
    const realRoot = await fs.realpath(path.join(repoRoot, rootName));
    if (!isWithin(realRoot, realTarget)) {
      throw new LocalApiRequestError(400, "invalid_path", "Lifecycle path is invalid.");
    }
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) {
      throw new LocalApiRequestError(400, "invalid_path", "Lifecycle path is invalid.");
    }
    return realTarget;
  }

  throw new LocalApiRequestError(404, "not_found", "Lifecycle source was not found.");
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function sendLifecycleError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  sendJson(res, 500, {
    error: "Lifecycle writeback request failed.",
    code: "internal_error",
  });
}
