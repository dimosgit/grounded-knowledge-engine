#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKbRetriever } from "../grounding/retriever.js";
import { getSqliteKbRetriever } from "../grounding/sqlite-index.js";
import { resumeProject } from "./index.js";
import { validateAllProjects } from "./project-service.js";
import {
  EXPORT_MANIFEST,
  EXPORT_MARKER,
  EXPORT_WORKSPACE_DOC,
  exportWorkspace,
} from "./export-workspace.js";

const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-export-src-"));
const outputParent = await fs.mkdtemp(path.join(os.tmpdir(), "gke-export-out-"));
const output = path.join(outputParent, "exported-workspace");

try {
  // --- Build a representative source workspace ---------------------------------
  await write(
    "kb/projects/export-pilot/project.md",
    `---
schema_version: 1
record_type: project
workspace_id: export-test
project_id: export-pilot
title: Export Pilot
status: active
lifecycle: active
track: domain
owner: tester
started_at: 2026-06-01
updated: 2026-06-20
review_after: 2026-07-04
source_roots: kb/sources/export-pilot
tags: export, pilot
---
# Export Pilot

## Outcome
Prove the workspace export preserves project context.

## Current focus
Validate the exported standalone workspace end to end.

## Last meaningful change
Wrote the generalized exporter and its integration test.

## Active decisions
- Preserve bytes instead of regenerating records.

## Blockers
- None recorded.

## Open questions
- None recorded.

## Next actions
1. Export the workspace.
2. Validate from the export.
3. Resume from the export.

## Key documents
- kb/sources/export-pilot/evidence.md
`,
  );
  await write(
    "kb/sources/export-pilot/evidence.md",
    "---\nrecord_type: source\nproject_id: export-pilot\n---\n# Evidence\n\nuniqueexporttoken appears here as grounded evidence.\n",
  );
  await write(
    "kb/topics/sample-topic.md",
    "# Sample Topic\n\nThe uniqueexporttoken also appears in this topic.\n",
  );
  await write("kb/assets/diagram.svg", "<svg></svg>\n");
  await write("source-docs/note.txt", "Reference source note.\n");
  await write("project-notes/playbook.md", "# Project Playbook\n\nDelivery notes.\n");
  await write("readme.md", "# Source workspace readme\n");
  await write(
    ".gke/workspace.json",
    JSON.stringify({
      id: "export-test",
      scanRoots: ["kb", "source-docs", "project-notes", "readme.md"],
    }),
  );

  // Things that must never be copied:
  await write(".git/config", "[core]\n");
  await write("node_modules/pkg/index.js", "module.exports = {};\n");
  await write(".env", "SECRET=should-not-leak\n");
  await write("kb/.cache/index.json", "{}\n");
  await write("kb/topics/.DS_Store", "junk\n");
  await write("kb/secrets.pem", "-----BEGIN KEY-----\n");

  // --- Export ------------------------------------------------------------------
  const result = await exportWorkspace({
    repoRoot: sourceRoot,
    output,
    sourceCommit: "test-commit",
    now: () => new Date("2026-06-23T00:00:00.000Z"),
  });
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.includedRoots, ["kb", "source-docs", "project-notes", "readme.md"]);

  // Selected roots copied
  for (const rel of [
    "kb/projects/export-pilot/project.md",
    "kb/sources/export-pilot/evidence.md",
    "kb/topics/sample-topic.md",
    "kb/assets/diagram.svg",
    "source-docs/note.txt",
    "project-notes/playbook.md",
    "readme.md",
  ]) {
    assert.equal(await exists(path.join(output, rel)), true, `expected copied: ${rel}`);
  }

  // Generated files present
  assert.equal(await exists(path.join(output, EXPORT_MARKER)), true);
  assert.equal(await exists(path.join(output, EXPORT_WORKSPACE_DOC)), true);
  const manifest = JSON.parse(await fs.readFile(path.join(output, EXPORT_MANIFEST), "utf8"));
  assert.equal(manifest.sourceCommit, "test-commit");
  assert.equal(manifest.fileCount, manifest.files.length);
  assert.ok(manifest.files.every((file: { sha256: string }) => /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.ok(manifest.files.some((file: { relPath: string }) => file.relPath === "readme.md"));

  // Excluded files absent
  for (const rel of [
    ".git/config",
    "node_modules/pkg/index.js",
    ".env",
    "kb/.cache/index.json",
    "kb/topics/.DS_Store",
    "kb/secrets.pem",
  ]) {
    assert.equal(await exists(path.join(output, rel)), false, `must be excluded: ${rel}`);
  }

  // Byte parity for a copied file
  assert.equal(
    await fs.readFile(path.join(output, "kb/topics/sample-topic.md"), "utf8"),
    await fs.readFile(path.join(sourceRoot, "kb/topics/sample-topic.md"), "utf8"),
  );

  // --- Validate / resume / search from the export ------------------------------
  const validation = await validateAllProjects({ repoRoot: output, scanRoots: ["kb"] });
  assert.equal(validation.length, 1);
  assert.equal(validation[0].valid, true, JSON.stringify(validation[0].issues));

  const resumed = await resumeProject({ projectId: "export-pilot" }, output, [
    "kb",
    "source-docs",
    "project-notes",
    "readme.md",
  ]);
  assert.equal(resumed.structured.projectId, "export-pilot");
  assert.equal(resumed.structured.title, "Export Pilot");

  await assert.rejects(
    () => resumeProject({ projectId: "missing" }, output, ["kb"]),
    /Unknown project ID/,
  );

  const bm25 = await getKbRetriever({
    repoRoot: output,
    scanRoots: ["kb", "source-docs", "project-notes", "readme.md"],
    cachePath: ".cache/export-bm25.json",
    forceRefresh: true,
  });
  const sqlite = await getSqliteKbRetriever({
    repoRoot: output,
    scanRoots: ["kb", "source-docs", "project-notes", "readme.md"],
    cachePath: ".cache/export.sqlite",
    forceRefresh: true,
  });
  const bm25Hit = bm25.search({ query: "uniqueexporttoken", mode: "generic", limit: 3 });
  const sqliteHit = sqlite.search({ query: "uniqueexporttoken", mode: "generic", limit: 3 });
  assert.ok(
    bm25Hit.hits[0]?.path?.startsWith("kb/"),
    "BM25 should resolve the unique token in the export",
  );
  assert.ok(
    sqliteHit.hits[0]?.path?.startsWith("kb/"),
    "SQLite should resolve the unique token in the export",
  );

  // --- Safety: unsafe scan root rejected --------------------------------------
  await assert.rejects(
    () =>
      exportWorkspace({ repoRoot: sourceRoot, output: `${output}-x`, scanRoots: ["../escape"] }),
    /Unsafe scan root path/,
  );

  // --- Safety: refuse to replace a non-marked destination ----------------------
  const foreignDir = path.join(outputParent, "foreign");
  await fs.mkdir(foreignDir, { recursive: true });
  await fs.writeFile(path.join(foreignDir, "keep.txt"), "do not delete\n", "utf8");
  await assert.rejects(
    () =>
      exportWorkspace({ repoRoot: sourceRoot, output: foreignDir, force: true, sourceCommit: "x" }),
    /not generated by this exporter/,
  );
  assert.equal(
    await exists(path.join(foreignDir, "keep.txt")),
    true,
    "foreign data must be left untouched",
  );

  // --- Safety: replacing a marked destination requires --force -----------------
  await assert.rejects(
    () => exportWorkspace({ repoRoot: sourceRoot, output, sourceCommit: "again" }),
    /--force to replace/,
  );
  const replaced = await exportWorkspace({
    repoRoot: sourceRoot,
    output,
    force: true,
    sourceCommit: "again",
    now: () => new Date("2026-06-23T00:00:00.000Z"),
  });
  assert.equal(replaced.manifest.sourceCommit, "again");

  // --- Dry run writes nothing --------------------------------------------------
  const dryOutput = path.join(outputParent, "dry-output");
  const dry = await exportWorkspace({ repoRoot: sourceRoot, output: dryOutput, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.fileCount > 0);
  assert.equal(await exists(dryOutput), false, "dry run must not create the destination");

  console.log("Workspace export integration test passed.");
} finally {
  await fs.rm(sourceRoot, { recursive: true, force: true });
  await fs.rm(outputParent, { recursive: true, force: true });
}

async function write(relPath: string, content: string): Promise<void> {
  const target = path.join(sourceRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
