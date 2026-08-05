import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { handleProjectTaskWritebackRequest } from "../../scripts/project-task-writeback-plugin";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

describe("project task writeback dev-server plugin", () => {
  test("completes exactly the confirmed task in canonical Markdown", async () => {
    const fixture = await createFixture();
    const server = await startServer(fixture.repoRoot, fixture.workspace);

    const response = await requestJson(server.baseUrl, "/__gke/projects/tasks/complete", {
      method: "POST",
      body: { projectId: "alpha-project", taskText: "Ship the visual checklist" },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      projectId: "alpha-project",
      changed: true,
      task: { text: "Ship the visual checklist", status: "done" },
    });
    const written = await fs.readFile(fixture.projectPath, "utf8");
    expect(written).toContain("- [x] Ship the visual checklist [M]");
    expect(written).toContain("- [ ] Keep the second task open [S]");
  });

  test("requires a same-origin confirmation request and writable workspace", async () => {
    const fixture = await createFixture();
    const writableServer = await startServer(fixture.repoRoot, fixture.workspace);
    const missingOrigin = await requestJson(
      writableServer.baseUrl,
      "/__gke/projects/tasks/complete",
      {
        method: "POST",
        origin: false,
        body: { projectId: "alpha-project", taskText: "Ship the visual checklist" },
      },
    );
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("invalid_origin");

    const readOnlyWorkspace = await loadWorkspaceContext({
      repoRoot: fixture.repoRoot,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".gke"],
      environment: { KB_MCP_WORKSPACE_READ_ONLY: "true" },
    });
    const readOnlyServer = await startServer(fixture.repoRoot, readOnlyWorkspace);
    const readOnly = await requestJson(readOnlyServer.baseUrl, "/__gke/projects/tasks/complete", {
      method: "POST",
      body: { projectId: "alpha-project", taskText: "Ship the visual checklist" },
    });
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.code).toBe("workspace_read_only");
  });

  test("rejects unknown fields and stale task text", async () => {
    const fixture = await createFixture();
    const server = await startServer(fixture.repoRoot, fixture.workspace);
    const unknownField = await requestJson(server.baseUrl, "/__gke/projects/tasks/complete", {
      method: "POST",
      body: { projectId: "alpha-project", taskText: "Ship the visual checklist", path: "/tmp" },
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.code).toBe("invalid_body");

    const stale = await requestJson(server.baseUrl, "/__gke/projects/tasks/complete", {
      method: "POST",
      body: { projectId: "alpha-project", taskText: "A task that no longer exists" },
    });
    expect(stale.status).toBe(404);
    expect(stale.body.code).toBe("task_not_found");
  });
});

async function createFixture(): Promise<{
  repoRoot: string;
  projectPath: string;
  workspace: WorkspaceContext;
}> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-task-writeback-"));
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const projectPath = path.join(repoRoot, "kb/projects/alpha-project/project.md");
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(
    projectPath,
    `---
record_type: project
project_id: alpha-project
title: Alpha Project
updated: 2026-08-01
---

# Alpha Project

## Delivery checklist

- [ ] Ship the visual checklist [M]
- [ ] Keep the second task open [S]
`,
    "utf8",
  );
  const workspace = await loadWorkspaceContext({
    repoRoot,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke"],
    environment: { KB_MCP_WORKSPACE_READ_ONLY: "false" },
  });
  return { repoRoot, projectPath, workspace };
}

async function startServer(repoRoot: string, workspace: WorkspaceContext) {
  const server = http.createServer((req, res) => {
    void handleProjectTaskWritebackRequest(req, res, { repoRoot, workspace }).then((handled) => {
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
  cleanupTasks.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function requestJson(
  baseUrl: string,
  requestPath: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    origin?: boolean;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
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
            body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          });
        });
      },
    );
    request.once("error", reject);
    if (rawBody) request.write(rawBody);
    request.end();
  });
}
