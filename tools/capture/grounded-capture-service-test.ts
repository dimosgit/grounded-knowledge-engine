#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureGroundedAnswer } from "./grounded-capture-service.js";
import { listCaptureProposals } from "./capture-service.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-grounded-capture-"));
try {
  const grounded = {
    question: "How does reliable capture work?",
    answer: "Reliable capture separates planning from canonical mutation.",
    abstained: false,
    citations: [
      { path: "kb/topics/source-a.md", line: 4, score: 20 },
      { path: "kb/topics/source-b.md", line: 8, score: 18 },
    ],
    evidence: [
      { path: "kb/topics/source-a.md", track: "platform", module: "capture", score: 20 },
      { path: "kb/topics/source-b.md", track: "platform", module: "capture", score: 18 },
    ],
    confidence: { label: "high", score: 0.9 },
  };

  let refreshes = 0;
  const created = await captureGroundedAnswer({
    repoRoot: root,
    grounded,
    title: "Reliable Capture",
    refresh: async () => {
      refreshes += 1;
    },
  });
  assert.equal(created.action, "created");
  assert.equal(created.proposal, null);
  assert.equal(refreshes, 1);
  const captured = await fs.readFile(path.join(root, created.path), "utf8");
  assert.match(captured, /module: capture/);
  assert.match(captured, /track: platform/);
  assert.match(captured, /source-a\.md:4/);

  const proposed = await captureGroundedAnswer({
    repoRoot: root,
    grounded,
    title: "Reliable Capture",
    requestedPath: created.path,
  });
  assert.equal(proposed.action, "proposed");
  assert.equal(proposed.proposal?.requiresReview, true);
  assert.ok(proposed.proposal?.reasons.includes("existing-target"));
  assert.equal((await listCaptureProposals(root)).length, 1);

  await assert.rejects(
    () =>
      captureGroundedAnswer({
        repoRoot: root,
        grounded: { ...grounded, abstained: true },
        title: "Unsafe Abstained Capture",
      }),
    /cannot be captured/i,
  );

  console.log("Grounded answer capture service tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
