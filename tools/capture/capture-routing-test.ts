#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCaptureRoute } from "./capture-routing.js";

async function testExplicitContextWins(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    await seedProject(repoRoot, "route-project", "project-track", "project-module");
    const result = await resolveCaptureRoute({
      repoRoot,
      requestedPath: "kb/topics/explicit.md",
      track: "explicit-track",
      module: "explicit-module",
      projectId: "route-project",
      defaults: {
        path: "kb/topics/default.md",
        track: "default-track",
        module: "default-module",
      },
      evidence: [
        {
          path: "kb/topics/evidence-a.md",
          track: "evidence-track",
          module: "evidence-module",
          projectId: "route-project",
        },
        {
          path: "kb/topics/evidence-b.md",
          track: "evidence-track",
          module: "evidence-module",
          projectId: "route-project",
        },
      ],
    });

    assert.equal(result.status, "resolved");
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(result.fields).map(([key, field]) => [key, [field.value, field.source]]),
      ),
      {
        path: ["kb/topics/explicit.md", "explicit"],
        track: ["explicit-track", "explicit"],
        module: ["explicit-module", "explicit"],
        projectId: ["route-project", "explicit"],
      },
    );
  });
}

async function testIdentifiedProjectSuppliesDefaults(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    await seedProject(repoRoot, "route-project", "project-track", "project-module");
    const result = await resolveCaptureRoute({
      repoRoot,
      projectId: "route-project",
      defaults: {
        path: "kb/topics/default.md",
        track: "default-track",
        module: "default-module",
      },
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.fields.projectId.value, "route-project");
    assert.equal(result.fields.projectId.source, "explicit");
    assert.equal(result.fields.track.value, "project-track");
    assert.equal(result.fields.track.source, "identified-project");
    assert.equal(result.fields.module.value, "project-module");
    assert.equal(result.fields.module.source, "identified-project");
    assert.equal(result.fields.path.value, "kb/topics/default.md");
    assert.equal(result.fields.path.source, "workspace-default");
  });
}

async function testInvalidExplicitProjectRequiresReview(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const result = await resolveCaptureRoute({
      repoRoot,
      projectId: "missing-project",
      defaults: { track: "default-track", module: "default-module" },
    });

    assert.equal(result.status, "review_required");
    assert.equal(result.fields.projectId.value, null);
    assert.ok(result.reviewReasons.includes("invalid-explicit-project"));
    assert.equal(result.ambiguities[0]?.reason, "invalid-explicit-project");
  });
}

async function testEvidenceIsDeduplicatedByPath(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const insufficient = await resolveCaptureRoute({
      repoRoot,
      defaults: { track: "default-track", module: "default-module" },
      evidence: [
        { path: "kb/topics/a.md", track: "evidence-track", module: "evidence-module" },
        { path: "./kb/topics/a.md", track: "evidence-track", module: "evidence-module" },
      ],
    });
    assert.deepEqual(insufficient.evidencePaths, ["kb/topics/a.md"]);
    assert.equal(insufficient.status, "resolved");
    assert.equal(insufficient.fields.track.value, "default-track");
    assert.ok(!insufficient.reviewReasons.includes("ambiguous-evidence-track"));

    const consensus = await resolveCaptureRoute({
      repoRoot,
      evidence: [
        { path: "kb/topics/a.md", track: "evidence-track", module: "evidence-module" },
        { path: "./kb/topics/a.md", track: "evidence-track", module: "evidence-module" },
        { path: "kb/topics/b.md", track: "evidence-track", module: "evidence-module" },
      ],
    });
    assert.equal(consensus.status, "resolved");
    assert.equal(consensus.fields.track.value, "evidence-track");
    assert.equal(consensus.fields.track.source, "evidence-consensus");
    assert.equal(consensus.fields.module.value, "evidence-module");
    assert.equal(consensus.fields.module.source, "evidence-consensus");
  });
}

