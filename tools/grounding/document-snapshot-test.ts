import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGroundingApplicationService } from "./grounding-application-service.js";

const backend = process.argv.includes("--sqlite") ? "sqlite" : "bm25";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-snapshot-"));
const originalReadFile = fs.readFile.bind(fs);
try {
  await fs.mkdir(path.join(root, "kb/topics"), { recursive: true });
  for (const name of ["one", "two", "three"]) {
    await fs.writeFile(
      path.join(root, `kb/topics/${name}.md`),
      `---\ntitle: ${name}\nproject_id: snapshot\n---\n# ${name}\n\nSnapshot evidence is shared.\n`,
    );
  }
  await fs.writeFile(path.join(root, "kb/topics/empty.md"), "---\ntitle: Empty record\n---\n");
  process.env.KB_MCP_REPO_ROOT = root;
  process.env.KB_MCP_SCAN_ROOTS = "kb";
  process.env.KB_MCP_RETRIEVAL_BACKEND = backend;
  process.env.KB_MCP_ENABLE_WRITES = "true";
  process.env.KB_MCP_PROFILE = "full";
  const { handleRequest } = await import("../kb-mcp-server/server.js");
  const reads = new Map<string, number>();
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    const file = String(args[0]);
    if (file.endsWith(".md"))
      reads.set(path.basename(file), (reads.get(path.basename(file)) || 0) + 1);
    return originalReadFile(...args);
  }) as typeof fs.readFile;
  const refresh = await handleRequest("tools/call", { name: "kb.refresh", arguments: {} });
  assert.equal(refresh.isError, undefined);
  for (const name of ["one", "two", "three", "empty"]) assert.equal(reads.get(`${name}.md`), 1);
  const service = createGroundingApplicationService({ repoRoot: root, scanRoots: ["kb"], backend });
  const docs = await service.listDocuments();
  const one = docs.find((doc) => doc.relPath === "kb/topics/one.md")!;
  assert.equal(one.frontmatter.project_id, "snapshot");
  assert.match(one.body, /Snapshot evidence is shared/);
  assert.ok(docs.some((doc) => doc.relPath === "kb/topics/empty.md"));

  reads.clear();
  const capture = await handleRequest("tools/call", {
    name: "kb.add_open_question",
    arguments: {
      question: "How should snapshot invalidation be verified?",
      whyOpen: "Define a regression test.",
      whatWouldResolve: "One read per source file.",
    },
  });
  assert.equal(capture.isError, undefined);
  for (const name of ["one", "two", "three", "empty"]) assert.equal(reads.get(`${name}.md`), 1);
  console.log(
    `${backend}: refresh and question capture read each existing document once; complete document records preserved.`,
  );
} finally {
  fs.readFile = originalReadFile;
  await fs.rm(root, { recursive: true, force: true });
}
