/// <reference types="node" />

import http from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createGroundedAskPlugin,
  handleGroundedAskRequest,
  type GroundedAskPluginOptions,
} from "../../scripts/grounded-ask-plugin";
import type { GroundedAnswerResult } from "../../../../tools/grounding/answer-service";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length) await cleanupTasks.pop()?.();
});

describe("grounded Ask dev-server plugin", () => {
  test("is registered for serve only", () => {
    const plugin = createGroundedAskPlugin({ repoRoot: "/tmp/example" });
    expect(plugin.name).toBe("grounded-ask-local-api");
    expect(plugin.apply).toBe("serve");
  });

  test("returns a bounded grounded answer without exposing search internals", async () => {
    const answer = vi.fn(async () => groundedAnswer());
    const server = await startServer({ repoRoot: "/tmp/example", answer });

    const missingOrigin = await requestJson(server.baseUrl, "/__gke/ask", {
      body: { question: "How does capture work?" },
      origin: false,
    });
    expect(missingOrigin.status).toBe(403);

    const response = await requestJson(server.baseUrl, "/__gke/ask", {
      body: { question: "How does capture work?", strict: true },
    });
    expect(response.status).toBe(200);
    expect(response.body.answer).toEqual(
      expect.objectContaining({
        question: "How does capture work?",
        abstained: false,
        confidence: expect.objectContaining({ label: "high" }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("debug-secret");
    expect(answer).toHaveBeenCalledTimes(1);
  });

  test("reruns grounding server-side before capture and validates the request schema", async () => {
    const answer = vi.fn(async () => groundedAnswer());
    const capture = vi.fn(async (options) => ({
      action: "created" as const,
      path: "kb/topics/capture-workflow.md",
      dryRun: false,
      routing: undefined,
      proposal: null,
      title: options.title,
    }));
    const server = await startServer({ repoRoot: "/tmp/example", answer, capture });

    const unknownField = await requestJson(server.baseUrl, "/__gke/ask/capture", {
      body: { question: "How does capture work?", title: "Capture workflow", body: "forged" },
    });
    expect(unknownField.status).toBe(400);

    const response = await requestJson(server.baseUrl, "/__gke/ask/capture", {
      body: {
        question: "How does capture work?",
        title: "Capture workflow",
        projectId: "capture-project",
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.capture).toEqual(
      expect.objectContaining({ action: "created", path: "kb/topics/capture-workflow.md" }),
    );
    expect(answer).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Capture workflow",
        projectId: "capture-project",
        grounded: expect.objectContaining({ question: "How does capture work?" }),
      }),
    );
  });
});

function groundedAnswer(): GroundedAnswerResult {
  return {
    question: "How does capture work?",
    answer: "Grounded capture uses evidence and conflict checks.",
    strict: true,
    responseMode: "curate",
    sourceTier: "bm25",
    abstained: false,
    confidence: { label: "high", score: 0.9, rationale: "Strong evidence" },
    gate: {
      pass: true,
      reasons: [],
      thresholds: {
        minHits: 3,
        minUniqueSources: 2,
        minTokenCoverage: 0.45,
        minTopScore: 14,
        maxDominantSourceShare: 0.9,
      },
      measured: {
        hitCount: 3,
        uniqueSources: 2,
        tokenCoverage: 1,
        topScore: 20,
        dominantSourceShare: 0.6,
      },
    },
    citations: [{ path: "kb/topics/source.md", line: 4, score: 20 }],
    evidence: [
      {
        path: "kb/topics/source.md",
        score: 20,
        lineNumber: 4,
        endLine: 6,
        title: "Source",
        sourceKind: "topic",
        track: "platform",
        module: "capture",
        snippet: "Evidence snippet",
        matchedTokens: ["capture"],
        context: [],
      },
    ],
    search: { signals: null, debug: { secret: "debug-secret" } },
    fastPath: { used: false, alreadyCaptured: false },
    timings: { retrievalMs: 2, synthesisMs: 1, captureMs: null, totalMs: 3 },
  };
}

async function startServer(options: GroundedAskPluginOptions) {
  const server = http.createServer((req, res) => {
    void handleGroundedAskRequest(req, res, options).then((handled) => {
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

async function requestJson(
  baseUrl: string,
  requestPath: string,
  options: { body: Record<string, unknown>; origin?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const target = new URL(requestPath, baseUrl);
  const rawBody = JSON.stringify(options.body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(rawBody)),
  };
  if (options.origin !== false) headers.origin = baseUrl;
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method: "POST", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode || 0,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
      });
    });
    request.once("error", reject);
    request.write(rawBody);
    request.end();
  });
}
