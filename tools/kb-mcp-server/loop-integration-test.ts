#!/usr/bin/env node
/**
 * GKE end-to-end loop integration test.
 *
 * Where smoke-test.ts verifies the MCP tool *contract* (with every write in
 * dryRun mode), this test proves the actual "Grounded Answer -> Capture ->
 * Re-answer" loop that the demo video shows:
 *
 *   1. GROUNDING   — ask about a fact that is not in the KB yet; it is not cited.
 *   2. MEMORY      — capture a new note for real (writes enabled); the file
 *                    lands on disk.
 *   3. RE-GROUND   — refresh the index, ask again; the freshly stored note is
 *                    now retrieved and cited.
 *
 * The whole run happens against a throwaway sandbox KB in a temp directory, so
 * it never touches the real /kb tree. Run with: `npm run test:loop`.
 */
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnKbServer } from "./mcp-client.js";

// A token unique enough that it cannot collide with seed content. It is the
// single fact whose lifecycle (absent -> captured -> cited) this test traces.
const UNIQUE_TOKEN = "ZEPHYRBLOCKER7421";

async function seedSandboxKb(repoRoot: string): Promise<void> {
  const kb = path.join(repoRoot, "kb");
  await fs.mkdir(path.join(kb, "terms"), { recursive: true });
  await fs.mkdir(path.join(kb, "topics"), { recursive: true });
  await fs.writeFile(
    path.join(kb, "index.md"),
    "# Sandbox KB\n\nThrowaway knowledge base for the GKE loop integration test.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(kb, "terms", "RAP.md"),
    "# RAP\n\nABAP RESTful Application Programming model. Seed evidence so the index is non-empty.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(kb, "topics", "seed-topic.md"),
    "# Seed Topic\n\nUnrelated background content about deployment and clean core.\n",
    "utf8",
  );
}

function hitsForToken(searchResult: any): any[] {
  return (searchResult?.structuredContent?.hits || []) as any[];
}

function citationPaths(grounded: any): string[] {
  return ((grounded?.structuredContent?.citations || []) as any[]).map((c) => c.path);
}

async function main(): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-loop-"));
  let child: ChildProcessWithoutNullStreams | null = null;
  try {
    await seedSandboxKb(repoRoot);

    const handle = spawnKbServer({
      KB_MCP_REPO_ROOT: repoRoot,
      KB_MCP_SCAN_ROOTS: "kb",
      KB_MCP_ENABLE_WRITES: "true",
      KB_MCP_PROFILE: "full",
      KB_MCP_REQUIRE_CAPTURE: "false",
      KB_MCP_LOG_LEVEL: "error",
    });
    child = handle.child;
    const client = handle.client;

    const init = await client.initialize("gke-loop-integration");
    assert.equal(init.serverInfo?.name, "kb-mcp-server");

    // ---- Pillar 1: GROUNDING — the fact is absent before capture. ----
    const preSearch = await client.callTool("kb.search", { query: UNIQUE_TOKEN, limit: 5 });
    assert.equal(
      hitsForToken(preSearch).length,
      0,
      "Sanity check failed: the unique token already exists in the sandbox KB before capture.",
    );

    const question = `Why is the ${UNIQUE_TOKEN} sandbox integration blocked?`;
    const preAnswer = await client.callTool("kb.answer_grounded", {
      question,
      limit: 4,
      mode: "generic",
      allowDirect: true,
    });
    assert.ok(
      preAnswer.structuredContent?.question,
      "Pre-capture grounded answer did not return a structured payload.",
    );

    // ---- Pillar 2: MEMORY — capture a new note for real and confirm persistence. ----
    const capture = await client.callTool("kb.upsert_note", {
      kind: "topic",
      title: `Sandbox Integration Blocker ${UNIQUE_TOKEN}`,
      body: `## Blocker\n\nThe sandbox integration is blocked by a missing ${UNIQUE_TOKEN} API key for the sandbox tenant. Provision the key to unblock cutover.`,
      module: "rap-core",
      type: "concept",
      status: "draft",
    });
    assert.equal(
      capture.structuredContent?.dryRun,
      false,
      "Capture must be a real write, not a dry run.",
    );
    assert.equal(capture.structuredContent?.action, "created");
    const capturedPath = capture.structuredContent?.path as string;
    assert.ok(capturedPath, "Capture did not return a path.");

    // The note actually landed on disk in the sandbox KB.
    const absCapturedPath = path.join(repoRoot, capturedPath);
    const onDisk = await fs.readFile(absCapturedPath, "utf8");
    assert.match(
      onDisk,
      new RegExp(UNIQUE_TOKEN),
      "Stored note on disk does not contain the captured fact.",
    );

    // ---- Pillar 3: RE-GROUND — refresh, then prove the stored fact is now retrieved & cited. ----
    const refreshed = await client.callTool("kb.refresh", {});
    assert.equal(refreshed.structuredContent?.refreshed, true);

    const postSearch = await client.callTool("kb.search", { query: UNIQUE_TOKEN, limit: 5 });
    const postHits = hitsForToken(postSearch);
    assert.ok(
      postHits.some((hit) => hit.path === capturedPath),
      `After capture, kb.search did not surface the stored note (${capturedPath}).`,
    );

    const postAnswer = await client.callTool("kb.answer_grounded", {
      question,
      limit: 4,
      mode: "generic",
      allowDirect: true,
    });
    assert.ok(
      citationPaths(postAnswer).includes(capturedPath),
      `Re-answer did not cite the freshly stored note (${capturedPath}). ` +
        `Citations: ${JSON.stringify(citationPaths(postAnswer))}`,
    );

    console.log(
      "GKE loop integration test passed (ground -> capture -> persist -> re-ground -> cite).",
    );
  } finally {
    if (child) child.kill("SIGTERM");
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
