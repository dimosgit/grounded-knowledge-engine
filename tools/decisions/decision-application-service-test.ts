import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import {
  createDecisionApplicationService,
  type RecordDecisionInput,
} from "./decision-application-service.js";

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-decision-application-"));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-decision-application-outside-"));

try {
  await fs.mkdir(path.join(repoRoot, "kb", "sources"), { recursive: true });
  await fs.mkdir(path.join(outsideRoot, "kb", "decisions"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "kb", "sources", "evidence.md"),
    "# Evidence\n\nThe grounded constraint remains valid.\n",
    "utf8",
  );
  const workspace = await loadWorkspaceContext({ repoRoot, scanRoots: ["kb"] });
  let refreshCount = 0;
  const service = createDecisionApplicationService({
    repoRoot,
    scanRoots: ["kb"],
    workspace,
    refresh: async () => {
      refreshCount += 1;
    },
  });

  const preview = await service.record(
    decisionInput("preview-decision", "Preview decision", { dryRun: true }),
  );
  assert.equal(preview.dryRun, true);
  assert.equal(refreshCount, 0);
  await assert.rejects(fs.access(path.join(repoRoot, preview.path)));

  const pinnedInput = {
    ...decisionInput("first-decision", "First decision"),
    repoRoot: outsideRoot,
  } as RecordDecisionInput;
  const created = await service.record(pinnedInput);
  assert.equal(created.dryRun, false);
  assert.equal(refreshCount, 1);
  await fs.access(path.join(repoRoot, created.path));
  await assert.rejects(fs.access(path.join(outsideRoot, created.path)));

  assert.equal((await service.get({ identifier: created.decisionId })).path, created.path);
  assert.deepEqual(
    (await service.list({ status: "active" })).map((decision) => decision.decisionId),
    [created.decisionId],
  );

  const original = await fs.readFile(path.join(repoRoot, created.path), "utf8");
  const reviewInput = {
    decisionId: created.decisionId,
    reviewedAt: "2026-07-29",
    reviewAfter: "2026-08-29",
    reviewer: "application-service-test",
    recommendationSupported: true,
    evidence: [{ path: "kb/sources/evidence.md", line: 3, classification: "unchanged" as const }],
  };
  const reviewPreview = await service.review({ ...reviewInput, dryRun: true });
  assert.equal(reviewPreview.dryRun, true);
  assert.equal(refreshCount, 1);
  assert.equal(await fs.readFile(path.join(repoRoot, created.path), "utf8"), original);

  const reviewed = await service.review(reviewInput);
  assert.equal(reviewed.dryRun, false);
  assert.equal(refreshCount, 2);

  const replacement = await service.record(
    decisionInput("replacement-decision", "Replacement decision"),
  );
  assert.equal(refreshCount, 3);
  const supersedeInput = {
    decisionId: created.decisionId,
    replacementId: replacement.decisionId,
    supersededAt: "2026-07-29",
    reason: "The replacement preserves the revised recommendation.",
  };
  const supersedePreview = await service.supersede({ ...supersedeInput, dryRun: true });
  assert.equal(supersedePreview.dryRun, true);
  assert.equal(refreshCount, 3);

  const superseded = await service.supersede(supersedeInput);
  assert.equal(superseded.dryRun, false);
  assert.equal(refreshCount, 4);
  assert.equal((await service.get({ identifier: created.decisionId })).status, "superseded");

  console.log("Decision application service tests passed.");
} finally {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
}

function decisionInput(
  decisionId: string,
  title: string,
  extra: Partial<RecordDecisionInput> = {},
): RecordDecisionInput {
  return {
    decisionId,
    workspaceId: "test",
    title,
    status: "active",
    owner: "application-service-test",
    decidedAt: "2026-07-29",
    evidenceCheckedAt: "2026-07-29",
    reviewAfter: "2026-08-29",
    confidence: "high",
    question: `Should we use ${title.toLowerCase()}?`,
    recommendation: `Use ${title.toLowerCase()}.`,
    rationale: "The evidence supports it.",
    evidence: [{ path: "kb/sources/evidence.md", line: 3 }],
    ...extra,
  };
}
