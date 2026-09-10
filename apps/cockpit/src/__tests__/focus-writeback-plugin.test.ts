import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { handleFocusWritebackRequest } from "../../scripts/focus-writeback-plugin";
import { loadWorkspaceContext } from "../../../../tools/workspaces/config";
import type { WorkspaceContext } from "../../../../tools/workspaces/types";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

describe("Focus writeback dev-server plugin", () => {
  test("adds, orders, and removes a local focus task without changing other workspace settings", async () => {
    const fixture = await createFixture();
    const server = await startServer(fixture.repoRoot, fixture.workspace);

    const added = await requestJson(server.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "add-task", areaId: "learning", title: "Review the next lesson" },
    });
    expect(added.status).toBe(200);
    const focusArea = getFirstFocusArea(added.body);
    const focusTasks = focusArea.focusTasks as Array<{ id: string; title: string }>;
    expect(focusTasks).toHaveLength(1);
    expect(focusTasks[0]).toMatchObject({ title: "Review the next lesson" });
    const taskRecordId = `task:${focusTasks[0].id}`;

    const current = await requestJson(server.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "make-current", areaId: "learning", recordId: taskRecordId },
    });
    expect(current.status).toBe(200);
    expect(getFirstFocusArea(current.body).focusRecordIds).toEqual([
      taskRecordId,
      "document:kb/topics/lesson.md",
    ]);

    const removed = await requestJson(server.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "remove", areaId: "learning", recordId: taskRecordId },
    });
    expect(removed.status).toBe(200);
    expect(getFirstFocusArea(removed.body).focusTasks).toBeUndefined();
    expect(getFirstFocusArea(removed.body).focusRecordIds).toEqual([
      "document:kb/topics/lesson.md",
    ]);

    const written = JSON.parse(await fs.readFile(fixture.workspaceConfigPath, "utf8")) as {
      id: string;
      ui: { focusAreas: Array<{ focusRecordIds: string[] }> };
    };
    expect(written.id).toBe("local-focus-test");
    expect(written.ui.focusAreas[0].focusRecordIds).toEqual(["document:kb/topics/lesson.md"]);
  });

  test("adds a linked project record and rejects foreign or read-only writes", async () => {
    const fixture = await createFixture();
    const writableServer = await startServer(fixture.repoRoot, fixture.workspace);
    const added = await requestJson(writableServer.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "add-record", areaId: "learning", recordId: "project:lesson-plan" },
    });
    expect(added.status).toBe(200);
    expect(getFirstFocusArea(added.body).projectIds).toEqual(["lesson-plan"]);

    const missingOrigin = await requestJson(writableServer.baseUrl, "/__gke/focus", {
      method: "POST",
      origin: false,
      body: { action: "add-record", areaId: "learning", recordId: "project:other" },
    });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("invalid_origin");

    const readOnlyWorkspace: WorkspaceContext = { ...fixture.workspace, readOnly: true };
    const readOnlyServer = await startServer(fixture.repoRoot, readOnlyWorkspace);
    const readOnly = await requestJson(readOnlyServer.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "add-record", areaId: "learning", recordId: "project:other" },
    });
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.code).toBe("workspace_read_only");
  });

  test("rejects unknown fields and malformed focus records", async () => {
    const fixture = await createFixture();
    const server = await startServer(fixture.repoRoot, fixture.workspace);

    const unknown = await requestJson(server.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "add-task", areaId: "learning", title: "Review", path: "/tmp" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("invalid_body");

    const malformed = await requestJson(server.baseUrl, "/__gke/focus", {
      method: "POST",
      body: { action: "add-record", areaId: "learning", recordId: "document:../../private.md" },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("invalid_record");
  });
});

async function createFixture(): Promise<{
  repoRoot: string;
  workspaceConfigPath: string;
  workspace: WorkspaceContext;
}> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-focus-writeback-"));
  cleanupTasks.push(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const workspaceConfigPath = path.join(repoRoot, ".gke", "workspace.json");
  await fs.mkdir(path.dirname(workspaceConfigPath), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "kb", "topics"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "kb", "topics", "lesson.md"), "# Lesson\n", "utf8");
  await fs.writeFile(
    workspaceConfigPath,
    JSON.stringify(
      {
        id: "local-focus-test",
        scanRoots: ["kb"],
        writeRoots: ["kb", ".gke"],
        readOnly: false,
        ui: {
          focusAreas: [
            {
              id: "learning",
              label: "Learning",
              documentPaths: ["kb/topics/lesson.md"],
              focusRecordIds: ["document:kb/topics/lesson.md"],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  const workspace = await loadWorkspaceContext({ repoRoot });
  return { repoRoot, workspaceConfigPath, workspace };
}

async function startServer(repoRoot: string, workspace: WorkspaceContext) {
  const server = http.createServer((req, res) => {
    void handleFocusWritebackRequest(req, res, { repoRoot, workspace }).then((handled) => {
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

function getFirstFocusArea(body: Record<string, unknown>): Record<string, unknown> {
  const areas = body.focusAreas;
  if (!Array.isArray(areas) || !areas[0] || typeof areas[0] !== "object") {
    throw new Error("Focus response did not contain an area.");
  }
  return areas[0] as Record<string, unknown>;
}
