#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProject,
  getProject,
  linkProjectSource,
  listProjects,
  updateProject,
  validateAllProjects,
  validateProject,
} from "./project-service.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-service-"));

try {
  const dryRun = await createProject({
    repoRoot: root,
    projectId: "alpha-pilot",
    title: "Alpha Pilot",
    owner: "tester",
    track: "knowledge-ops",
    tags: ["alpha", "pilot"],
    dryRun: true,
  });
  assert.equal(dryRun.dryRun, true);
  assert.match(dryRun.content, /project_id: alpha-pilot/);
  assert.match(dryRun.content, /track: knowledge-ops/);
  assert.equal(await exists(path.join(root, dryRun.path)), false);

  const created = await createProject({
    repoRoot: root,
    projectId: "alpha-pilot",
    title: "Alpha Pilot",
    owner: "tester",
    track: "knowledge-ops",
    workspaceId: "personal",
    status: "planned",
    tags: ["alpha", "pilot"],
  });
  assert.equal(created.path, "kb/projects/alpha-pilot/project.md");
  assert.equal(await exists(path.join(root, created.path)), true);
  assert.equal(await exists(path.join(root, "kb/sources/alpha-pilot")), true);

  const loaded = await getProject("alpha-pilot", { repoRoot: root, scanRoots: ["kb"] });
  assert.equal(loaded.parsed.manifest.title, "Alpha Pilot");
  assert.equal(loaded.parsed.manifest.status, "planned");
  assert.match(loaded.raw, /lifecycle: next/);
  assert.match(loaded.raw, /track: knowledge-ops/);

  const listed = await listProjects({ repoRoot: root, scanRoots: ["kb"] });
  assert.deepEqual(
    listed.map((project) => project.projectId),
    ["alpha-pilot"],
  );

  const valid = await validateProject("alpha-pilot", { repoRoot: root, scanRoots: ["kb"] });
  assert.equal(valid.valid, true, JSON.stringify(valid.issues));
  assert.deepEqual(valid.issues, []);

  await fs.appendFile(
    path.join(root, created.path),
    "\n## Custom operator notes\n\nPreserve this section exactly.\n",
  );
  const beforeUpdate = await fs.readFile(path.join(root, created.path), "utf8");
  const withUnknownField = beforeUpdate.replace(
    "tags: alpha, pilot",
    "tags: alpha, pilot\ncustom_field: keep-me",
  );
  await fs.writeFile(path.join(root, created.path), withUnknownField, "utf8");

  const updateDryRun = await updateProject({
    repoRoot: root,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    owner: "updated-owner",
    sections: {
      "current-focus": "Finish the supported project CLI.",
      "active-decisions": ["Keep Markdown canonical.", "Preserve unknown sections."],
      "next-actions": ["Run validation.", "Link evidence.", "Resume the project."],
    },
    dryRun: true,
  });
  assert.equal(updateDryRun.changed, true);
  assert.match(updateDryRun.content, /owner: updated-owner/);
  assert.match(updateDryRun.content, /custom_field: keep-me/);
  assert.match(updateDryRun.content, /## Custom operator notes\n\nPreserve this section exactly\./);
  assert.match(updateDryRun.content, /1\. Run validation\./);
  assert.doesNotMatch(await fs.readFile(path.join(root, created.path), "utf8"), /updated-owner/);

  await updateProject({
    repoRoot: root,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    owner: "updated-owner",
    sections: {
      "current-focus": "Finish the supported project CLI.",
      "active-decisions": ["Keep Markdown canonical.", "Preserve unknown sections."],
      "next-actions": ["Run validation.", "Link evidence.", "Resume the project."],
    },
  });
  const updatedRaw = await fs.readFile(path.join(root, created.path), "utf8");
  assert.match(updatedRaw, /owner: updated-owner/);
  assert.match(updatedRaw, /custom_field: keep-me/);
  assert.match(updatedRaw, /## Custom operator notes\n\nPreserve this section exactly\./);

  await write(root, "notes/alpha-evidence.md", "# Alpha Evidence\n\nExplicitly linked evidence.\n");
  const linked = await linkProjectSource({
    repoRoot: root,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    sourcePath: "notes/alpha-evidence.md",
    label: "Alpha evidence",
  });
  assert.equal(linked.changed, true);
  const linkedRaw = await fs.readFile(path.join(root, created.path), "utf8");
  assert.match(linkedRaw, /\[Alpha evidence\]\(\.\.\/\.\.\/\.\.\/notes\/alpha-evidence\.md\)/);
  const relinked = await linkProjectSource({
    repoRoot: root,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    sourcePath: "notes/alpha-evidence.md",
    label: "Alpha evidence",
  });
  assert.equal(relinked.changed, false);
  assert.equal(
    (relinked.content.match(/notes\/alpha-evidence\.md/g) || []).length,
    1,
    "linking the same source must be idempotent",
  );
  await assert.rejects(
    () =>
      linkProjectSource({
        repoRoot: root,
        projectId: "alpha-pilot",
        sourcePath: "../outside.md",
      }),
    /Unsafe workspace-relative path/,
  );

  await assert.rejects(
    () => createProject({ repoRoot: root, projectId: "Alpha Pilot" }),
    /canonical lowercase slug/,
  );
  await assert.rejects(
    () => createProject({ repoRoot: root, projectId: "escape", sourceRoots: ["../outside"] }),
    /Unsafe workspace-relative path/,
  );
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-outside-"));
  try {
    await fs.mkdir(path.join(root, "kb", "sources"), { recursive: true });
    await fs.symlink(outside, path.join(root, "kb", "sources", "external"));
    await assert.rejects(
      () =>
        createProject({
          repoRoot: root,
          projectId: "symlink-escape",
          sourceRoots: ["kb/sources/external"],
        }),
      /symlink/,
    );
    assert.equal(
      await exists(path.join(root, "kb/projects/symlink-escape/project.md")),
      false,
      "unsafe source roots must be rejected before creating the project record",
    );
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
  await assert.rejects(
    () => createProject({ repoRoot: root, projectId: "alpha-pilot" }),
    /already exists/,
  );

  await write(
    root,
    "kb/projects/broken-project/project.md",
    `---
schema_version: 2
record_type: note
workspace_id: personal
project_id: broken-project
title: Broken Project
status: active
lifecycle: mystery
owner: tester
started_at: 2026-02-30
updated: bad-date
review_after: 2026-07-05
source_roots: kb/sources/missing
---

# Broken Project

## Outcome

Test validation.

## Key documents

- [Missing evidence](../../sources/missing/evidence.md)
`,
  );
  const broken = await validateProject("broken-project", { repoRoot: root, scanRoots: ["kb"] });
  assert.equal(broken.valid, false);
  const brokenCodes = new Set(broken.issues.map((issue) => issue.code));
  assert.ok(brokenCodes.has("unsupported-schema-version"));
  assert.ok(brokenCodes.has("invalid-record-type"));
  assert.ok(brokenCodes.has("invalid-lifecycle"));
  assert.ok(brokenCodes.has("invalid-date"));
  assert.ok(brokenCodes.has("missing-section"));
  assert.ok(brokenCodes.has("missing-source-root"));
  assert.ok(brokenCodes.has("broken-project-link"));

  await write(
    root,
    "demo-kb/projects/alpha-copy/project.md",
    `---
schema_version: 1
record_type: project
workspace_id: demo
project_id: alpha-pilot
title: Duplicate Alpha
status: active
owner: tester
started_at: 2026-06-01
updated: 2026-06-22
review_after: 2026-07-01
---

# Duplicate Alpha

## Outcome
Duplicate.
## Current focus
Duplicate.
## Last meaningful change
Duplicate.
## Active decisions
- None.
## Blockers
- None.
## Open questions
- None.
## Next actions
1. None.
## Key documents
- None.
`,
  );
  const duplicate = await validateProject("alpha-pilot", { repoRoot: root });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === "duplicate-project-id"));
  await assert.rejects(() => getProject("alpha-pilot", { repoRoot: root }), /Duplicate project ID/);

  const all = await validateAllProjects({ repoRoot: root });
  assert.equal(all.length, 2);
  assert.ok(all.some((result) => result.projectId === "broken-project" && !result.valid));

  const cliRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-cli-"));
  try {
    const createResult = await runCli([
      "create",
      "cli-project",
      "--repo-root",
      cliRoot,
      "--title",
      "CLI Project",
      "--owner",
      "cli-test",
    ]);
    assert.equal(createResult.code, 0, createResult.stderr);
    assert.match(createResult.stdout, /Created project cli-project/);

    const validateResult = await runCli(["validate", "cli-project", "--repo-root", cliRoot]);
    assert.equal(validateResult.code, 0, validateResult.stderr);
    assert.match(validateResult.stdout, /PASS cli-project/);

    const listResult = await runCli(["list", "--repo-root", cliRoot, "--json"]);
    assert.equal(listResult.code, 0, listResult.stderr);
    assert.match(listResult.stdout, /"projectId": "cli-project"/);

    const updateResult = await runCli([
      "update",
      "cli-project",
      "--repo-root",
      cliRoot,
      "--current-focus",
      "Exercise the CLI update path.",
      "--next-action",
      "Validate the project.",
      "--next-action",
      "Link a source.",
    ]);
    assert.equal(updateResult.code, 0, updateResult.stderr);
    assert.match(updateResult.stdout, /Updated project cli-project/);

    await write(cliRoot, "notes/cli-source.md", "# CLI Source\n");
    const linkResult = await runCli([
      "link",
      "cli-project",
      "notes/cli-source.md",
      "--repo-root",
      cliRoot,
      "--label",
      "CLI source",
    ]);
    assert.equal(linkResult.code, 0, linkResult.stderr);
    assert.match(linkResult.stdout, /Linked notes\/cli-source\.md to cli-project/);

    const rawResult = await runCli(["show", "cli-project", "--repo-root", cliRoot, "--raw"]);
    assert.match(rawResult.stdout, /Exercise the CLI update path/);
    assert.match(rawResult.stdout, /\[CLI source\]/);

    const invalidResult = await runCli(["create", "Bad Project", "--repo-root", cliRoot]);
    assert.equal(invalidResult.code, 1);
    assert.match(invalidResult.stderr, /canonical lowercase slug/);

    const unknownOptionResult = await runCli([
      "update",
      "cli-project",
      "--repo-root",
      cliRoot,
      "--focus",
      "This typo must not be ignored.",
    ]);
    assert.equal(unknownOptionResult.code, 1);
    assert.match(unknownOptionResult.stderr, /Unknown option for 'update': --focus/);
  } finally {
    await fs.rm(cliRoot, { recursive: true, force: true });
  }

  console.log("Project service and CLI tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function write(repoRoot: string, relPath: string, content: string): Promise<void> {
  const target = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const tsxBin = path.resolve("node_modules/.bin/tsx");
  const cliPath = path.resolve("tools/projects/cli.ts");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, cliPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
