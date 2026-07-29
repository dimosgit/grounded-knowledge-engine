#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { createProjectCheckpoint, listProjectCheckpoints } from "./checkpoint-service.js";
import { resumeProject } from "./project-capsule.js";
import { createProject } from "./project-service.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-checkpoint-service-"));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "gke-checkpoint-outside-"));

try {
  await fs.mkdir(path.join(root, "demo-kb"), { recursive: true });
  await fs.mkdir(path.join(root, "kb"), { recursive: true });
  const workspace = await loadWorkspaceContext({ repoRoot: root });
  await createProject({
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    title: "Alpha Pilot",
    workspaceId: "personal",
    owner: "checkpoint-tester",
    sourceRoots: ["kb/sources/alpha-pilot"],
  });
  await write(
    root,
    "kb/sources/alpha-pilot/evidence.md",
    "# Pilot Evidence\n\nThe acceptance run passed with the sanitized fixture.\n",
  );
  await write(
    root,
    "kb/sources/other/evidence.md",
    "# Other Evidence\n\nThis file is not in Alpha Pilot scope.\n",
  );

  const dryRun = await createProjectCheckpoint({
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    title: "Acceptance handoff",
    createdAt: "2026-07-29",
    whatChanged: "The acceptance workflow now passes.",
    completed: ["Ran the focused suite.", "Recorded the evidence."],
    nextStartingPoint: "Run the complete engine suite.",
    evidence: [{ path: "kb/sources/alpha-pilot/evidence.md", line: 3 }],
    dryRun: true,
  });
  assert.equal(dryRun.checkpointId, "cp-20260729-alpha-pilot-acceptance-handoff");
  assert.equal(
    dryRun.path,
    "kb/projects/alpha-pilot/checkpoints/2026-07-29-cp-20260729-alpha-pilot-acceptance-handoff.md",
  );
  assert.equal(await exists(path.join(root, dryRun.path)), false);
  assert.match(dryRun.content, /record_type: checkpoint/);
  assert.match(dryRun.content, /author: checkpoint-tester/);
  assert.match(dryRun.content, /kb\/sources\/alpha-pilot\/evidence\.md:3 — Pilot Evidence/);

  const created = await createProjectCheckpoint({
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    title: "Acceptance handoff",
    createdAt: "2026-07-29",
    whatChanged: "The acceptance workflow now passes.",
    completed: ["Ran the focused suite.", "Recorded the evidence."],
    currentBlocker: "None recorded.",
    nextStartingPoint: "Run the complete engine suite.",
    evidence: [
      { path: "kb/sources/alpha-pilot/evidence.md", line: 3 },
      { path: "kb/sources/alpha-pilot/evidence.md", line: 3 },
    ],
  });
  assert.equal(created.dryRun, false);
  assert.equal(created.evidence.length, 1);
  assert.equal(await exists(path.join(root, created.path)), true);
  if (process.platform !== "win32") {
    const mode = (await fs.stat(path.join(root, created.path))).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  const listed = await listProjectCheckpoints("alpha-pilot", {
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].checkpointId, created.checkpointId);
  assert.equal(listed[0].whatChanged, "The acceptance workflow now passes.");
  assert.deepEqual(listed[0].completed, ["Ran the focused suite.", "Recorded the evidence."]);
  assert.equal(listed[0].evidence[0].section, "Pilot Evidence");

  const resumed = await resumeProject({ projectId: "alpha-pilot" }, root, ["kb"], workspace);
  assert.equal(resumed.structured.recentChanges, "The acceptance workflow now passes.");
  assert.ok(resumed.structured.citations.some((citation) => citation.path === created.path));

  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        title: "Duplicate",
        checkpointId: created.checkpointId,
        createdAt: "2026-07-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
      }),
    /Checkpoint ID already exists/,
  );
  await write(
    root,
    "demo-kb/projects/example/checkpoints/2026-07-28-cp-shared-id.md",
    `---
schema_version: 1
record_type: checkpoint
workspace_id: demo
project_id: example
checkpoint_id: cp-shared-id
created_at: 2026-07-28
author: demo
---

# Checkpoint — Shared ID
`,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        projectId: "alpha-pilot",
        title: "Workspace duplicate",
        checkpointId: "cp-shared-id",
        createdAt: "2026-07-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
      }),
    /Checkpoint ID already exists.*demo-kb/,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        title: "Out of scope",
        createdAt: "2026-07-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
        evidence: [{ path: "kb/sources/other/evidence.md", line: 3 }],
      }),
    /outside explicit project scope/,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        title: "Invalid line",
        createdAt: "2026-07-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
        evidence: [{ path: "kb/sources/alpha-pilot/evidence.md", line: 999 }],
      }),
    /outside .*lines/,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        checkpointId: "Bad Checkpoint",
        title: "Invalid ID",
        createdAt: "2026-07-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
      }),
    /canonical lowercase slug/,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        title: "Invalid date",
        createdAt: "2026-02-30",
        whatChanged: "This must not be written.",
        nextStartingPoint: "Stop.",
      }),
    /valid YYYY-MM-DD/,
  );
  await assert.rejects(
    () =>
      createProjectCheckpoint({
        repoRoot: root,
        workspace,
        scanRoots: ["kb"],
        projectId: "alpha-pilot",
        title: "Injected section",
        createdAt: "2026-07-30",
        whatChanged: "A valid first paragraph.\n\n## Evidence\n\nInjected content.",
        nextStartingPoint: "Stop.",
      }),
    /cannot inject checkpoint section headings/,
  );

  const outsideEvidence = path.join(outside, "outside.md");
  await fs.writeFile(outsideEvidence, "# Outside\n\nNot allowed.\n", "utf8");
  const linkedEvidence = path.join(root, "kb", "sources", "alpha-pilot", "linked.md");
  try {
    await fs.symlink(outsideEvidence, linkedEvidence);
    await assert.rejects(
      () =>
        createProjectCheckpoint({
          repoRoot: root,
          workspace,
          scanRoots: ["kb"],
          projectId: "alpha-pilot",
          title: "Symlink escape",
          createdAt: "2026-07-30",
          whatChanged: "This must not be written.",
          nextStartingPoint: "Stop.",
          evidence: [{ path: "kb/sources/alpha-pilot/linked.md", line: 1 }],
        }),
      /outside .*root|symlink/i,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const concurrentOptions = {
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    title: "Concurrent checkpoint",
    createdAt: "2026-07-30",
    whatChanged: "Only one append-only record should be created.",
    nextStartingPoint: "Inspect the result.",
  };
  const concurrent = await Promise.allSettled([
    createProjectCheckpoint(concurrentOptions),
    createProjectCheckpoint(concurrentOptions),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

  const cliResult = await runCli([
    "checkpoint",
    "alpha-pilot",
    "--repo-root",
    root,
    "--title",
    "CLI handoff",
    "--created-at",
    "2026-07-31",
    "--what-changed",
    "The CLI checkpoint path works.",
    "--completed",
    "Ran the CLI.",
    "--next-start",
    "Review the generated Markdown.",
    "--evidence",
    "kb/sources/alpha-pilot/evidence.md:3",
    "--json",
  ]);
  assert.equal(cliResult.code, 0, cliResult.stderr);
  const cliCheckpoint = JSON.parse(cliResult.stdout);
  assert.equal(cliCheckpoint.projectId, "alpha-pilot");
  assert.equal(cliCheckpoint.dryRun, false);
  assert.match(
    cliCheckpoint.path,
    /checkpoints\/2026-07-31-cp-20260731-alpha-pilot-cli-handoff\.md$/,
  );

  await fs.mkdir(path.join(root, ".gke"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".gke", "workspace.json"),
    `${JSON.stringify(
      {
        id: "read-only-checkpoints",
        label: "Read-only checkpoints",
        scanRoots: ["demo-kb", "kb"],
        writeRoots: ["kb", ".gke"],
        readOnly: true,
        sensitivity: "internal",
      },
      null,
      2,
    )}\n`,
  );
  const readOnlyResult = await runCli([
    "checkpoint",
    "alpha-pilot",
    "--repo-root",
    root,
    "--title",
    "Blocked checkpoint",
    "--created-at",
    "2026-08-01",
    "--what-changed",
    "This must not be written.",
    "--next-start",
    "Stop.",
  ]);
  assert.equal(readOnlyResult.code, 1);
  assert.match(readOnlyResult.stderr, /read-only/i);
  assert.equal(
    await exists(
      path.join(
        root,
        "kb/projects/alpha-pilot/checkpoints/2026-08-01-cp-20260801-alpha-pilot-blocked-checkpoint.md",
      ),
    ),
    false,
  );

  console.log("Project checkpoint service and CLI tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
}

async function write(repoRoot: string, relPath: string, content: string): Promise<void> {
  const target = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
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
