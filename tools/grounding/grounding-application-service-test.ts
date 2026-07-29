#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "../workspaces/config.js";
import {
  createGroundingApplicationService,
  type GroundingSearchInput,
} from "./grounding-application-service.js";
import type { GroundedAnswerInput } from "./answer-service.js";
import type { RetrievalBackend } from "./types.js";

async function main(): Promise<void> {
  const rootA = await createWorkspaceFixture("alpha", "alphamarker");
  const rootB = await createWorkspaceFixture("beta", "betamarker");
  try {
    const workspaceA = await loadWorkspaceContext({
      repoRoot: rootA,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".cache", ".gke"],
    });
    const workspaceB = await loadWorkspaceContext({
      repoRoot: rootB,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".cache", ".gke"],
    });
    const parity = new Map<RetrievalBackend, { documents: string[]; hits: string[] }>();

    for (const backend of ["bm25", "sqlite"] as const) {
      const mutableScanRoots = ["kb"];
      const service = createGroundingApplicationService({
        repoRoot: rootA,
        scanRoots: mutableScanRoots,
        workspace: workspaceA,
        backend,
      });
      mutableScanRoots[0] = "outside";

      const redirectedSearch = {
        query: "alphamarker",
        mode: "generic",
        limit: 10,
        backend,
        repoRoot: rootB,
        workspace: workspaceB,
      } as GroundingSearchInput;
      const searched = await service.search(redirectedSearch);
      assert.equal(searched.backend, backend);
      assert.ok(searched.hits.length >= 3);
      assert.ok(searched.hits.every((hit) => hit.path.startsWith("kb/topics/alpha-")));
      assert.ok(searched.hits.every((hit) => !hit.snippet.includes("betamarker")));

      const documents = await service.listDocuments({
        backend,
        repoRoot: rootB,
        workspace: workspaceB,
      } as { backend: RetrievalBackend });
      assert.equal(documents.length, 3);
      assert.ok(documents.every((document) => document.relPath.startsWith("kb/topics/alpha-")));
      assert.ok(documents.every((document) => !document.body.includes("betamarker")));

      const redirectedAnswer = {
        question: "What does alphamarker establish?",
        mode: "generic",
        responseMode: "curate",
        strict: false,
        backend,
        repoRoot: rootB,
        workspace: workspaceB,
      } as GroundedAnswerInput;
      const answered = await service.answer(redirectedAnswer);
      assert.equal(answered.abstained, false);
      assert.ok(answered.evidence.length >= 3);
      assert.ok(answered.evidence.every((hit) => hit.path.startsWith("kb/topics/alpha-")));

      const allowedPath = "kb/topics/alpha-one.md";
      const scoped = await service.answer(redirectedAnswer, { allowedPaths: [allowedPath] });
      assert.ok(scoped.evidence.length > 0);
      assert.ok(scoped.evidence.every((hit) => hit.path === allowedPath));
      assert.equal(scoped.search.signals?.uniqueSources, 1);

      const stats = await service.refresh();
      assert.equal(stats.backend, backend);
      assert.equal(stats.documents, 3);

      parity.set(backend, {
        documents: documents.map((document) => document.relPath).sort(),
        hits: [...new Set(searched.hits.map((hit) => hit.path))].sort(),
      });
    }

    assert.deepEqual(parity.get("sqlite")?.documents, parity.get("bm25")?.documents);
    assert.deepEqual(parity.get("sqlite")?.hits, parity.get("bm25")?.hits);
    console.log(
      "Grounding application service tests passed (backend parity, scoped answers, pinned context).",
    );
  } finally {
    await Promise.all([
      fs.rm(rootA, { recursive: true, force: true }),
      fs.rm(rootB, { recursive: true, force: true }),
    ]);
  }
}

async function createWorkspaceFixture(name: string, marker: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `gke-grounding-${name}-`));
  for (const suffix of ["one", "two", "three"]) {
    const target = path.join(root, `kb/topics/${name}-${suffix}.md`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      [
        "---",
        `title: ${name} ${suffix}`,
        "track: knowledge",
        "module: grounding",
        "---",
        `# ${name} ${suffix}`,
        "",
        `${marker} establishes isolated evidence for the ${name} workspace.`,
        `${marker} remains canonical in document ${suffix}.`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  return root;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
