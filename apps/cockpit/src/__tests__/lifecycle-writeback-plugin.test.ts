/// <reference types="node" />

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createLifecycleWritebackPlugin,
  handleLifecycleWritebackRequest,
} from "../../scripts/lifecycle-writeback-plugin";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface JsonResponseBody {
  [key: string]: unknown;
  code?: string;
  error?: string;
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

describe("project lifecycle writeback dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createLifecycleWritebackPlugin({ repoRoot: "/tmp/example" });
    expect(plugin.name).toBe("board-lifecycle-writeback");
    expect(plugin.apply).toBe("serve");
  });

  test("updates a canonical project and returns hardened JSON headers", async () => {
    const repoRoot = await makeWorkspace();
    const relPath = "kb/projects/local/project.md";
    await writeWorkspaceFile(repoRoot, relPath, "---\nlifecycle: next\n---\n\n# Local\n");
    const server = await startServer(repoRoot);

    const response = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: relPath, lifecycle: " ACTIVE " },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, path: relPath, lifecycle: "active" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(await fs.readFile(path.join(repoRoot, relPath), "utf8")).toContain("lifecycle: active");
  });

  test("preserves logical kb-to-demo-kb source resolution", async () => {
    const repoRoot = await makeWorkspace();
    const physicalPath = "demo-kb/projects/demo/project.md";
    await writeWorkspaceFile(repoRoot, physicalPath, "---\nlifecycle: next\n---\n\n# Demo\n");
    const server = await startServer(repoRoot);

    const response = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/demo/project.md", lifecycle: "completed" },
    });

    expect(response.status).toBe(200);
    expect(await fs.readFile(path.join(repoRoot, physicalPath), "utf8")).toContain(
      "lifecycle: completed",
    );
  });

  test("requires loopback, same-origin JSON mutations", async () => {
    const repoRoot = await makeWorkspace();
    const relPath = "kb/projects/local/project.md";
    await writeWorkspaceFile(repoRoot, relPath, "# Local\n");
    const server = await startServer(repoRoot);
    const body = { path: relPath, lifecycle: "active" };

    const missingOrigin = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body,
      origin: false,
    });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("invalid_origin");

    const crossOrigin = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body,
      originValue: "http://localhost:9999",
    });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.code).toBe("invalid_origin");

    const wrongScheme = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body,
      originValue: baseUrlWithScheme(server.baseUrl, "https:"),
    });
    expect(wrongScheme.status).toBe(403);
    expect(wrongScheme.body.code).toBe("invalid_origin");

    const wrongContentType = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body,
      contentType: "text/plain",
    });
    expect(wrongContentType.status).toBe(415);
    expect(wrongContentType.body.code).toBe("invalid_content_type");
  });

  test("rejects oversized bodies and unknown or malformed fields", async () => {
    const repoRoot = await makeWorkspace();
    const server = await startServer(repoRoot);

    const oversized = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/local/project.md", lifecycle: "", padding: "x".repeat(5_000) },
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe("body_too_large");

    const unknownField = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/local/project.md", lifecycle: "active", extra: true },
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.code).toBe("invalid_body");

    const invalidLifecycle = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/local/project.md", lifecycle: { value: "active" } },
    });
    expect(invalidLifecycle.status).toBe(400);
    expect(invalidLifecycle.body.code).toBe("invalid_lifecycle");
  });

  test("confines resolved files to the allowed physical roots", async () => {
    const repoRoot = await makeWorkspace();
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-lifecycle-outside-"));
    cleanupTasks.push(() => fs.rm(outsideRoot, { recursive: true, force: true }));
    const outsideFile = path.join(outsideRoot, "project.md");
    await fs.writeFile(outsideFile, "# Outside\n", "utf8");
    const symlinkPath = path.join(repoRoot, "kb/projects/escaped.md");
    await fs.mkdir(path.dirname(symlinkPath), { recursive: true });
    await fs.symlink(outsideFile, symlinkPath);
    const server = await startServer(repoRoot);

    const response = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/escaped.md", lifecycle: "active" },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_path");
    expect(await fs.readFile(outsideFile, "utf8")).toBe("# Outside\n");
  });

  test("rejects lifecycle mutations in a read-only workspace", async () => {
    const repoRoot = await makeWorkspace();
    const relPath = "kb/projects/read-only/project.md";
    const original = "---\nlifecycle: next\n---\n\n# Read only\n";
    await writeWorkspaceFile(repoRoot, relPath, original);
    const server = await startServer(repoRoot, true);

    const response = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: relPath, lifecycle: "active" },
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("workspace_read_only");
    expect(await fs.readFile(path.join(repoRoot, relPath), "utf8")).toBe(original);
  });

  test("does not expose filesystem errors or intercept unrelated routes", async () => {
    const repoRoot = await makeWorkspace();
    const server = await startServer(repoRoot);

    const missing = await requestJson(server.baseUrl, "/__board/lifecycle", {
      method: "POST",
      body: { path: "kb/projects/private-location.md", lifecycle: "active" },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: "Lifecycle source was not found.",
      code: "not_found",
    });
    expect(JSON.stringify(missing.body)).not.toContain(repoRoot);

    const unrelated = await requestJson(server.baseUrl, "/unrelated");
    expect(unrelated.status).toBe(404);
    expect(unrelated.body).toEqual({});
  });
});

async function makeWorkspace(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-lifecycle-plugin-"));
  await fs.mkdir(path.join(repoRoot, "kb"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "demo-kb"), { recursive: true });
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

function baseUrlWithScheme(baseUrl: string, protocol: string): string {
  const url = new URL(baseUrl);
  url.protocol = protocol;
  return url.toString().replace(/\/$/, "");
}

async function writeWorkspaceFile(
  repoRoot: string,
  relPath: string,
  content: string,
): Promise<void> {
  const target = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function startServer(repoRoot: string, readOnly = false): Promise<TestServer> {
  const workspace = await loadWorkspaceContext({
    repoRoot,
    scanRoots: ["demo-kb", "kb"],
    writeRoots: ["demo-kb", "kb", ".gke"],
    environment: { KB_MCP_WORKSPACE_READ_ONLY: String(readOnly) },
  });
  const server = http.createServer((req, res) => {
    void handleLifecycleWritebackRequest(req, res, { repoRoot, workspace }).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a port.");
  const testServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  cleanupTasks.push(testServer.close);
  return testServer;
}

async function requestJson(
  baseUrl: string,
  requestPath: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    origin?: boolean;
    originValue?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; body: JsonResponseBody; headers: http.IncomingHttpHeaders }> {
  const target = new URL(requestPath, baseUrl);
  const rawBody = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (options.method === "POST") {
    headers["content-type"] = options.contentType || "application/json";
    headers["content-length"] = String(Buffer.byteLength(rawBody));
    if (options.origin !== false) headers.origin = options.originValue || baseUrl;
  }

  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      { method: options.method || "GET", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode || 0,
            body: raw ? (JSON.parse(raw) as JsonResponseBody) : {},
            headers: response.headers,
          });
        });
      },
    );
    request.once("error", reject);
    if (rawBody) request.write(rawBody);
    request.end();
  });
}
