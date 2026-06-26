#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { authenticate } from "./auth.js";

/**
 * Loopback-only Streamable HTTP bridge for the GKE MCP server.
 *
 * This reuses the exact stdio dispatch (`handleRequest`/`handleNotification`
 * from server.ts) so transport behavior stays in parity. On top of that it
 * layers tunnel-safety guarantees required by the remote-MCP proof of concept:
 *
 *   - Binds to 127.0.0.1 only. An external HTTPS endpoint must come from an
 *     approved tunnel client (e.g. `ngrok http`), never from this process.
 *   - Forces read-only: writes are disabled in the imported server and any
 *     non-read tool is refused at the HTTP boundary regardless of local config.
 *   - Requires API-key auth on /mcp (constant-time, see auth.ts).
 *   - Applies body-size, concurrency, and request-timeout limits.
 *   - Strips absolute host filesystem paths from responses.
 *
 * It intentionally does not implement sessions or server-initiated SSE; it runs
 * stateless, which is sufficient for Copilot Studio / declarative-agent reads.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type JsonObject = Record<string, unknown>;
type Dispatch = {
  handleRequest: (method: string, params: JsonObject) => Promise<unknown>;
  handleNotification: (method: string, params: JsonObject) => Promise<void>;
};

interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  [key: string]: unknown;
}

export interface HttpServerConfig {
  maxBodyBytes?: number;
  maxConcurrent?: number;
  requestTimeoutMs?: number;
  repoRoot?: string;
  log?: (entry: LogEntry) => void;
}

// Methods that are safe to expose remotely. All are read-only; mutation methods
// are simply absent and fall through to "method not found".
const ALLOWED_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
]);

function defaultLog(entry: LogEntry): void {
  // Structured single-line logs to stderr. Never includes request bodies or
  // secrets — only method names, status, and timing.
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

export async function createMcpHttpServer(config: HttpServerConfig = {}): Promise<http.Server> {
  const log = config.log ?? defaultLog;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const repoRoot = path.resolve(
    config.repoRoot || process.env.KB_MCP_REPO_ROOT || path.join(__dirname, "..", ".."),
  );

  // Force the imported server into read-only mode before it evaluates env.
  // The dynamic import guarantees this runs first; server.ts reads
  // KB_MCP_ENABLE_WRITES at module load.
  process.env.KB_MCP_ENABLE_WRITES = "false";
  const dispatch = (await import("./server.js")) as unknown as Dispatch;

  const readOnlyToolNames = await computeReadOnlyToolNames(dispatch);

  let inFlight = 0;

  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    const method = req.method || "GET";
    const url = (req.url || "/").split("?")[0];

    const finish = (status: number, event: string, extra: Record<string, unknown> = {}) => {
      log({
        level: status >= 500 ? "error" : "info",
        event,
        method,
        url,
        status,
        durMs: Date.now() - startedAt,
        ...extra,
      });
    };

    // Liveness probe — unauthenticated, no knowledge data.
    if (method === "GET" && url === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      finish(200, "healthz");
      return;
    }

    if (url !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      finish(404, "not_found");
      return;
    }

    // Stateless server: no server-initiated SSE stream on GET.
    if (method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "Method not allowed" });
      finish(405, "method_not_allowed");
      return;
    }

    const auth = authenticate(req.headers as Record<string, string | string[] | undefined>);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.reason });
      finish(auth.status, "auth_rejected");
      return;
    }

    if (inFlight >= maxConcurrent) {
      res.setHeader("Retry-After", "1");
      sendJson(res, 503, { error: "Server busy" });
      finish(503, "overloaded");
      return;
    }

    readJsonBody(req, maxBodyBytes)
      .then(async (parsed) => {
        if (parsed.tooLarge) {
          sendJson(res, 413, jsonRpcError(null, -32600, "Request body too large"));
          finish(413, "body_too_large");
          return;
        }
        if (parsed.value === undefined) {
          sendJson(res, 400, jsonRpcError(null, -32700, "Parse error"));
          finish(400, "parse_error");
          return;
        }

        inFlight += 1;
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            sendJson(res, 504, jsonRpcError(null, -32603, "Request timeout"));
            finish(504, "timeout");
          }
        }, requestTimeoutMs);

        try {
          const messages = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
          const responses: unknown[] = [];
          for (const message of messages) {
            const response = await handleMessage(message, dispatch, readOnlyToolNames, log);
            if (response !== undefined) responses.push(response);
          }

          clearTimeout(timer);
          if (res.writableEnded) return; // timed out already

          if (responses.length === 0) {
            res.writeHead(202).end();
            finish(202, "accepted");
            return;
          }
          const body = Array.isArray(parsed.value) ? responses : responses[0];
          sendJson(res, 200, sanitizePaths(body, repoRoot));
          finish(200, "mcp");
        } catch (error) {
          clearTimeout(timer);
          if (!res.writableEnded) {
            sendJson(res, 500, jsonRpcError(null, -32603, "Internal error"));
            finish(500, "internal_error", { message: safeMessage(error) });
          }
        } finally {
          inFlight -= 1;
        }
      })
      .catch((error) => {
        if (!res.writableEnded) {
          sendJson(res, 400, jsonRpcError(null, -32700, "Parse error"));
          finish(400, "read_error", { message: safeMessage(error) });
        }
      });
  });

  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = requestTimeoutMs;
  return server;
}

async function computeReadOnlyToolNames(dispatch: Dispatch): Promise<Set<string>> {
  const result = (await dispatch.handleRequest("tools/list", {})) as {
    tools?: Array<{ name?: string; annotations?: { readOnlyHint?: boolean } }>;
  };
  const names = new Set<string>();
  for (const tool of result.tools ?? []) {
    if (tool.name && tool.annotations?.readOnlyHint === true) names.add(tool.name);
  }
  return names;
}

async function handleMessage(
  raw: unknown,
  dispatch: Dispatch,
  readOnlyToolNames: Set<string>,
  log: (entry: LogEntry) => void,
): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }
  const message = raw as { id?: unknown; method?: unknown; params?: unknown };
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? (message.id as string | number | null) : null;
  const method = typeof message.method === "string" ? message.method : "";
  const params: JsonObject =
    message.params && typeof message.params === "object" && !Array.isArray(message.params)
      ? (message.params as JsonObject)
      : {};

  if (!method) {
    return hasId ? jsonRpcError(id, -32600, "Invalid Request: missing method") : undefined;
  }

  // Notifications (no id) get no response.
  if (!hasId) {
    try {
      await dispatch.handleNotification(method, params);
    } catch (error) {
      log({ level: "warn", event: "notification_failed", method, message: safeMessage(error) });
    }
    return undefined;
  }

  if (!ALLOWED_METHODS.has(method)) {
    return jsonRpcError(id, -32601, `Method not available over remote transport: ${method}`);
  }

  try {
    if (method === "tools/list") {
      const result = (await dispatch.handleRequest(method, params)) as {
        tools?: Array<{ name?: string }>;
      };
      const tools = (result.tools ?? []).filter((t) => t.name && readOnlyToolNames.has(t.name));
      return jsonRpcResult(id, { tools });
    }

    if (method === "tools/call") {
      const toolName = typeof params.name === "string" ? params.name : "";
      if (!readOnlyToolNames.has(toolName)) {
        // Refuse mutation/unknown tools without executing them.
        return jsonRpcResult(id, {
          isError: true,
          content: [
            {
              type: "text",
              text: `Tool '${toolName}' is not available over the read-only remote transport.`,
            },
          ],
        });
      }
    }

    const result = await dispatch.handleRequest(method, params);
    return jsonRpcResult(id, result);
  } catch (error) {
    return jsonRpcError(id, toErrorCode(error), safeMessage(error));
  }
}

interface BodyResult {
  value?: unknown;
  tooLarge?: boolean;
}

function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        resolve({ tooLarge: true });
        // Drain the rest of the body instead of destroying the socket, so the
        // 413 response can still be written back to the client.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({ value: undefined });
        return;
      }
      try {
        resolve({ value: JSON.parse(text) });
      } catch {
        resolve({ value: undefined });
      }
    });
    req.on("error", (error) => {
      if (!aborted) reject(error);
    });
  });
}

/**
 * Recursively replace absolute host paths under repoRoot with workspace-relative
 * forms so remote clients never receive host filesystem locations.
 */
