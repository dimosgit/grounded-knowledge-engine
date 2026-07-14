#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceContext } from "../workspaces/config.js";
import {
  CaptureConflictError,
  applyCaptureProposal,
  applyUnreviewedCapture,
  getCaptureProposal,
  listCaptureProposals,
  planCapture,
  rejectCaptureProposal,
  renderCaptureNote,
} from "./capture-service.js";

async function testFuzzyCandidateIsAdvisoryAndRejectIsNonMutating(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const existingPath = "kb/topics/capture-integrity-guard.md";
    const existingContent =
      "# Capture Integrity Guard\n\nUse an explicit review boundary before replacing canonical capture content.\n";
    await write(repoRoot, existingPath, existingContent);

    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Capture Integrity Guard Revised",
      body: "Use an explicit review boundary before replacing canonical capture content.",
      updated: "2026-07-13",
    });

    assert.equal(planned.targetExists, false);
    assert.equal(planned.proposal.proposedAction, "create");
    assert.equal(
      planned.proposal.proposedNote.path,
      "kb/topics/capture-integrity-guard-revised.md",
    );
    assert.equal(planned.proposal.requiresReview, true);
    assert.ok(planned.proposal.reviewReasons.includes("fuzzy-duplicate-candidate"));
    assert.equal(planned.proposal.duplicateCandidates[0]?.path, existingPath);
    assert.ok((planned.proposal.duplicateCandidates[0]?.score || 0) >= 0.7);
    assert.equal(await fs.readFile(path.join(repoRoot, existingPath), "utf8"), existingContent);
    assert.equal(await exists(path.join(repoRoot, planned.proposal.proposedNote.path)), false);

    const expectedProposalPath = `.gke/capture-proposals/${planned.proposal.proposalId}.json`;
    assert.equal(planned.proposalPath, expectedProposalPath);
    const serialized = await fs.readFile(path.join(repoRoot, expectedProposalPath), "utf8");
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(repoRoot)));
    assert.equal(JSON.parse(serialized).schemaVersion, 1);

    const listed = await listCaptureProposals(repoRoot);
    assert.deepEqual(
      listed.map((proposal) => proposal.proposalId),
      [planned.proposal.proposalId],
    );
    assert.deepEqual(
      await getCaptureProposal(repoRoot, planned.proposal.proposalId),
      planned.proposal,
    );

    const dryReject = await rejectCaptureProposal(repoRoot, planned.proposal.proposalId, true);
    assert.equal(dryReject.dryRun, true);
    assert.equal((await listCaptureProposals(repoRoot)).length, 1);

    const rejected = await rejectCaptureProposal(repoRoot, planned.proposal.proposalId);
    assert.equal(rejected.rejected, true);
    assert.equal((await listCaptureProposals(repoRoot)).length, 0);
    assert.equal(await fs.readFile(path.join(repoRoot, existingPath), "utf8"), existingContent);
    assert.equal(await exists(path.join(repoRoot, planned.proposal.proposedNote.path)), false);
  });
}

async function testExactUnreviewedCreate(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Exact New Capture",
      body: "## Result\n\nThis is an unambiguous new note.",
      requestedPath: "kb/topics/exact-new-capture.md",
      module: "knowledge-ops",
      track: "domain",
      tags: ["capture", "test", "capture"],
      updated: "2026-07-13",
    });

    assert.equal(planned.proposal.requiresReview, false);
    assert.equal(planned.proposalPath, null);
    assert.equal(planned.proposal.proposedAction, "create");
    assert.deepEqual(planned.proposal.proposedNote.tags, ["capture", "test"]);

    let refreshes = 0;
    const result = await applyUnreviewedCapture(repoRoot, planned.proposal, {
      refresh: async () => {
        refreshes += 1;
      },
    });
    assert.equal(result.action, "created");
    assert.equal(result.dryRun, false);
    assert.equal(refreshes, 1);
    assert.equal(
      await fs.readFile(path.join(repoRoot, result.path), "utf8"),
      renderCaptureNote(planned.proposal.proposedNote),
    );
  });
}

