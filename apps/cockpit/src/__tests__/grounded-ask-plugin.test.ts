/// <reference types="node" />
// @vitest-environment node

import { DEFAULT_DOMAIN_PROFILE } from "../../../../tools/workspaces/domain-profile";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createGroundedAskPlugin,
  handleGroundedAskRequest,
  type GroundedAskPluginOptions,
} from "../../scripts/grounded-ask-plugin";
import type { GroundedAnswerResult } from "../../../../tools/grounding/answer-service";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";

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
    const fixture = await createProjectFixture("capture-project");
    const answer = vi.fn(async () => groundedAnswer());
    const capture = vi.fn(async (options) => ({
      action: "created" as const,
      path: "kb/topics/capture-workflow.md",
      dryRun: false,
      routing: undefined,
      proposal: null,
      title: options.title,
    }));
    const server = await startServer({ ...fixture, answer, capture });

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
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ projectId: "capture-project" }));
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Capture workflow",
        projectId: "capture-project",
        grounded: expect.objectContaining({ question: "How does capture work?" }),
      }),
    );
  });

  test("validates project scope and excludes evidence outside explicit project membership", async () => {
    const fixture = await createProjectFixture("alpha-project", {
      projectEvidence: [
        ["kb/sources/alpha-project/one.md", "Alpha one", "scopequartz alpha evidence one"],
        ["kb/sources/alpha-project/two.md", "Alpha two", "scopequartz alpha evidence two"],
        ["kb/sources/alpha-project/three.md", "Alpha three", "scopequartz alpha evidence three"],
      ],
      otherEvidence: [["kb/sources/beta-project/one.md", "Beta one", "scopequartz beta evidence"]],
    });
    const server = await startServer(fixture);

    const response = await requestJson(server.baseUrl, "/__gke/ask", {
      body: { question: "scopequartz", strict: false, projectId: "alpha-project" },
    });
    expect(response.status).toBe(200);
    const evidence = response.body.answer as { evidence: Array<{ path: string }> };
    expect(evidence.evidence.length).toBeGreaterThan(0);
    expect(evidence.evidence.every((item) => item.path.includes("/alpha-project/"))).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("beta-project");

    const invalid = await requestJson(server.baseUrl, "/__gke/ask", {
      body: { question: "scopequartz", projectId: "missing-project" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_project");
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
    tokenUsage: {
      kind: "estimate",
      scope: "gke-visible-text",
      requestTokens: 6,
      evidenceTokens: 9,
      answerTokens: 13,
      totalTokens: 28,
      method: "characters-divided-by-4",
    },
    timings: { retrievalMs: 2, synthesisMs: 1, captureMs: null, totalMs: 3 },
  };
}

async function startServer(options: GroundedAskPluginOptions) {
  const workspace = options.workspace ?? testWorkspace(options.repoRoot);
  const server = http.createServer((req, res) => {
    void handleGroundedAskRequest(req, res, { ...options, workspace }).then((handled) => {
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
    writeRoots: ["kb", ".gke"],
    realWriteRoots: [repoRoot],
    readOnly: false,
    sensitivity: "internal",
    domain: DEFAULT_DOMAIN_PROFILE,
    ui: {},
  };
}

async function createProjectFixture(
  projectId: string,
  options: {
    projectEvidence?: Array<[path: string, title: string, body: string]>;
    otherEvidence?: Array<[path: string, title: string, body: string]>;
  } = {},
): Promise<{ repoRoot: string; workspace: WorkspaceContext }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-cockpit-project-ask-"));
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const projectPath = path.join(repoRoot, "kb/projects", projectId, "project.md");
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(
    projectPath,
    `---\nrecord_type: project\nproject_id: ${projectId}\ntitle: ${projectId}\nsource_roots: kb/sources/${projectId}\n---\n# ${projectId}\n`,
    "utf8",
  );
  for (const [relativePath, title, body] of [
    ...(options.projectEvidence || []),
    ...(options.otherEvidence || []),
  ]) {
    const target = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `# ${title}\n\n${body}\n`, "utf8");
  }
  const workspace = await loadWorkspaceContext({
    repoRoot,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
  });
  return { repoRoot, workspace };
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
