import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import {
  createProjectApplicationService,
  type CreateProjectInput,
} from "./project-application-service.js";

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-application-"));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-application-outside-"));

try {
  await fs.mkdir(path.join(repoRoot, "kb"), { recursive: true });
  await fs.mkdir(path.join(outsideRoot, "kb", "projects"), { recursive: true });
  const workspace = await loadWorkspaceContext({ repoRoot, scanRoots: ["kb"] });
  let refreshCount = 0;
  const service = createProjectApplicationService({
    repoRoot,
    scanRoots: ["kb"],
    workspace,
    refresh: async () => {
      refreshCount += 1;
    },
  });

  const preview = await service.create({
    projectId: "preview-project",
    title: "Preview Project",
    dryRun: true,
  });
  assert.equal(preview.dryRun, true);
  assert.equal(refreshCount, 0);
  await assert.rejects(fs.access(path.join(repoRoot, preview.path)));

  const pinnedInput = {
    projectId: "alpha-project",
    title: "Alpha Project",
    workspaceId: "test",
    owner: "application-service-test",
    sourceRoots: ["kb/sources/alpha-project"],
    repoRoot: outsideRoot,
  } as CreateProjectInput;
  const created = await service.create(pinnedInput);
  assert.equal(refreshCount, 1);
  await fs.access(path.join(repoRoot, created.path));
  await assert.rejects(fs.access(path.join(outsideRoot, created.path)));

  assert.equal((await service.get(created.projectId)).path, created.path);
  assert.deepEqual(
    (await service.list()).map((project) => project.projectId),
    [created.projectId],
  );
  assert.equal((await service.validate(created.projectId)).valid, true);
  assert.equal((await service.validateAll()).length, 1);

  const updatePreview = await service.update({
    projectId: created.projectId,
    owner: "updated-owner",
    dryRun: true,
  });
  assert.equal(updatePreview.dryRun, true);
  assert.equal(refreshCount, 1);

  const updated = await service.update({
    projectId: created.projectId,
    owner: "updated-owner",
  });
  assert.equal(updated.changed, true);
  assert.equal(refreshCount, 2);

  await service.addTask({
    projectId: created.projectId,
    text: "Verify the project application boundary",
    size: "S",
  });
  assert.equal(refreshCount, 3);

  await fs.writeFile(
    path.join(repoRoot, "kb", "sources", "alpha-project", "evidence.md"),
    "# Project evidence\n\nThe application boundary is shared.\n",
    "utf8",
  );
  const linked = await service.linkSource({
    projectId: created.projectId,
    sourcePath: "kb/sources/alpha-project/evidence.md",
    label: "Project evidence",
  });
  assert.equal(linked.changed, true);
  assert.equal(refreshCount, 4);
  const relinked = await service.linkSource({
    projectId: created.projectId,
    sourcePath: "kb/sources/alpha-project/evidence.md",
    label: "Project evidence",
  });
  assert.equal(relinked.changed, false);
  assert.equal(refreshCount, 4);

  const checkpointPreview = await service.createCheckpoint({
    projectId: created.projectId,
    title: "Boundary preview",
    createdAt: "2026-07-29",
    whatChanged: "The shared boundary was previewed.",
    nextStartingPoint: "Apply the checkpoint.",
    evidence: [{ path: "kb/sources/alpha-project/evidence.md", line: 3 }],
    dryRun: true,
  });
  assert.equal(checkpointPreview.dryRun, true);
  assert.equal(refreshCount, 4);

  const checkpoint = await service.createCheckpoint({
    projectId: created.projectId,
    title: "Boundary applied",
    createdAt: "2026-07-29",
    whatChanged: "The shared boundary now drives every adapter.",
    nextStartingPoint: "Run the complete verification suite.",
    evidence: [{ path: "kb/sources/alpha-project/evidence.md", line: 3 }],
  });
  assert.equal(checkpoint.dryRun, false);
  assert.equal(refreshCount, 5);
  assert.deepEqual(
    (await service.listCheckpoints(created.projectId)).map((item) => item.checkpointId),
    [checkpoint.checkpointId],
  );

  const resumed = await service.resume(created.projectId);
  assert.equal(resumed.structured.projectId, created.projectId);
  assert.equal(resumed.structured.recentChanges, "The shared boundary now drives every adapter.");
  const review = await service.review({ projectId: created.projectId, asOf: "2026-07-29" });
  assert.equal(review.structured.projectCount, 1);
  assert.equal(review.structured.projects[0].projectId, created.projectId);

  console.log("Project application service tests passed.");
} finally {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
}
