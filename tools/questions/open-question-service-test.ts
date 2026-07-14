#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  mutateOpenQuestion,
  normalizeOpenQuestionInput,
  parseOpenQuestionEntries,
} from "./open-question-service.js";
import type { OpenQuestionMutationInput } from "./types.js";

async function main(): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-open-questions-"));
  try {
    await fs.mkdir(path.join(repoRoot, "kb"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "kb/index.md"), "# Test workspace\n", "utf8");
    const workspace = await loadWorkspaceContext({
      repoRoot,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".gke", ".cache"],
    });
    const target = path.join(repoRoot, "kb/open_questions.md");
    const fixedNow = () => new Date("2026-07-14T12:00:00.000Z");

    const normalized = normalizeOpenQuestionInput({
      question: "Question with\nextra spacing?",
      whyOpen: "Why\nthis remains open.",
      whatWouldResolve: "A\tverified answer.",
      status: "resolved",
      resolvedBy: "Evidence\nrecord",
    });
    assert.equal(normalized.question, "Question with extra spacing?");
    assert.equal(normalized.whyOpen, "Why this remains open.");
    assert.equal(normalized.whatWouldResolve, "A verified answer.");
    assert.equal(normalized.resolvedBy, "Evidence record");
    assert.throws(
      () =>
        normalizeOpenQuestionInput({
          ...questionInput("Invalid status?"),
          status: "waiting" as "open",
        }),
      /invalid open-question status/i,
    );

    const dryRun = await mutateOpenQuestion(questionInput("Dry-run question?"), {
      repoRoot,
      workspace,
      writesEnabled: false,
      now: fixedNow,
    });
    assert.equal(dryRun.action, "created");
    assert.equal(dryRun.dryRun, true);
    await assert.rejects(fs.access(target));

    await assert.rejects(
      mutateOpenQuestion(
        { ...questionInput("Writes-disabled question?"), dryRun: false },
        { repoRoot, workspace, writesEnabled: false, now: fixedNow },
      ),
      /write gate/i,
    );

    const readOnlyWorkspace: WorkspaceContext = Object.freeze({ ...workspace, readOnly: true });
    await assert.rejects(
      mutateOpenQuestion(
        { ...questionInput("Read-only question?"), dryRun: false },
        { repoRoot, workspace: readOnlyWorkspace, writesEnabled: true, now: fixedNow },
      ),
      /read-only/i,
    );

    let refreshCount = 0;
    const serviceOptions = {
      repoRoot,
      workspace,
      writesEnabled: true,
      now: fixedNow,
      refresh: async () => {
        refreshCount += 1;
      },
    };
    const distinctResults = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        mutateOpenQuestion(
          {
            ...questionInput(`Concurrent distinct question ${index + 1}?`),
            dryRun: false,
            owner: "test-owner",
            source: "concurrency-test",
            relatedPath: "kb/topics/example.md",
          },
          serviceOptions,
        ),
      ),
    );
    assert.equal(distinctResults.filter((result) => result.action === "created").length, 1);
    assert.equal(distinctResults.filter((result) => result.action === "appended").length, 19);
    assert.equal(new Set(distinctResults.map((result) => result.entryId)).size, 20);
    assert.equal(refreshCount, 20);

    const duplicateResults = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        mutateOpenQuestion(
          {
            ...questionInput(
              index % 2 === 0
                ? "Concurrent duplicate question?"
                : "  concurrent   DUPLICATE question?  ",
            ),
            dryRun: false,
          },
          serviceOptions,
        ),
      ),
    );
    assert.equal(duplicateResults.filter((result) => result.action === "appended").length, 1);
    assert.equal(duplicateResults.filter((result) => result.action === "unchanged").length, 19);
    assert.equal(new Set(duplicateResults.map((result) => result.entryId)).size, 1);
    assert.equal(refreshCount, 21, "Unchanged duplicates must not refresh retrieval.");

    const content = await fs.readFile(target, "utf8");
    const entries = parseOpenQuestionEntries(content);
    assert.equal(entries.length, 21);
    assert.equal(
      entries.filter((entry) => entry.normalizedQuestion === "concurrent duplicate question?")
        .length,
      1,
    );
    assert.match(content, /^# Open Questions\n/);
    assert.match(content, /^ {2}why it's open: Evidence is incomplete\./m);
    assert.match(content, /^ {2}what would resolve it: Provide a verified answer\./m);
    assert.match(content, /^ {2}related: \[kb\/topics\/example\.md\]\(\.\/topics\/example\.md\)/m);
    assert.match(content, /^ {2}owner: test-owner/m);
    assert.match(content, /^ {2}source: concurrency-test/m);
    assert.match(content, /^ {2}added: 2026-07-14/m);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    }

    const beforeDuplicateDryRun = content;
    const duplicateDryRun = await mutateOpenQuestion(
      questionInput("CONCURRENT duplicate question?"),
      { ...serviceOptions, writesEnabled: false },
    );
    assert.equal(duplicateDryRun.action, "unchanged");
    assert.equal(await fs.readFile(target, "utf8"), beforeDuplicateDryRun);
    assert.equal(refreshCount, 21);

    await assert.rejects(
      mutateOpenQuestion(
        {
          ...questionInput("Unsafe related path?"),
          relatedPath: path.join(repoRoot, "kb/topics/example.md"),
          dryRun: true,
        },
        serviceOptions,
      ),
      /workspace-relative/i,
    );

    const lockEntries = await fs.readdir(path.join(repoRoot, ".gke/locks")).catch(() => []);
    assert.deepEqual(lockEntries, []);
    const kbEntries = await fs.readdir(path.join(repoRoot, "kb"));
    assert.ok(!kbEntries.some((entry) => entry.includes(".gke-tmp-")));
    console.log(
      "Open-question service tests passed (atomic concurrency, dedupe, dry-run, gates, syntax).",
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

function questionInput(question: string): OpenQuestionMutationInput {
  return {
    question,
    whyOpen: "Evidence is incomplete.",
    whatWouldResolve: "Provide a verified answer.",
    status: "open",
    dryRun: true,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