async function testEvidenceConsensusRoutesCapture(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Evidence Routed Capture",
      body: "This note inherits an agreed evidence context.",
      evidenceRoutes: [
        { path: "kb/topics/source-a.md", track: "platform", module: "capture" },
        { path: "kb/topics/source-b.md", track: "platform", module: "capture" },
      ],
      updated: "2026-07-13",
    });

    assert.equal(planned.proposal.routing?.status, "resolved");
    assert.equal(planned.proposal.routing?.fields.track.source, "evidence-consensus");
    assert.equal(planned.proposal.proposedNote.track, "platform");
    assert.equal(planned.proposal.proposedNote.module, "capture");
    assert.equal(planned.proposal.requiresReview, false);
  });
}

async function testReplaceWithMatchingHash(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/replace-target.md";
    await write(repoRoot, targetPath, "# Replace Target\n\nOld canonical content.\n");
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Replace Target",
      body: "## Current\n\nNew canonical content.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });

    assert.equal(planned.targetExists, true);
    assert.match(planned.proposal.baseContentHash || "", /^[a-f0-9]{64}$/);
    assert.ok(planned.proposal.reviewReasons.includes("existing-target"));
    assert.ok(planned.proposal.reviewReasons.includes("consequential-replace"));

    await assert.rejects(
      () =>
        applyCaptureProposal({
          repoRoot,
          proposalId: planned.proposal.proposalId,
          action: "create",
        }),
      (error: unknown) =>
        error instanceof CaptureConflictError && /already exists/i.test(error.message),
    );
    assert.equal(
      await fs.readFile(path.join(repoRoot, targetPath), "utf8"),
      "# Replace Target\n\nOld canonical content.\n",
    );

    let refreshes = 0;
    const result = await applyCaptureProposal({
      repoRoot,
      proposalId: planned.proposal.proposalId,
      action: "replace",
      refresh: async () => {
        refreshes += 1;
      },
    });
    assert.equal(result.action, "replaced");
    assert.equal(refreshes, 1);
    assert.equal(
      await fs.readFile(path.join(repoRoot, targetPath), "utf8"),
      renderCaptureNote(planned.proposal.proposedNote),
    );
    await assert.rejects(
      () => getCaptureProposal(repoRoot, planned.proposal.proposalId),
      /not found/i,
    );
  });
}

async function testStaleHashLeavesCanonicalContentUntouched(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/stale-target.md";
    await write(repoRoot, targetPath, "# Stale Target\n\nOriginal content.\n");
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Stale Target",
      body: "Proposed replacement.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    const interveningContent = "# Stale Target\n\nA concurrent editor changed this content.\n";
    await fs.writeFile(path.join(repoRoot, targetPath), interveningContent, "utf8");

    await assert.rejects(
      () =>
        applyCaptureProposal({
          repoRoot,
          proposalId: planned.proposal.proposalId,
          action: "replace",
        }),
      (error: unknown) =>
        error instanceof CaptureConflictError &&
        /changed after proposal creation/i.test(error.message),
    );
    assert.equal(await fs.readFile(path.join(repoRoot, targetPath), "utf8"), interveningContent);
    assert.equal(
      (await getCaptureProposal(repoRoot, planned.proposal.proposalId)).proposalId,
      planned.proposal.proposalId,
    );
  });
}