async function testEvidenceDisagreementStaysReviewable(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const result = await resolveCaptureRoute({
      repoRoot,
      defaults: { track: "default-track", module: "default-module" },
      evidence: [
        { path: "kb/topics/a.md", track: "shared-track", module: "module-a" },
        { path: "kb/topics/b.md", track: "shared-track", module: "module-b" },
      ],
    });

    assert.equal(result.status, "review_required");
    assert.equal(result.fields.module.value, "default-module");
    assert.equal(result.fields.module.source, "workspace-default");
    assert.ok(result.reviewReasons.includes("ambiguous-evidence-module"));
    assert.ok(
      result.ambiguities.some(
        (item) => item.field === "module" && item.reason === "evidence-disagreement",
      ),
    );
  });
}

async function testEvidenceProjectMembershipAlwaysRequiresReview(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    await seedProject(repoRoot, "evidence-project", "project-track", "project-module");
    const result = await resolveCaptureRoute({
      repoRoot,
      evidence: [
        {
          path: "kb/sources/evidence-project/a.md",
          track: "project-track",
          module: "project-module",
          projectId: "evidence-project",
        },
        {
          path: "kb/sources/evidence-project/b.md",
          track: "project-track",
          module: "project-module",
          projectId: "evidence-project",
        },
      ],
    });

    assert.equal(result.fields.projectId.value, "evidence-project");
    assert.equal(result.fields.projectId.source, "evidence-consensus");
    assert.equal(result.status, "review_required");
    assert.ok(result.reviewReasons.includes("evidence-project-membership-requires-review"));
  });
}

async function testUnknownEvidenceProjectIsNotAssigned(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const result = await resolveCaptureRoute({
      repoRoot,
      evidence: [
        {
          path: "kb/sources/missing/a.md",
          track: "project-track",
          module: "project-module",
          projectId: "missing-project",
        },
        {
          path: "kb/sources/missing/b.md",
          track: "project-track",
          module: "project-module",
          projectId: "missing-project",
        },
      ],
    });

    assert.equal(result.fields.projectId.value, null);
    assert.equal(result.status, "review_required");
    assert.ok(result.reviewReasons.includes("invalid-routed-project"));
  });
}

async function testExplicitProjectConflictWithEvidenceRequiresReview(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    await seedProject(repoRoot, "explicit-project", "explicit-track", "explicit-module");
    const result = await resolveCaptureRoute({
      repoRoot,
      projectId: "explicit-project",
      evidence: [
        {
          path: "kb/sources/other/a.md",
          projectId: "other-project",
        },
        {
          path: "kb/sources/other/b.md",
          projectId: "other-project",
        },
      ],
    });

    assert.equal(result.fields.projectId.value, "explicit-project");
    assert.equal(result.status, "review_required");
    assert.ok(result.reviewReasons.includes("evidence-project-conflict"));
  });
}

const tests = [
  testExplicitContextWins,
  testIdentifiedProjectSuppliesDefaults,
  testInvalidExplicitProjectRequiresReview,
  testEvidenceIsDeduplicatedByPath,
  testEvidenceDisagreementStaysReviewable,
  testEvidenceProjectMembershipAlwaysRequiresReview,
  testUnknownEvidenceProjectIsNotAssigned,
  testExplicitProjectConflictWithEvidenceRequiresReview,
];

let failures = 0;
for (const test of tests) {
  try {
    await test();
    console.log(`  ✓ ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${test.name}:`, error);
  }
}
if (failures) process.exitCode = 1;
else console.log(`Capture routing tests passed (${tests.length}/${tests.length}).`);

async function withWorkspace(work: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-capture-routing-"));
  try {
    await work(repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

async function seedProject(
  repoRoot: string,
  projectId: string,
  track: string,
  captureModule: string,
): Promise<void> {
  const target = path.join(repoRoot, "kb", "projects", projectId, "project.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    `---
schema_version: 1
record_type: project
workspace_id: test
project_id: ${projectId}
title: ${projectId}
status: active
lifecycle: active
owner: test
track: ${track}
capture_module: ${captureModule}
started_at: 2026-07-13
updated: 2026-07-13
review_after: 2026-07-27
---

# ${projectId}
`,
    "utf8",
  );
}
