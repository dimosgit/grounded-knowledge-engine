#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildManifestHash,
  gatherCandidateFiles,
  getDocumentTitle,
  inferSourceKind,
  inferTrack,
  normalizeScanRoots,
  parseFrontmatter,
  parsePositiveInt,
} from "./document-core.js";
import { getKbRetriever } from "./retriever.js";
import { getSqliteKbRetriever } from "./sqlite-index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-document-core-"));

try {
  await write(
    "kb/topics/alpha.md",
    `---
track: test
module: parity
---
# Alpha Record

The uniqueparitytoken appears in this evidence line.
`,
  );
  await write("kb/terms/beta.md", "# Beta\n\nSecondary evidence.\n");
  await write("kb/archive/old.txt", "Archived text.\n");
  await write("kb/topics/ignored.json", '{"ignored":true}\n');
  await write("kb/node_modules/ignored.md", "# Must Not Index\n");
  await write("kb/.cache/ignored.md", "# Must Not Index\n");
  await write(
    ".gke/capture-proposals/leak.md",
    "# Pending Capture Proposal\n\nThis operational state must never be indexed.\n",
  );

  const files = await gatherCandidateFiles(root, ["kb"]);
  assert.deepEqual(
    files.map((file) => file.relPath),
    ["kb/archive/old.txt", "kb/terms/beta.md", "kb/topics/alpha.md"],
  );
  const originalHash = buildManifestHash(files);
  assert.equal(originalHash, buildManifestHash(files));

  const workspaceFiles = await gatherCandidateFiles(root, ["."]);
  assert.equal(
    workspaceFiles.some((file) => file.relPath.includes(".gke")),
    false,
    "Workspace-root scans must exclude .gke operational state.",
  );
  assert.deepEqual(
    await gatherCandidateFiles(root, [".gke/capture-proposals"]),
    [],
    "Direct .gke scan roots must remain excluded.",
  );

  const parsed = parseFrontmatter(await fs.readFile(path.join(root, "kb/topics/alpha.md"), "utf8"));
  assert.equal(parsed.frontmatter.track, "test");
  assert.match(parsed.body, /^# Alpha Record/m);
  assert.equal(getDocumentTitle(parsed.body, "kb/topics/alpha.md"), "Alpha Record");
  assert.equal(inferSourceKind("kb/topics/alpha.md"), "kb-topic");
  assert.equal(inferTrack("kb/topics/alpha.md", parsed.frontmatter), "test");
  assert.deepEqual(normalizeScanRoots(" kb, demo-kb ", ["fallback"]), ["kb", "demo-kb"]);
  assert.deepEqual(normalizeScanRoots([], ["fallback"]), []);
  assert.equal(parsePositiveInt("50", 8, 1, 30), 30);
  assert.equal(parsePositiveInt("bad", 8, 1, 30), 8);

  await fs.appendFile(path.join(root, "kb/topics/alpha.md"), "\nChanged.\n");
  const changedFiles = await gatherCandidateFiles(root, ["kb"]);
  assert.notEqual(buildManifestHash(changedFiles), originalHash);

  const bm25 = await getKbRetriever({
    repoRoot: root,
    scanRoots: ["kb"],
    cachePath: ".cache/parity-bm25.json",
    forceRefresh: true,
  });
  const sqlite = await getSqliteKbRetriever({
    repoRoot: root,
    scanRoots: ["kb"],
    cachePath: ".cache/parity.sqlite",
    forceRefresh: true,
  });

  const bm25Docs = bm25.getDocuments().map(documentIdentity);
  const sqliteDocs = sqlite.getDocuments().map(documentIdentity);
  assert.deepEqual(sqliteDocs, bm25Docs);

  const bm25Result = bm25.search({
    query: "uniqueparitytoken",
    mode: "generic",
    limit: 3,
    context: 1,
  });
  const sqliteResult = sqlite.search({
    query: "uniqueparitytoken",
    mode: "generic",
    limit: 3,
    context: 1,
  });
  assert.equal(bm25Result.hits[0]?.path, "kb/topics/alpha.md");
  assert.equal(sqliteResult.hits[0]?.path, "kb/topics/alpha.md");
  assert.equal(sqliteResult.hits[0]?.lineNumber, bm25Result.hits[0]?.lineNumber);
  assert.equal(sqliteResult.hits[0]?.title, bm25Result.hits[0]?.title);
  assert.equal(sqliteResult.hits[0]?.track, bm25Result.hits[0]?.track);
  assert.equal(sqliteResult.hits[0]?.module, bm25Result.hits[0]?.module);

  console.log("Shared document core and retrieval parity tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function write(relPath: string, content: string): Promise<void> {
  const target = path.join(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

function documentIdentity(document: {
  relPath: string;
  title: string;
  track: string;
  module: string;
  sourceKind: string;
  isArchive: boolean;
}) {
  return {
    path: document.relPath,
    title: document.title,
    track: document.track,
    module: document.module,
    sourceKind: document.sourceKind,
    isArchive: document.isArchive,
  };
}