async function testExplicitAppendIsDeterministic(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/append-target.md";
    const existingContent = "# Append Target\n\nExisting durable content.\n";
    await write(repoRoot, targetPath, existingContent);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Append Target Update",
      body: "## Added finding\n\nNew additive content.",
      requestedPath: targetPath,
      proposedAction: "append",
      updated: "2026-07-13",
    });

    assert.equal(planned.proposal.proposedAction, "append");
    assert.ok(planned.proposal.reviewReasons.includes("consequential-append"));
    const result = await applyCaptureProposal({
      repoRoot,
      proposalId: planned.proposal.proposalId,
      action: "append",
    });
    const rendered = renderCaptureNote(planned.proposal.proposedNote);
    const expected = `${existingContent.trimEnd()}\n\n---\n\n${rendered.trim()}\n`;
    assert.equal(result.action, "appended");
    assert.equal(await fs.readFile(path.join(repoRoot, targetPath), "utf8"), expected);
  });
}

async function testDryRunPreservesTargetAndProposal(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/dry-run-target.md";
    const existingContent = "# Dry Run Target\n\nKeep this exact content.\n";
    await write(repoRoot, targetPath, existingContent);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Dry Run Target",
      body: "This replacement must not be written during a dry run.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });

    let refreshes = 0;
    const result = await applyCaptureProposal({
      repoRoot,
      proposalId: planned.proposal.proposalId,
      action: "replace",
      dryRun: true,
      refresh: async () => {
        refreshes += 1;
      },
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.action, "replaced");
    assert.equal(refreshes, 0);
    assert.equal(await fs.readFile(path.join(repoRoot, targetPath), "utf8"), existingContent);
    assert.equal(
      (await getCaptureProposal(repoRoot, planned.proposal.proposalId)).proposalId,
      planned.proposal.proposalId,
    );
  });
}

async function testConcurrentApplyAllowsOneCanonicalMutation(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/concurrent-target.md";
    await write(repoRoot, targetPath, "# Concurrent Target\n\nOriginal content.\n");
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "Concurrent Target",
      body: "Only one concurrent proposal application may complete.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-13",
    });

    const applications = await Promise.allSettled([
      applyCaptureProposal({
        repoRoot,
        proposalId: planned.proposal.proposalId,
        action: "replace",
      }),
      applyCaptureProposal({
        repoRoot,
        proposalId: planned.proposal.proposalId,
        action: "replace",
      }),
    ]);
    assert.equal(
      applications.filter((result) => result.status === "fulfilled").length,
      1,
      JSON.stringify(applications),
    );
    assert.equal(applications.filter((result) => result.status === "rejected").length, 1);
    assert.equal(
      await fs.readFile(path.join(repoRoot, targetPath), "utf8"),
      renderCaptureNote(planned.proposal.proposedNote),
    );
    await assert.rejects(
      () => getCaptureProposal(repoRoot, planned.proposal.proposalId),
      /not found/i,
    );
    const targetEntries = await fs.readdir(path.dirname(path.join(repoRoot, targetPath)));
    assert.ok(targetEntries.every((entry) => !entry.includes(".gke-tmp-")));
  });
}

