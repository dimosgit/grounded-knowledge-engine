import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKbRetriever } from "../grounding/retriever.js";
import { getSqliteKbRetriever } from "../grounding/sqlite-index.js";
import { loadWorkspaceContext } from "./config.js";
import { authorizeWorkspaceRead, authorizeWorkspaceWrite } from "./path-policy.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-workspace-policy-"));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "gke-workspace-outside-"));

try {
  await fs.mkdir(path.join(root, "kb", "nested"), { recursive: true });
  await fs.writeFile(path.join(root, "kb", "shared.md"), "# Workspace A\n\nmarker-a\n");
  await fs.mkdir(path.join(outside, "kb"), { recursive: true });
  await fs.writeFile(path.join(outside, "kb", "shared.md"), "# Workspace B\n\nmarker-b\n");

  await testDefaultEnvironmentMapping();
  await testOutsideConfiguredRootsFail();
  await testInvalidReadOnlyConfigurationFailsClosed();
  await testRootAndNestedSymlinkEscapesFail();
  await testReadOnlyAndWriteRootPolicy();
  await testRetrievalCachesStayInsideWorkspace();
  await testWorkspaceRetrievalIsolation();
  console.log("Workspace policy tests passed.");
} finally {
  await Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true }),
  ]);
}

async function testDefaultEnvironmentMapping(): Promise<void> {
  const workspace = await loadWorkspaceContext({
    repoRoot: root,
    environment: {
      KB_MCP_SCAN_ROOTS: "kb",
      KB_MCP_WRITE_ROOTS: "kb",
      KB_MCP_WORKSPACE_ID: "alpha",
      KB_MCP_WORKSPACE_LABEL: "Client Alpha",
      KB_MCP_WORKSPACE_SENSITIVITY: "sensitive",
    },
  });
  assert.equal(workspace.id, "alpha");
  assert.equal(workspace.label, "Client Alpha");
  assert.equal(workspace.sensitivity, "sensitive");
  assert.deepEqual(workspace.scanRoots, ["kb"]);
  await assert.doesNotReject(() =>
    authorizeWorkspaceRead(workspace, path.join(root, "kb", "shared.md")),
  );
  await assert.rejects(
    () => authorizeWorkspaceRead(workspace, path.join(outside, "kb", "shared.md")),
    /outside an allowed scan root/,
  );
}

async function testOutsideConfiguredRootsFail(): Promise<void> {
  await assert.rejects(
    () =>
      loadWorkspaceContext({
        repoRoot: root,
        scanRoots: ["../outside"],
        writeRoots: ["kb"],
      }),
    /cannot traverse outside/,
  );
  await assert.rejects(
    () =>
      loadWorkspaceContext({
        repoRoot: root,
        scanRoots: [outside],
        writeRoots: ["kb"],
      }),
    /must be workspace-relative/,
  );
}

async function testInvalidReadOnlyConfigurationFailsClosed(): Promise<void> {
  const invalidRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-workspace-invalid-config-"));
  try {
    await fs.mkdir(path.join(invalidRoot, ".gke"), { recursive: true });
    await fs.mkdir(path.join(invalidRoot, "kb"), { recursive: true });
    await fs.writeFile(
      path.join(invalidRoot, ".gke", "workspace.json"),
      JSON.stringify({
        id: "invalid",
        label: "Invalid",
        scanRoots: ["kb"],
        writeRoots: ["kb", ".gke"],
        readOnly: "true",
        sensitivity: "internal",
      }),
    );
    await assert.rejects(
      () => loadWorkspaceContext({ repoRoot: invalidRoot }),
      /readOnly must be a boolean/,
    );
    await fs.rm(path.join(invalidRoot, ".gke", "workspace.json"));
    await assert.rejects(
      () =>
        loadWorkspaceContext({
          repoRoot: invalidRoot,
          scanRoots: ["kb"],
          writeRoots: ["kb"],
          environment: { KB_MCP_WORKSPACE_READ_ONLY: "sometimes" },
        }),
      /read-only setting is invalid/,
    );
  } finally {
    await fs.rm(invalidRoot, { recursive: true, force: true });
  }
}

async function testRootAndNestedSymlinkEscapesFail(): Promise<void> {
  await fs.symlink(outside, path.join(root, "linked-root"));
  await assert.rejects(
    () =>
      loadWorkspaceContext({
        repoRoot: root,
        scanRoots: ["linked-root"],
        writeRoots: ["kb"],
      }),
    /resolves outside the workspace/,
  );

  await fs.symlink(outside, path.join(root, "kb", "nested", "escape"));
  const workspace = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb"],
  });
  await assert.rejects(
    () =>
      authorizeWorkspaceRead(
        workspace,
        path.join(root, "kb", "nested", "escape", "kb", "shared.md"),
      ),
    /outside an allowed scan root/,
  );
}

async function testReadOnlyAndWriteRootPolicy(): Promise<void> {
  const writable = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb"],
  });
  await assert.doesNotReject(() =>
    authorizeWorkspaceWrite(writable, path.join(root, "kb", "created", "new.md")),
  );
  await assert.rejects(
    () => authorizeWorkspaceWrite(writable, path.join(root, "outside.md")),
    /outside an allowed write root/,
  );
  const readOnly = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb"],
    environment: { KB_MCP_WORKSPACE_READ_ONLY: "true" },
  });
  await assert.rejects(
    () => authorizeWorkspaceWrite(readOnly, path.join(root, "kb", "blocked.md")),
    /read-only/,
  );
}

async function testRetrievalCachesStayInsideWorkspace(): Promise<void> {
  const workspace = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
  });
  const bm25Outside = path.join(outside, "escaped-index.json");
  const sqliteOutside = path.join(outside, "escaped-index.sqlite");
  await assert.rejects(
    () => getKbRetriever({ workspace, cachePath: bm25Outside, forceRefresh: true }),
    /outside an allowed write root/,
  );
  await assert.rejects(
    () => getSqliteKbRetriever({ workspace, cachePath: sqliteOutside, forceRefresh: true }),
    /outside an allowed write root/,
  );
  assert.equal(await exists(bm25Outside), false);
  assert.equal(await exists(sqliteOutside), false);

  const readOnly = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
    environment: { KB_MCP_WORKSPACE_READ_ONLY: "true" },
  });
  const readOnlyCache = path.join(root, ".gke", "read-only.sqlite");
  const retriever = await getSqliteKbRetriever({
    workspace: readOnly,
    cachePath: readOnlyCache,
    forceRefresh: true,
  });
  assert.equal(retriever.search({ query: "marker-a" }).hitCount, 1);
  assert.equal(await exists(readOnlyCache), false);
}

async function testWorkspaceRetrievalIsolation(): Promise<void> {
  const workspaceA = await loadWorkspaceContext({
    repoRoot: root,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
  });
  const workspaceB = await loadWorkspaceContext({
    repoRoot: outside,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke", ".cache"],
  });
  const retrieverA = await getKbRetriever({ workspace: workspaceA, forceRefresh: true });
  const retrieverB = await getKbRetriever({ workspace: workspaceB, forceRefresh: true });

  assert.equal(retrieverA.search({ query: "marker-a" }).hitCount, 1);
  assert.equal(retrieverB.search({ query: "marker-b" }).hitCount, 1);
  assert.ok(retrieverA.getDocuments().every((document) => !document.body.includes("marker-b")));
  assert.ok(retrieverB.getDocuments().every((document) => !document.body.includes("marker-a")));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
