/// <reference types="node" />

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createDecisionReviewPlugin,
  handleDecisionReviewRequest,
} from "../../scripts/decision-review-plugin";
import { createDecision } from "../../../../tools/decisions";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface JsonResponseBody {
  [key: string]: unknown;
  code?: string;
  error?: string;
  result?: {
    dryRun?: boolean;
    changes?: Array<{ classification?: string }>;
  };
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

describe("decision review dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createDecisionReviewPlugin({ repoRoot: "/tmp/example" });
    expect(plugin.name).toBe("decision-review-local-api");
    expect(plugin.apply).toBe("serve");
  });

  test("previews without writing and applies only after an explicit non-dry run", async () => {
    const { repoRoot, workspace, decisionPath } = await makeWorkspace();
    const original = await fs.readFile(path.join(repoRoot, decisionPath), "utf8");
    const server = await startServer(repoRoot, workspace);

    const preview = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: reviewBody(true),
    });
    expect(preview.status).toBe(200);
    expect(preview.body.result).toMatchObject({
      dryRun: true,
      changes: [{ classification: "unchanged" }, { classification: "weakened" }],
    });
    expect(preview.body.result).not.toHaveProperty("content");
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.headers["x-content-type-options"]).toBe("nosniff");
    expect(await fs.readFile(path.join(repoRoot, decisionPath), "utf8")).toBe(original);

    const applied = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: reviewBody(false),
    });
    expect(applied.status).toBe(200);
    expect(applied.body.result).toMatchObject({ dryRun: false });
    const updated = await fs.readFile(path.join(repoRoot, decisionPath), "utf8");
    expect(updated).toContain("### Review 2026-07-29");
    expect(updated).toContain("evidence_checked_at: 2026-07-29");
    expect(updated.match(/kb\/sources\/original\.md:3 — Original evidence/g)).toHaveLength(1);
  });

  test("requires a loopback same-origin JSON request and rejects malformed fields", async () => {
    const { repoRoot, workspace } = await makeWorkspace();
    const server = await startServer(repoRoot, workspace);

    const missingOrigin = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: reviewBody(true),
      origin: false,
    });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("invalid_origin");

    const wrongContentType = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: reviewBody(true),
      contentType: "text/plain",
    });
    expect(wrongContentType.status).toBe(415);
    expect(wrongContentType.body.code).toBe("invalid_content_type");

    const unknownField = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: { ...reviewBody(true), unexpected: true },
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.code).toBe("invalid_body");

    const invalidNestedField = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: {
        ...reviewBody(true),
        evidence: [{ path: "kb/sources/original.md", line: 3, extra: "blocked" }],
      },
    });
    expect(invalidNestedField.status).toBe(400);
    expect(invalidNestedField.body.code).toBe("invalid_body");

    const invalidClassification = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: {
        ...reviewBody(true),
        evidence: [
          {
            path: "kb/sources/original.md",
            line: 3,
            classification: "unsupported",
          },
        ],
      },
    });
    expect(invalidClassification.status).toBe(400);
    expect(invalidClassification.body.code).toBe("invalid_review");

    const missingDryRun = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: { ...reviewBody(true), dryRun: undefined },
    });
    expect(missingDryRun.status).toBe(400);
    expect(missingDryRun.body.code).toBe("invalid_review");
  });

  test("rejects reviews in a read-only workspace without changing the decision", async () => {
    const { repoRoot, decisionPath } = await makeWorkspace();
    const original = await fs.readFile(path.join(repoRoot, decisionPath), "utf8");
    const workspace = await loadWorkspaceContext({
      repoRoot,
      environment: { KB_MCP_WORKSPACE_READ_ONLY: "true" },
    });
    const server = await startServer(repoRoot, workspace);

    const response = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: reviewBody(false),
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("workspace_read_only");
    expect(await fs.readFile(path.join(repoRoot, decisionPath), "utf8")).toBe(original);
  });

  test("does not intercept other routes or expose the workspace path for a missing decision", async () => {
    const { repoRoot, workspace } = await makeWorkspace();
    const server = await startServer(repoRoot, workspace);

    const missing = await requestJson(server.baseUrl, "/__gke/decisions/review", {
      method: "POST",
      body: { ...reviewBody(true), decisionId: "missing-decision" },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: "Decision was not found.",
      code: "not_found",
    });
    expect(JSON.stringify(missing.body)).not.toContain(repoRoot);

    const unrelated = await requestJson(server.baseUrl, "/unrelated");
    expect(unrelated.status).toBe(404);
    expect(unrelated.body).toEqual({});
  });
});

async function makeWorkspace(): Promise<{
  repoRoot: string;
  workspace: WorkspaceContext;
  decisionPath: string;
}> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-decision-review-plugin-"));
  await fs.mkdir(path.join(repoRoot, "kb/sources"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "demo-kb"), { recursive: true });
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(repoRoot, "kb/sources/original.md"),
    "# Original evidence\n\nThe original evidence still applies.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(repoRoot, "kb/sources/new.md"),
    "# New evidence\n\nA newer constraint weakens one assumption.\n",
    "utf8",
  );
  const workspace = await loadWorkspaceContext({ repoRoot });
  const decision = await createDecision({
    repoRoot,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    decisionId: "pilot-location",
    workspaceId: "test",
    title: "Select the pilot location",
    status: "active",
    owner: "decision-owner",
    decidedAt: "2026-07-01",
    evidenceCheckedAt: "2026-07-01",
    reviewAfter: "2026-07-20",
    confidence: "medium",
    question: "Which location should host the pilot?",
    recommendation: "Use the first location.",
    rationale: "The original evidence supports it.",
    evidence: [{ path: "kb/sources/original.md", line: 3 }],
  });
  return { repoRoot, workspace, decisionPath: decision.path };
}

function reviewBody(dryRun: boolean): Record<string, unknown> {
  return {
    decisionId: "pilot-location",
    reviewedAt: "2026-07-29",
    reviewAfter: "2026-08-29",
    reviewer: "decision-reviewer",
    recommendationSupported: "uncertain",
    assumptionsNeedingValidation: ["Confirm the newer constraint."],
    evidence: [
      {
        path: "kb/sources/original.md",
        line: 3,
        classification: "unchanged",
      },
      {
        path: "kb/sources/new.md",
        line: 3,
        classification: "weakened",
        note: "Needs human confirmation.",
      },
    ],
    notes: "Review through the local Cockpit.",
    dryRun,
  };
}

async function startServer(repoRoot: string, workspace: WorkspaceContext): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    void handleDecisionReviewRequest(req, res, { repoRoot, workspace }).then((handled) => {
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
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind a port.");
  }
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