async function testCaptureCliListShowApplyAndReject(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const applyTarget = "kb/topics/cli-apply-target.md";
    const rejectTarget = "kb/topics/cli-reject-target.md";
    const applyOriginal = "# CLI Apply Target\n\nOriginal apply content.\n";
    const rejectOriginal = "# CLI Reject Target\n\nOriginal reject content.\n";
    await write(repoRoot, applyTarget, applyOriginal);
    await write(repoRoot, rejectTarget, rejectOriginal);

    const applyPlan = await planCapture({
      repoRoot,
      sourceOperation: "upsert",
      kind: "topic",
      title: "CLI Apply Target",
      body: "Applied through the top-level GKE capture CLI.",
      requestedPath: applyTarget,
      proposedAction: "replace",
      updated: "2026-07-13",
    });
    const rejectPlan = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "CLI Reject Target",
      body: "This proposal must be rejected without mutation.",
      requestedPath: rejectTarget,
      proposedAction: "replace",
      updated: "2026-07-13",
    });

    const listed = await runCli(["capture", "list", "--repo-root", repoRoot, "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    const listedProposals = JSON.parse(listed.stdout) as Array<{ proposalId: string }>;
    assert.deepEqual(
      new Set(listedProposals.map((proposal) => proposal.proposalId)),
      new Set([applyPlan.proposal.proposalId, rejectPlan.proposal.proposalId]),
    );

    const shown = await runCli([
      "capture",
      "show",
      applyPlan.proposal.proposalId,
      "--repo-root",
      repoRoot,
      "--json",
    ]);
    assert.equal(shown.code, 0, shown.stderr);
    const shownProposal = JSON.parse(shown.stdout) as {
      proposalId: string;
      proposedNote: { path: string };
    };
    assert.equal(shownProposal.proposalId, applyPlan.proposal.proposalId);
    assert.equal(shownProposal.proposedNote.path, applyTarget);

    const missingAction = await runCli([
      "capture",
      "apply",
      applyPlan.proposal.proposalId,
      "--repo-root",
      repoRoot,
    ]);
    assert.equal(missingAction.code, 1);
    assert.match(missingAction.stderr, /requires --action/i);

    const applied = await runCli([
      "capture",
      "apply",
      applyPlan.proposal.proposalId,
      "--repo-root",
      repoRoot,
      "--action",
      "replace",
      "--json",
    ]);
    assert.equal(applied.code, 0, applied.stderr);
    const appliedResult = JSON.parse(applied.stdout) as { action: string; path: string };
    assert.deepEqual(appliedResult, {
      proposalId: applyPlan.proposal.proposalId,
      action: "replaced",
      path: applyTarget,
      dryRun: false,
      contentHash: (JSON.parse(applied.stdout) as { contentHash: string }).contentHash,
    });
    assert.equal(
      await fs.readFile(path.join(repoRoot, applyTarget), "utf8"),
      renderCaptureNote(applyPlan.proposal.proposedNote),
    );

    const rejected = await runCli([
      "capture",
      "reject",
      rejectPlan.proposal.proposalId,
      "--repo-root",
      repoRoot,
      "--json",
    ]);
    assert.equal(rejected.code, 0, rejected.stderr);
    assert.deepEqual(JSON.parse(rejected.stdout), {
      proposalId: rejectPlan.proposal.proposalId,
      rejected: true,
      dryRun: false,
    });
    assert.equal(await fs.readFile(path.join(repoRoot, rejectTarget), "utf8"), rejectOriginal);
    assert.deepEqual(await listCaptureProposals(repoRoot), []);
  });
}

async function testReadOnlyWorkspaceRejectsReviewedMutations(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    const targetPath = "kb/topics/read-only-reviewed-target.md";
    const original = "# Read-only Reviewed Target\n\nOriginal content.\n";
    await write(repoRoot, targetPath, original);
    const planned = await planCapture({
      repoRoot,
      sourceOperation: "answer",
      kind: "topic",
      title: "Read-only Reviewed Target",
      body: "This replacement must remain blocked.",
      requestedPath: targetPath,
      proposedAction: "replace",
      updated: "2026-07-14",
    });
    const workspace = await loadWorkspaceContext({
      repoRoot,
      scanRoots: ["demo-kb", "kb"],
      writeRoots: ["kb", ".gke"],
      environment: { KB_MCP_WORKSPACE_READ_ONLY: "true" },
    });

    await assert.rejects(
      () =>
        applyCaptureProposal({
          repoRoot,
          workspace,
          proposalId: planned.proposal.proposalId,
          action: "replace",
        }),
      /read-only/i,
    );
    await assert.rejects(
      () => rejectCaptureProposal(repoRoot, planned.proposal.proposalId, false, workspace),
      /read-only/i,
    );
    assert.equal(await fs.readFile(path.join(repoRoot, targetPath), "utf8"), original);
    assert.equal(
      (await getCaptureProposal(repoRoot, planned.proposal.proposalId, workspace)).proposalId,
      planned.proposal.proposalId,
    );
  });
}

