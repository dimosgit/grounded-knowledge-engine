#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyCaptureProposal,
  getCaptureProposal,
  listCaptureProposals,
  rejectCaptureProposal,
} from "../capture/capture-service.js";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { extractText } from "./extractors.js";
import { runIngest } from "./ingest.js";
import { readCandidateRun } from "./candidate-state.js";
import { deriveSourceId, readSourceRecord, sourceRecordPath } from "./source-record.js";

async function main(): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-source-aware-"));
  const previousConverter = process.env.GKE_INGEST_CONVERTER;
  try {
    process.env.GKE_INGEST_CONVERTER = "native";
    await seedWorkspace(repoRoot);
    const workspace = await loadWorkspaceContext({
      repoRoot,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".gke", ".cache"],
    });
    const ingestRoot = path.join(repoRoot, "inbox");
    const sourcePath = path.join(ingestRoot, "synthetic-report.md");
    await fs.mkdir(ingestRoot, { recursive: true });
    await fs.writeFile(sourcePath, "# Synthetic Source\n\nInitial accepted content.\n", "utf8");

    let extractionCalls = 0;
    const first = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      project: "synthetic-project",
      workspace,
      logger: () => undefined,
      extractor: async (filePath) => {
        extractionCalls += 1;
        const extracted = await extractText(filePath);
        return {
          ...extracted,
          warnings: [...extracted.warnings, `Synthetic warning for ${filePath}`],
        };
      },
    });
    assert.equal(extractionCalls, 1);
    assert.equal(first.immediateCreates, 1);
    assert.equal(first.finalizedSourceRecords, 1);
    assert.equal(first.pendingProposals, 0);
    assert.ok(
      !JSON.stringify(first).includes(repoRoot),
      "Ingest summary exposed an absolute path.",
    );

    const sourceId = deriveSourceId("synthetic-report.md");
    const acceptedInitial = await readSourceRecord(repoRoot, sourceId, workspace);
    assert.ok(acceptedInitial);
    assert.equal(acceptedInitial.projectId, "synthetic-project");
    assert.equal(acceptedInitial.generatedNotes.length, 1);
    const sourceRecordRaw = await fs.readFile(
      path.join(repoRoot, sourceRecordPath(sourceId)),
      "utf8",
    );
    assert.ok(
      !sourceRecordRaw.includes(repoRoot),
      "Canonical source record exposed an absolute path.",
    );
    assert.match(sourceRecordRaw, /converter: node-text/);
    assert.match(sourceRecordRaw, /converter_version: node-/);

    const unchanged = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      workspace,
      logger: () => undefined,
      extractor: async () => {
        throw new Error("unchanged source invoked the converter");
      },
    });
    assert.equal(unchanged.unchangedSources, 1);
    assert.equal(unchanged.pendingProposals, 0);

    const longContent = `# Synthetic Source\n\n${"A".repeat(140)}\n${"B".repeat(140)}\n${"C".repeat(140)}\n`;
    await fs.writeFile(sourcePath, longContent, "utf8");
    const longHash = sha256(longContent);
    const expanded = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      workspace,
      logger: () => undefined,
    });
    assert.ok(expanded.immediateCreates >= 1, "Added chunks should be created immediately.");
    assert.ok(expanded.pendingProposals >= 1, "Changed current chunk should require review.");
    assert.equal(
      (await readSourceRecord(repoRoot, sourceId, workspace))?.sourceHash,
      acceptedInitial.sourceHash,
      "Pending candidate overwrote the accepted source hash.",
    );

    let proposals = await listCaptureProposals(repoRoot, workspace);
    assert.equal(proposals.length, expanded.pendingProposals);
    for (const summary of proposals) {
      await applyCaptureProposal({ repoRoot, workspace, proposalId: summary.proposalId });
    }
    const acceptedExpanded = await readSourceRecord(repoRoot, sourceId, workspace);
    assert.equal(acceptedExpanded?.sourceHash, longHash);
    assert.ok((acceptedExpanded?.generatedNotes.length ?? 0) > 1);
    for (const note of acceptedExpanded?.generatedNotes ?? []) {
      await fs.access(path.join(repoRoot, note.path));
    }

    const condensedContent = "# Synthetic Source\n\nCondensed accepted content.\n";
    await fs.writeFile(sourcePath, condensedContent, "utf8");
    const condensed = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      workspace,
      logger: () => undefined,
    });
    assert.ok(condensed.removedChunks >= 1, "Removed chunks were not represented explicitly.");
    proposals = await listCaptureProposals(repoRoot, workspace);
    assert.ok(proposals.some((proposal) => proposal.proposedAction === "delete"));
    for (const summary of proposals) {
      await applyCaptureProposal({ repoRoot, workspace, proposalId: summary.proposalId });
    }
    const acceptedCondensed = await readSourceRecord(repoRoot, sourceId, workspace);
    assert.equal(acceptedCondensed?.sourceHash, sha256(condensedContent));
    assert.equal(acceptedCondensed?.generatedNotes.length, 1);
    for (const removed of acceptedExpanded?.generatedNotes.slice(1) ?? []) {
      await assert.rejects(fs.access(path.join(repoRoot, removed.path)));
    }

    const projectRaw = await fs.readFile(
      path.join(repoRoot, "kb/projects/synthetic-project/project.md"),
      "utf8",
    );
    for (const note of acceptedExpanded?.generatedNotes ?? []) {
      const projectRelativePath = path.posix.relative("kb/projects/synthetic-project", note.path);
      assert.equal(
        occurrences(projectRaw, projectRelativePath),
        1,
        `Project link was missing or duplicated for ${note.path}.`,
      );
    }

    const rejectionBaseline = `# Synthetic Source\n\n${"D".repeat(140)}\n${"E".repeat(140)}\n${"F".repeat(140)}\n`;
    await fs.writeFile(sourcePath, rejectionBaseline, "utf8");
    const expandedForRejection = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      workspace,
      logger: () => undefined,
    });
    assert.ok(expandedForRejection.pendingProposals >= 1);
    for (const summary of await listCaptureProposals(repoRoot, workspace)) {
      await applyCaptureProposal({ repoRoot, workspace, proposalId: summary.proposalId });
    }
    const acceptedRejectionBaseline = await readSourceRecord(repoRoot, sourceId, workspace);
    assert.equal(acceptedRejectionBaseline?.sourceHash, sha256(rejectionBaseline));

    const rejectedContent = "# Synthetic Source\n\nCandidate that an operator rejects.\n";
    await fs.writeFile(sourcePath, rejectedContent, "utf8");
    const rejected = await runIngest({
      folder: ingestRoot,
      module: "general",
      dryRun: false,
      scrub: true,
      maxChars: 160,
      workspace,
      logger: () => undefined,
    });
    assert.ok(rejected.pendingProposals > 1);
    const rejectedSummaries = await listCaptureProposals(repoRoot, workspace);
    const rejectedProposal = await getCaptureProposal(
      repoRoot,
      rejectedSummaries[0].proposalId,
      workspace,
    );
    const candidateId = rejectedProposal.ingestionCandidate?.candidateId;
    assert.ok(candidateId);
    await rejectCaptureProposal(repoRoot, rejectedSummaries[0].proposalId, false, workspace);
    for (const summary of rejectedSummaries.slice(1)) {
      await applyCaptureProposal({ repoRoot, workspace, proposalId: summary.proposalId });
    }
    const rejectedCandidate = await readCandidateRun(repoRoot, candidateId, workspace);
    assert.equal(rejectedCandidate.status, "partially_rejected");
    assert.equal(
      (await readSourceRecord(repoRoot, sourceId, workspace))?.sourceHash,
      acceptedRejectionBaseline?.sourceHash,
      "Rejected candidate falsely became the accepted source version.",
    );

    const operationalRaw = await fs.readFile(
      path.join(repoRoot, ".gke/ingest-candidates", `${candidateId}.json`),
      "utf8",
    );
    assert.ok(!operationalRaw.includes(repoRoot), "Candidate state exposed an absolute path.");
    console.log(
      "Source-aware ingestion test passed (idempotency, provenance, chunk deltas, apply, reject, links).",
    );
  } finally {
    if (previousConverter === undefined) delete process.env.GKE_INGEST_CONVERTER;
    else process.env.GKE_INGEST_CONVERTER = previousConverter;
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

async function seedWorkspace(repoRoot: string): Promise<void> {
  await fs.mkdir(path.join(repoRoot, "kb/topics"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "kb/terms"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "kb/index.md"), "# Test workspace\n", "utf8");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
