import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnKbServer, type KbServerHandle } from "../kb-mcp-server/mcp-client.js";

const workspaceA = await createWorkspace("alpha", "Client Alpha", "marker-alpha", true);
const workspaceB = await createWorkspace("beta", "Client Beta", "marker-beta", false);

try {
  await testWorkspaceProcessIsolation();
  await testInvalidRootFailsBeforeRequests();
  console.log("Workspace MCP integration tests passed.");
} finally {
  await Promise.all([
    fs.rm(workspaceA.root, { recursive: true, force: true }),
    fs.rm(workspaceB.root, { recursive: true, force: true }),
  ]);
}

async function testInvalidRootFailsBeforeRequests(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-workspace-invalid-"));
  try {
    await fs.mkdir(path.join(root, "kb"));
    const handle = spawnKbServer({
      KB_MCP_REPO_ROOT: root,
      KB_MCP_SCAN_ROOTS: "../outside",
      KB_MCP_LOG_LEVEL: "off",
    });
    // The expected startup rejection is asserted below; keep its safe error
    // out of the successful test run's output.
    handle.child.stderr.removeAllListeners("data");
    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        handle.child.kill("SIGTERM");
        reject(new Error("Invalid workspace configuration did not terminate the MCP server."));
      }, 5000);
      handle.child.once("exit", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    assert.notEqual(code, 0, "invalid scan roots fail before the MCP server accepts requests");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testWorkspaceProcessIsolation(): Promise<void> {
  const alpha = spawnWorkspace(workspaceA.root);
  const beta = spawnWorkspace(workspaceB.root);
  try {
    await Promise.all([
      alpha.client.initialize("workspace-alpha"),
      beta.client.initialize("workspace-beta"),
    ]);

    const [alphaSearch, betaSearch, alphaInfo] = await Promise.all([
      alpha.client.callTool("kb.search", { query: "marker-alpha" }),
      beta.client.callTool("kb.search", { query: "marker-beta" }),
      alpha.client.request("resources/read", { uri: "gke://workspace/info" }),
    ]);
    assert.match(JSON.stringify(alphaSearch), /marker-alpha/);
    assert.doesNotMatch(JSON.stringify(alphaSearch), /marker-beta/);
    assert.match(JSON.stringify(betaSearch), /marker-beta/);
    assert.doesNotMatch(JSON.stringify(betaSearch), /marker-alpha/);

    const workspaceInfo = JSON.parse(alphaInfo.contents[0].text);
    assert.deepEqual(
      workspaceInfo,
      {
        workspaceId: "alpha",
        label: "Client Alpha",
        sensitivity: "sensitive",
        readOnly: true,
        profile: "core",
        writesEnabled: false,
        scanRoots: ["kb"],
        writeRoots: ["kb", ".gke", ".cache"],
        projects: [],
      },
      "workspace metadata is logical and includes the active read-only state",
    );
    assert.doesNotMatch(alphaInfo.contents[0].text, new RegExp(escapeRegExp(workspaceA.root)));

    const tools = await alpha.client.request("tools/list", {});
    assert.ok(
      !tools.tools.some((tool: { name: string }) => tool.name === "kb.upsert_note"),
      "read-only workspace hides write tools even when the global gate is enabled",
    );
  } finally {
    await Promise.all([stop(alpha), stop(beta)]);
  }
}

function spawnWorkspace(root: string): KbServerHandle {
  return spawnKbServer({
    KB_MCP_REPO_ROOT: root,
    KB_MCP_ENABLE_WRITES: "true",
    KB_MCP_PROFILE: "core",
    KB_MCP_LOG_LEVEL: "error",
  });
}

async function createWorkspace(
  id: string,
  label: string,
  marker: string,
  readOnly: boolean,
): Promise<{ root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `gke-workspace-${id}-`));
  await fs.mkdir(path.join(root, "kb", "topics"), { recursive: true });
  await fs.mkdir(path.join(root, ".gke"), { recursive: true });
  await fs.writeFile(
    path.join(root, "kb", "topics", "shared.md"),
    `---\nmodule: workspace\ntrack: isolated\n---\n# Shared\n\n${marker}\n`,
  );
  await fs.writeFile(
    path.join(root, ".gke", "workspace.json"),
    `${JSON.stringify(
      {
        id,
        label,
        scanRoots: ["kb"],
        writeRoots: ["kb", ".gke", ".cache"],
        readOnly,
        sensitivity: "sensitive",
      },
      null,
      2,
    )}\n`,
  );
  return { root };
}

async function stop(handle: KbServerHandle): Promise<void> {
  if (handle.child.exitCode !== null) return;
  handle.child.kill("SIGTERM");
  await new Promise<void>((resolve) => handle.child.once("exit", () => resolve()));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
