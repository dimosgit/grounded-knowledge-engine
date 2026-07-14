#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { answerGrounded } from "../grounding/answer-service.js";
import { getKbRetriever } from "../grounding/retriever.js";
import { captureGroundedAnswer } from "./grounded-capture-service.js";

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-ask-capture-loop-"));
try {
  await Promise.all([
    writeEvidence(
      "kb/sources/capture/evidence-alpha.md",
      "Heliocapture Protocol Capture Knowledge",
      "Heliocapture Protocol Capture Knowledge. Heliocapture Protocol Capture Knowledge. The Heliocapture Protocol uses grounded evidence, deterministic routing, and an atomic canonical Markdown write.",
    ),
    writeEvidence(
      "kb/sources/capture/evidence-beta.md",
      "Evidence Beta",
      "Heliocapture Protocol capture checks duplicates and current content before it writes canonical Markdown.",
    ),
    writeEvidence(
      "kb/sources/capture/evidence-gamma.md",
      "Evidence Gamma",
      "A Heliocapture Protocol result keeps citations and refreshes retrieval only after a successful Markdown write.",
    ),
  ]);

  let retriever = await getKbRetriever({ repoRoot, forceRefresh: true });
  const ask = async (question: string, strict = true) =>
    answerGrounded(
      { question, strict, responseMode: "curate", limit: 8 },
      {
        search: async (args) => retriever.search(args),
        listDocuments: async () => retriever.getDocuments(),
      },
    );

  const firstAnswer = await ask("Heliocapture Protocol Capture Knowledge", false);
  assert.equal(firstAnswer.abstained, false, JSON.stringify(firstAnswer.gate));
  assert.equal(firstAnswer.gate.measured.uniqueSources, 3);
  assert.ok(firstAnswer.citations.length >= 2);

  const captured = await captureGroundedAnswer({
    repoRoot,
    grounded: firstAnswer,
    title: "Heliocapture Protocol",
    refresh: async () => {
      retriever = await getKbRetriever({ repoRoot, forceRefresh: true });
    },
  });
  assert.equal(captured.action, "created");
  assert.equal(captured.path, "kb/topics/heliocapture-protocol.md");

  const retained = await ask("Explain Heliocapture Protocol", false);
  assert.equal(retained.abstained, false);
  assert.ok(retained.citations.some((citation) => citation.path === captured.path));
  console.log("Local Ask → capture → refresh → re-Ask loop passed.");
} finally {
  await fs.rm(repoRoot, { recursive: true, force: true });
}

async function writeEvidence(relPath: string, title: string, body: string): Promise<void> {
  const target = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    `---
module: capture
track: platform
status: canonical
type: source
owner: test
updated: 2026-07-13
tags: capture, test
---

# ${title}

${body}
`,
    "utf8",
  );
}
