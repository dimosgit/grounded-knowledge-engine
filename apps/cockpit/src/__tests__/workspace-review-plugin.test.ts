/// <reference types="node" />
// @vitest-environment node

import { DEFAULT_DOMAIN_PROFILE } from "../../../../tools/workspaces/domain-profile";
import http from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createWorkspaceReviewPlugin,
  handleWorkspaceReviewRequest,
  type WorkspaceReviewPluginOptions,
} from "../../scripts/workspace-review-plugin";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

describe("workspace review dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createWorkspaceReviewPlugin({ repoRoot: "/tmp/example" });
    expect(plugin.name).toBe("workspace-review-local-api");
    expect(plugin.apply).toBe("serve");
  });

  test("accepts a bounded ISO window and returns the structured review", async () => {
    const review = vi.fn(async (args) => reviewResult(args.asOf, args.since));
    const server = await startServer({ repoRoot: "/tmp/example", review });
    const response = await requestJson(
      server.baseUrl,
      "/__gke/review?asOf=2026-07-14&since=2026-07-10",
    );

    expect(response.status).toBe(200);
    expect(review).toHaveBeenCalledWith(
      { asOf: "2026-07-14", since: "2026-07-10" },
      "/tmp/example",
      ["kb"],
      expect.objectContaining({ id: "test" }),
    );
    expect(response.body.review).toEqual(
      expect.objectContaining({ asOf: "2026-07-14", since: "2026-07-10" }),
    );
  });

  test("rejects unknown, repeated, non-local, and non-GET requests", async () => {
    const review = vi.fn(async () => reviewResult());
    const server = await startServer({ repoRoot: "/tmp/example", review });

    expect((await requestJson(server.baseUrl, "/__gke/review?projectId=alpha")).status).toBe(400);
    expect((await requestJson(server.baseUrl, "/__gke/review?since=a&since=b")).status).toBe(400);
    expect(
      (await requestJson(server.baseUrl, "/__gke/review", { origin: "http://example.test" }))
        .status,
    ).toBe(403);
    expect((await requestJson(server.baseUrl, "/__gke/review", { method: "POST" })).status).toBe(
      405,
    );
    expect(review).not.toHaveBeenCalled();
  });

  test("fails closed when review work exceeds its timeout", async () => {
    const review = vi.fn(() => new Promise<never>(() => {}));
    const server = await startServer({ repoRoot: "/tmp/example", review, timeoutMs: 5 });
    const response = await requestJson(server.baseUrl, "/__gke/review");

    expect(response.status).toBe(504);
    expect(response.body.code).toBe("review_timeout");
  });
});

function reviewResult(asOf = "2026-07-14", since: string | null = null) {
  return {
    contentText: "# Workspace review",
    structured: {
      asOf,
      since,
      projectCount: 0,
      attentionCount: 0,
      projects: [],
    },
  };
}

async function startServer(options: WorkspaceReviewPluginOptions) {
  const workspace = testWorkspace(options.repoRoot);
  const server = http.createServer((req, res) => {
    void handleWorkspaceReviewRequest(req, res, { ...options, workspace }).then((handled) => {
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
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const result = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  cleanupTasks.push(result.close);
  return result;
}

function testWorkspace(repoRoot: string): WorkspaceContext {
  return {
    id: "test",
    label: "Test",
    repoRoot,
    realRepoRoot: repoRoot,
    scanRoots: ["kb"],
    realScanRoots: [repoRoot],
    writeRoots: ["kb"],
    realWriteRoots: [repoRoot],
    readOnly: true,
    sensitivity: "internal",
    domain: DEFAULT_DOMAIN_PROFILE,
    ui: {},
  };
}

function requestJson(
  baseUrl: string,
  requestPath: string,
  options: { method?: string; origin?: string | false } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const target = new URL(requestPath, baseUrl);
  const headers: Record<string, string> = {};
  if (options.origin !== false) headers.origin = options.origin || baseUrl;
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
            body: raw ? JSON.parse(raw) : {},
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}