async function testUnsafePathsAreRejected(): Promise<void> {
  await withWorkspace(async (repoRoot) => {
    for (const requestedPath of [
      "../outside.md",
      "/tmp/outside.md",
      "C:\\temp\\outside.md",
      "kb/topics/../../outside.md",
    ]) {
      await assert.rejects(
        () =>
          planCapture({
            repoRoot,
            sourceOperation: "upsert",
            kind: "topic",
            title: "Unsafe Capture",
            body: "Must be rejected.",
            requestedPath,
          }),
        /workspace-relative|traversal|under kb\/topics/i,
      );
    }

    await assert.rejects(
      () =>
        planCapture({
          repoRoot,
          sourceOperation: "answer",
          kind: "topic",
          title: "Unsafe Citation",
          body: "Must be rejected.",
          evidenceCitations: [{ path: "../private/evidence.md", line: 1 }],
        }),
      /traversal/i,
    );
    await assert.rejects(
      () => getCaptureProposal(repoRoot, "../../outside"),
      /invalid capture proposal id/i,
    );
    assert.equal(await exists(path.resolve(repoRoot, "../outside.md")), false);
  });
}

async function testSymlinkEscapesAreRejected(): Promise<void> {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "gke-capture-outside-"));
  try {
    await withWorkspace(async (repoRoot) => {
      await fs.mkdir(path.join(repoRoot, "kb"), { recursive: true });
      await fs.symlink(outside, path.join(repoRoot, "kb", "topics"));
      await assert.rejects(
        () =>
          planCapture({
            repoRoot,
            sourceOperation: "upsert",
            kind: "topic",
            title: "Symlink Escape",
            body: "Must stay inside the workspace.",
            requestedPath: "kb/topics/symlink-escape.md",
          }),
        /outside the workspace root/i,
      );
      assert.equal(await exists(path.join(outside, "symlink-escape.md")), false);
    });

    await withWorkspace(async (repoRoot) => {
      await write(repoRoot, "kb/topics/existing.md", "# Existing\n\nOriginal.\n");
      await fs.mkdir(path.join(repoRoot, ".gke"), { recursive: true });
      await fs.symlink(outside, path.join(repoRoot, ".gke", "capture-proposals"));
      await assert.rejects(
        () =>
          planCapture({
            repoRoot,
            sourceOperation: "upsert",
            kind: "topic",
            title: "Existing",
            body: "Proposed replacement.",
            requestedPath: "kb/topics/existing.md",
            proposedAction: "replace",
          }),
        /outside the workspace root/i,
      );
      assert.deepEqual(await fs.readdir(outside), []);
    });
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
}

const tests = [
  testFuzzyCandidateIsAdvisoryAndRejectIsNonMutating,
  testExactUnreviewedCreate,
  testEvidenceConsensusRoutesCapture,
  testReplaceWithMatchingHash,
  testStaleHashLeavesCanonicalContentUntouched,
  testExplicitAppendIsDeterministic,
  testDryRunPreservesTargetAndProposal,
  testConcurrentApplyAllowsOneCanonicalMutation,
  testCaptureCliListShowApplyAndReject,
  testReadOnlyWorkspaceRejectsReviewedMutations,
  testUnsafePathsAreRejected,
  testSymlinkEscapesAreRejected,
];

let failed = 0;
for (const test of tests) {
  try {
    await test();
    console.log(`  ✓ ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${test.name}: ${(error as Error).stack || error}`);
  }
}

if (failed > 0) {
  console.error(`Capture service tests failed: ${failed}/${tests.length}.`);
  process.exit(1);
}
console.log("Capture service tests passed.");

async function withWorkspace(work: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-capture-service-"));
  try {
    await fs.mkdir(path.join(repoRoot, "demo-kb"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "kb"), { recursive: true });
    await work(repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

async function write(repoRoot: string, relPath: string, content: string): Promise<void> {
  const target = path.join(repoRoot, relPath);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.resolve(testDirectory, "../cli.ts");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: path.resolve(testDirectory, "../.."),
      env: process.env,
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