function sanitizePaths<T>(value: T, repoRoot: string): T {
  const prefix = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      return input.split(prefix).join("").split(repoRoot).join("");
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input)) out[key] = walk(val);
      return out;
    }
    return input;
  };
  return walk(value) as T;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function jsonRpcResult(id: string | number | null, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toErrorCode(error: unknown): number {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (Number.isInteger(code)) return code as number;
  }
  return -32603;
}

function safeMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

async function main(): Promise<void> {
  const host = process.env.KB_MCP_HTTP_HOST || DEFAULT_HOST;
  const port = Number.parseInt(process.env.KB_MCP_HTTP_PORT || `${DEFAULT_PORT}`, 10);

  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    process.stderr.write(
      `[kb-mcp-http] refusing to bind non-loopback host '${host}'. ` +
        `Use an approved tunnel client for external access.\n`,
    );
    process.exit(1);
  }
  if (!process.env.KB_MCP_HTTP_API_KEY) {
    process.stderr.write(
      "[kb-mcp-http] KB_MCP_HTTP_API_KEY is not set. Requests will be rejected (503) until you set it.\n",
    );
  }

  const server = await createMcpHttpServer();
  server.listen(port, host, () => {
    process.stderr.write(
      `[kb-mcp-http] read-only MCP bridge listening on http://${host}:${port}/mcp ` +
        `(health: http://${host}:${port}/healthz)\n` +
        `[kb-mcp-http] expose temporarily with:  ngrok http ${port}\n`,
    );
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === __filename;
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  main().catch((error) => {
    process.stderr.write(`[kb-mcp-http] fatal: ${safeMessage(error)}\n`);
    process.exit(1);
  });
}
