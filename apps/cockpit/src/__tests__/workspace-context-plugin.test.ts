/// <reference types="node" />
// @vitest-environment node

import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_DOMAIN_PROFILE } from "../../../../tools/workspaces/domain-profile";
import {
  createWorkspaceContextPlugin,
  handleWorkspaceContextRequest,
  toSafeWorkspace,
} from "../../scripts/workspace-context-plugin";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

/**
 * Distinctive fixture paths: every assertion below greps raw response text for
 * these, so a regression that serializes the context object instead of the
 * four-field allowlist fails loudly rather than silently leaking host layout.
 */
const SECRET_REPO_ROOT = "/Users/secret-operator/private-kb-root";
const SECRET_SCAN_ROOT = "/Volumes/secret-operator-scan";
const SECRET_WRITE_ROOT = "/Volumes/secret-operator-write";
const LEAK_MARKERS = [
  SECRET_REPO_ROOT,
  SECRET_SCAN_ROOT,
  SECRET_WRITE_ROOT,
  "secret-operator",
  "repoRoot",
  "realRepoRoot",
  "scanRoots",
  "realScanRoots",
  "writeRoots",
  "realWriteRoots",
];

describe("workspace context dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createWorkspaceContextPlugin({ workspace: testWorkspace() });
    expect(plugin.name).toBe("workspace-context-local-api");
    expect(plugin.apply).toBe("serve");
  });

  test("projects exactly the four safe fields", () => {
    const safe = toSafeWorkspace(testWorkspace());
    expect(safe).toEqual({
      id: "local-operator",
      label: "Local Operator",
      readOnly: false,
      sensitivity: "internal",
    });
    expect(Object.keys(safe).sort()).toEqual(["id", "label", "readOnly", "sensitivity"]);
  });

  test("returns the safe payload with no-store JSON headers", async () => {
    const server = await startServer(testWorkspace());
    const response = await request(server.baseUrl, "/__gke/workspace/context");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.text)).toEqual({
      workspace: {
        id: "local-operator",
        label: "Local Operator",
        readOnly: false,
        sensitivity: "internal",
      },
    });
  });

  test("never emits repository, scan, or write roots", async () => {
    const server = await startServer(testWorkspace());
    const response = await request(server.baseUrl, "/__gke/workspace/context");

    const payload = JSON.parse(response.text) as { workspace: Record<string, unknown> };
    expect(Object.keys(payload.workspace).sort()).toEqual([
      "id",
      "label",
      "readOnly",
      "sensitivity",
    ]);
    for (const marker of LEAK_MARKERS) {
      expect(response.text).not.toContain(marker);
    }
  });

  test("fails closed when the configured identity contains unsafe text", async () => {
    const server = await startServer({
      ...testWorkspace(),
      label: `Client Alpha — ${SECRET_REPO_ROOT}`,
    });
    const response = await request(server.baseUrl, "/__gke/workspace/context");

    expect(response.status).toBe(500);
    expect(JSON.parse(response.text)).toEqual({
      error: "Workspace identity is unavailable.",
      code: "invalid_workspace",
    });
    for (const marker of LEAK_MARKERS) {
      expect(response.text).not.toContain(marker);
    }
  });

  test("rejects every method other than GET", async () => {
    const server = await startServer(testWorkspace());

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await request(server.baseUrl, "/__gke/workspace/context", { method });
      expect(response.status).toBe(405);
      expect(JSON.parse(response.text).code).toBe("method_not_allowed");
    }
  });

  test("rejects non-loopback hosts and cross-origin callers", async () => {
    const server = await startServer(testWorkspace());

    const foreignHost = await request(server.baseUrl, "/__gke/workspace/context", {
      headers: { host: "workspace.example.test" },
    });
    expect(foreignHost.status).toBe(403);
    expect(JSON.parse(foreignHost.text).code).toBe("local_only");

    const foreignOrigin = await request(server.baseUrl, "/__gke/workspace/context", {
      origin: "http://workspace.example.test",
    });
    expect(foreignOrigin.status).toBe(403);
  });

  test("rejects unknown and repeated query parameters", async () => {
    const server = await startServer(testWorkspace());

    for (const query of ["?workspaceId=other", "?id=a&id=b", "?refresh=1"]) {
      const response = await request(server.baseUrl, `/__gke/workspace/context${query}`);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.text).code).toBe("invalid_query");
    }
  });

  test("passes unrelated routes through to the next handler", async () => {
    const server = await startServer(testWorkspace());

    expect((await request(server.baseUrl, "/__gke/workspace")).status).toBe(404);
    expect((await request(server.baseUrl, "/__gke/workspace/context/extra")).status).toBe(404);
    expect((await request(server.baseUrl, "/index.html")).status).toBe(404);
  });

  test("keeps error responses generic and path-free", async () => {
    const server = await startServer(testWorkspace());

    const responses = [
      await request(server.baseUrl, "/__gke/workspace/context", { method: "POST" }),
      await request(server.baseUrl, "/__gke/workspace/context?workspaceId=other"),
      await request(server.baseUrl, "/__gke/workspace/context", {
        headers: { host: "workspace.example.test" },
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      for (const marker of LEAK_MARKERS) {
        expect(response.text).not.toContain(marker);
      }
      expect(response.text).not.toMatch(/(^|")\/(Users|Volumes|home)\//);
    }
  });
});

async function startServer(workspace: WorkspaceContext) {
  const server = http.createServer((req, res) => {
    if (!handleWorkspaceContextRequest(req, res, { workspace })) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const result = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  cleanupTasks.push(result.close);
  return result;
}

function testWorkspace(): WorkspaceContext {
  return {
    id: "local-operator",
    label: "Local Operator",
    repoRoot: SECRET_REPO_ROOT,
    realRepoRoot: SECRET_REPO_ROOT,
    scanRoots: [SECRET_SCAN_ROOT],
    realScanRoots: [SECRET_SCAN_ROOT],
    writeRoots: [SECRET_WRITE_ROOT],
    realWriteRoots: [SECRET_WRITE_ROOT],
    readOnly: false,
    sensitivity: "internal",
    domain: DEFAULT_DOMAIN_PROFILE,
    ui: {},
  };
}

function request(
  baseUrl: string,
  requestPath: string,
  options: {
    method?: string;
    origin?: string | false;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  const target = new URL(requestPath, baseUrl);
  const headers: Record<string, string> = { ...options.headers };
  if (options.origin !== false) headers.origin = options.origin || baseUrl;
  return new Promise((resolve, reject) => {
    const clientRequest = http.request(
      target,
      { method: options.method || "GET", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end();
  });
}
