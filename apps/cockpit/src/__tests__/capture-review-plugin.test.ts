/// <reference types="node" />

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertLocalRequest,
  createCaptureReviewPlugin,
  handleCaptureReviewRequest,
} from "../../scripts/capture-review-plugin";
import {
  getCaptureProposal,
  planCapture,
  renderCaptureNote,
} from "../../../../tools/capture/capture-service";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface JsonResponseBody {
  [key: string]: unknown;
  code?: string;
  proposal?: unknown;
  proposals?: unknown[];
  preview?: Record<string, unknown>;
  result?: unknown;
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

describe("capture review dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createCaptureReviewPlugin({ repoRoot: "/tmp/example" });
    expect(plugin.name).toBe("capture-review-local-api");
    expect(plugin.apply).toBe("serve");
  });

  test("lists body-free summaries and shows an authoritative current/proposed preview", async () => {
    const repoRoot = await makeWorkspace();
    const targetPath = "kb/topics/review-target.md";
    const currentContent = "# Review Target\n\nCurrent canonical content.\n";
    await writeWorkspaceFile(repoRoot, targetPath, currentContent);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Review Target",
      body: "Proposed body that must not leak into the list payload.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    const server = await startServer(repoRoot);

    const listed = await requestJson(server.baseUrl, "/__gke/capture/proposals");
    expect(listed.status).toBe(200);
    expect(listed.body.proposals).toEqual([
      expect.objectContaining({
        proposalId: planned.proposal.proposalId,
        proposedAction: "replace",
        title: "Review Target",
        path: targetPath,
      }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(planned.proposal.proposedNote.body);
    expect(listed.headers["cache-control"]).toBe("no-store");

    const shown = await requestJson(
      server.baseUrl,
      `/__gke/capture/proposals/${planned.proposal.proposalId}`,
    );
    expect(shown.status).toBe(200);
    expect(shown.body.proposal).toEqual(planned.proposal);
    expect(shown.body.preview).toEqual(
      expect.objectContaining({
        targetExists: true,
        currentContent,
        proposedContent: renderCaptureNote(planned.proposal.proposedNote),
        currentContentHash: planned.proposal.baseContentHash,
        stale: false,
      }),
    );
  });

  test("requires an explicit action and refreshes after a successful apply", async () => {
    const repoRoot = await makeWorkspace();
    const targetPath = "kb/topics/apply-target.md";
    await writeWorkspaceFile(repoRoot, targetPath, "# Apply Target\n\nOld content.\n");
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Apply Target",
      body: "New reviewed content.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    let refreshCount = 0;
    const server = await startServer(repoRoot, async () => {
      refreshCount += 1;
    });
    const endpoint = `/__gke/capture/proposals/${planned.proposal.proposalId}/apply`;

    const missingOrigin = await requestJson(server.baseUrl, endpoint, {
      method: "POST",
      body: { action: "replace" },
      origin: false,
    });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("invalid_origin");

    const oversizedBody = await requestJson(server.baseUrl, endpoint, {
      method: "POST",
      body: { action: "replace", padding: "x".repeat(5_000) },
    });
    expect(oversizedBody.status).toBe(413);
    expect(oversizedBody.body.code).toBe("body_too_large");

    const missingAction = await requestJson(server.baseUrl, endpoint, {
      method: "POST",
      body: {},
    });
    expect(missingAction.status).toBe(400);
    expect(missingAction.body.code).toBe("invalid_action");

    const applied = await requestJson(server.baseUrl, endpoint, {
      method: "POST",
      body: { action: "replace" },
    });
    expect(applied.status).toBe(200);
    expect(applied.body.result).toEqual(
      expect.objectContaining({
        proposalId: planned.proposal.proposalId,
        action: "replaced",
        path: targetPath,
      }),
    );
    expect(refreshCount).toBe(1);
    expect(await fs.readFile(path.join(repoRoot, targetPath), "utf8")).toBe(
      renderCaptureNote(planned.proposal.proposedNote),
    );
    await expect(getCaptureProposal(repoRoot, planned.proposal.proposalId)).rejects.toThrow(
      /not found/i,
    );
  });

  test("returns 409 for a stale target and leaves the proposal pending", async () => {
    const repoRoot = await makeWorkspace();
    const targetPath = "kb/topics/stale-target.md";
    await writeWorkspaceFile(repoRoot, targetPath, "# Stale Target\n\nOriginal.\n");
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Stale Target",
      body: "Proposed replacement.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    await fs.writeFile(path.join(repoRoot, targetPath), "# Stale Target\n\nChanged later.\n");
    const server = await startServer(repoRoot);

    const response = await requestJson(
      server.baseUrl,
      `/__gke/capture/proposals/${planned.proposal.proposalId}/apply`,
      { method: "POST", body: { action: "replace" } },
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("capture_conflict");
    expect((await getCaptureProposal(repoRoot, planned.proposal.proposalId)).proposalId).toBe(
      planned.proposal.proposalId,
    );
  });

  test("rejects without mutating canonical content", async () => {
    const repoRoot = await makeWorkspace();
    const targetPath = "kb/topics/reject-target.md";
    const currentContent = "# Reject Target\n\nKeep this content.\n";
    await writeWorkspaceFile(repoRoot, targetPath, currentContent);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Reject Target",
      body: "Discard this replacement.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    const server = await startServer(repoRoot);

    const response = await requestJson(
      server.baseUrl,
      `/__gke/capture/proposals/${planned.proposal.proposalId}/reject`,
      { method: "POST", body: {} },
    );
    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      proposalId: planned.proposal.proposalId,
      rejected: true,
      dryRun: false,
    });
    expect(await fs.readFile(path.join(repoRoot, targetPath), "utf8")).toBe(currentContent);
    await expect(getCaptureProposal(repoRoot, planned.proposal.proposalId)).rejects.toThrow(
      /not found/i,
    );
  });

  test("rejects reviewed mutations in a read-only workspace", async () => {
    const repoRoot = await makeWorkspace();
    const targetPath = "kb/topics/read-only-target.md";
    const original = "# Read-only Target\n\nOriginal.\n";
    await writeWorkspaceFile(repoRoot, targetPath, original);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Read-only Target",
      body: "Blocked replacement.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-14",
    });
    const server = await startServer(repoRoot, undefined, true);

    const response = await requestJson(
      server.baseUrl,
      `/__gke/capture/proposals/${planned.proposal.proposalId}/apply`,
      { method: "POST", body: { action: "replace" } },
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("workspace_read_only");
    expect(await fs.readFile(path.join(repoRoot, targetPath), "utf8")).toBe(original);
    expect((await getCaptureProposal(repoRoot, planned.proposal.proposalId)).proposalId).toBe(
      planned.proposal.proposalId,
    );
  });

  test("rejects non-loopback identity, host, and cross-origin mutations", () => {
    expect(() =>
      assertLocalRequest(
        { remoteAddress: "192.0.2.10", host: "localhost:5173", origin: "http://localhost:5173" },
        true,
      ),
    ).toThrow(/loopback only/i);
    expect(() =>
      assertLocalRequest(
        { remoteAddress: "127.0.0.1", host: "example.test", origin: "http://example.test" },
        true,
      ),
    ).toThrow(/loopback host/i);
    expect(() =>
      assertLocalRequest(
        { remoteAddress: "127.0.0.1", host: "localhost:5173", origin: "http://localhost:9999" },
        true,
      ),
    ).toThrow(/same-origin/i);
  });
});

async function makeWorkspace(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-capture-review-plugin-"));
  await fs.mkdir(path.join(repoRoot, "kb/topics"), { recursive: true });
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  return repoRoot;
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

async function startServer(
  repoRoot: string,
  refreshIndex?: () => Promise<void>,
  readOnly = false,
): Promise<TestServer> {
  const workspace = await loadWorkspaceContext({
    repoRoot,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke"],
    environment: { KB_MCP_WORKSPACE_READ_ONLY: String(readOnly) },
  });
  const server = http.createServer((req, res) => {
    void handleCaptureReviewRequest(req, res, { repoRoot, workspace, refreshIndex }).then(
      (handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      },
    );
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
  options: { method?: string; body?: Record<string, unknown>; origin?: boolean } = {},
): Promise<{ status: number; body: JsonResponseBody; headers: http.IncomingHttpHeaders }> {
  const target = new URL(requestPath, baseUrl);
  const rawBody = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (options.method === "POST") {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(rawBody));
    if (options.origin !== false) headers.origin = baseUrl;
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
