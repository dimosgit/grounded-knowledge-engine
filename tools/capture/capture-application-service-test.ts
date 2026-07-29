#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  createCaptureApplicationService,
  type CapturePlanInput,
  type GroundedCaptureInput,
} from "./capture-application-service.js";
import { renderCaptureNote } from "./capture-service.js";

async function main(): Promise<void> {
  const rootA = await createWorkspaceFixture("alpha");
  const rootB = await createWorkspaceFixture("beta");
  try {
    const workspaceA = await loadTestWorkspace(rootA);
    const workspaceB = await loadTestWorkspace(rootB);
    let refreshes = 0;
    const captureService = createCaptureApplicationService({
      repoRoot: rootA,
      workspace: workspaceA,
      refresh: async () => {
        refreshes += 1;
      },
    });

    const createPlan = await captureService.plan({
      sourceOperation: "upsert",
      kind: "topic",
      title: "Pinned Capture",
      body: "The application service owns its workspace context.",
      requestedPath: "kb/topics/pinned-capture.md",
      track: "knowledge",
      module: "capture",
      updated: "2026-07-29",
      persist: false,
      repoRoot: rootB,
      workspace: workspaceB,
    } as CapturePlanInput);
    assert.equal(createPlan.proposal.requiresReview, false);
    assert.equal(createPlan.proposal.proposedNote.path, "kb/topics/pinned-capture.md");

    const dryCreate = await captureService.applyUnreviewed(createPlan.proposal, {
      dryRun: true,
      repoRoot: rootB,
      workspace: workspaceB,
      refresh: async () => {
        throw new Error("A request-scoped refresh callback must not run.");
      },
    } as { dryRun?: boolean });
    assert.equal(dryCreate.dryRun, true);
    assert.equal(refreshes, 0);
    assert.equal(await exists(path.join(rootA, dryCreate.path)), false);

    const created = await captureService.applyUnreviewed(createPlan.proposal);
    assert.equal(created.action, "created");
    assert.equal(refreshes, 1);
    assert.equal(
      await fs.readFile(path.join(rootA, created.path), "utf8"),
      renderCaptureNote(createPlan.proposal.proposedNote, workspaceA.domain),
    );
    assert.equal(await exists(path.join(rootB, created.path)), false);

    const replacement = await captureService.plan({
      sourceOperation: "upsert",
      kind: "topic",
      title: "Pinned Capture",
      body: "The application service also owns proposal review and refresh behavior.",
      requestedPath: created.path,
      track: "knowledge",
      module: "capture",
      proposedAction: "replace",
      updated: "2026-07-29",
    });
    assert.equal(replacement.proposal.requiresReview, true);
    assert.ok(replacement.proposalPath);
    assert.deepEqual(
      (await captureService.list()).map((proposal) => proposal.proposalId),
      [replacement.proposal.proposalId],
    );
    assert.equal(
      (await captureService.listSummaries())[0]?.proposalId,
      replacement.proposal.proposalId,
    );
    assert.equal(
      (await captureService.get(replacement.proposal.proposalId)).proposalId,
      replacement.proposal.proposalId,
    );
    assert.equal((await captureService.preview(replacement.proposal.proposalId)).stale, false);

    const beforeReplace = await fs.readFile(path.join(rootA, created.path), "utf8");
    const dryReplace = await captureService.apply({
      proposalId: replacement.proposal.proposalId,
      action: "replace",
      dryRun: true,
      repoRoot: rootB,
      workspace: workspaceB,
      refresh: async () => {
        throw new Error("A request-scoped refresh callback must not run.");
      },
    } as Parameters<typeof captureService.apply>[0]);
    assert.equal(dryReplace.dryRun, true);
    assert.equal(refreshes, 1);
    assert.equal(await fs.readFile(path.join(rootA, created.path), "utf8"), beforeReplace);
    assert.equal((await captureService.list()).length, 1);

    const applied = await captureService.apply({
      proposalId: replacement.proposal.proposalId,
      action: "replace",
    });
    assert.equal(applied.action, "replaced");
    assert.equal(refreshes, 2);
    assert.equal((await captureService.list()).length, 0);
    assert.equal(await exists(path.join(rootB, applied.path)), false);

    const rejectedPlan = await captureService.plan({
      sourceOperation: "answer",
      kind: "topic",
      title: "Pinned Capture",
      body: "This proposed replacement will be rejected.",
      requestedPath: created.path,
      track: "knowledge",
      module: "capture",
      proposedAction: "replace",
      updated: "2026-07-29",
    });
    const beforeReject = await fs.readFile(path.join(rootA, created.path), "utf8");
    assert.equal(
      (await captureService.reject(rejectedPlan.proposal.proposalId, true)).dryRun,
      true,
    );
    assert.equal((await captureService.list()).length, 1);
    assert.equal(refreshes, 2);
    assert.equal((await captureService.reject(rejectedPlan.proposal.proposalId)).rejected, true);
    assert.equal((await captureService.list()).length, 0);
    assert.equal(refreshes, 2);
    assert.equal(await fs.readFile(path.join(rootA, created.path), "utf8"), beforeReject);

    const groundedCapture = await captureService.captureGrounded({
      grounded: {
        question: "Where is capture context owned?",
        answer: "The capture application service owns the operational context.",
        abstained: false,
        citations: [{ path: created.path, line: 8, score: 12 }],
        evidence: [
          {
            path: created.path,
            track: "knowledge",
            module: "capture",
            score: 12,
          },
        ],
        confidence: { label: "high", score: 0.94 },
      },
      title: "Grounded Pinned Capture",
      requestedPath: "kb/topics/grounded-pinned-capture.md",
      track: "knowledge",
      module: "capture",
      owner: "test",
      repoRoot: rootB,
      workspace: workspaceB,
      refresh: async () => {
        throw new Error("A request-scoped refresh callback must not run.");
      },
    } as GroundedCaptureInput);
    assert.equal(groundedCapture.action, "created");
    assert.equal(refreshes, 3);
    assert.equal(await exists(path.join(rootA, groundedCapture.path)), true);
    assert.equal(await exists(path.join(rootB, groundedCapture.path)), false);

    console.log(
      "Capture application service tests passed (lifecycle, dry run, refresh, pinned context).",
    );
  } finally {
    await Promise.all([
      fs.rm(rootA, { recursive: true, force: true }),
      fs.rm(rootB, { recursive: true, force: true }),
    ]);
  }
}

async function createWorkspaceFixture(name: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), `gke-capture-app-${name}-`));
  await fs.mkdir(path.join(repoRoot, "kb/topics"), { recursive: true });
  return repoRoot;
}

async function loadTestWorkspace(repoRoot: string): Promise<WorkspaceContext> {
  return loadWorkspaceContext({
    repoRoot,
    scanRoots: ["kb"],
    writeRoots: ["kb", ".gke"],
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
