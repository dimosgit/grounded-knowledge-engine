#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluationExitCode,
  evaluateRetrieval,
  formatEvaluationReport,
  loadEvaluationCases,
  parseEvalArgs,
  type EvalArgs,
  type LoadedCases,
} from "./evaluate-retrieval.js";
import type { IndexedDocument, KbRetriever, SearchArgs, SearchHit, SearchResult } from "./types.js";

async function main(): Promise<void> {
  await testBackwardCompatibleCaseLoading();
  testIsolatedArgumentParsing();
  await testCategoriesFloorsAbstentionAndCitations();
  console.log("Retrieval evaluator tests passed.");
}

async function testBackwardCompatibleCaseLoading(): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gke-eval-cases-"));
  try {
    const file = path.join(directory, "cases.json");
    await fs.writeFile(
      file,
      `${JSON.stringify({
        description: "Legacy envelope",
        cases: [
          {
            id: "legacy",
            query: "legacy query",
            expectedPathPatterns: ["kb/topics/legacy.md"],
            forbiddenPathPatterns: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const loaded = await loadEvaluationCases(file);
    assert.equal(loaded.cases[0].category, "uncategorized");
    assert.equal(loaded.cases[0].expectAbstention, null);
    assert.deepEqual(
      loaded.cases[0].expectedCitationPathPatterns,
      loaded.cases[0].expectedPathPatterns,
    );
    assert.deepEqual(loaded.floors, { overall: {}, categories: {} });

    await fs.writeFile(
      file,
      `${JSON.stringify({ cases: [{ id: "bad", query: "missing expectations" }] })}\n`,
      "utf8",
    );
    await assert.rejects(() => loadEvaluationCases(file), /missing expectedPathPatterns/i);

    await fs.writeFile(
      file,
      `${JSON.stringify({
        floors: { overall: { unknownMetric: 0.5 } },
        cases: [
          {
            id: "valid-case",
            query: "query",
            expectedPathPatterns: ["kb/topics/valid.md"],
          },
        ],
      })}\n`,
      "utf8",
    );
    await assert.rejects(() => loadEvaluationCases(file), /unknown floor metric/i);

    await fs.writeFile(
      file,
      `${JSON.stringify({
        floors: { overall: { recallAtK: 1.1 } },
        cases: [
          {
            id: "valid-case",
            query: "query",
            expectedPathPatterns: ["kb/topics/valid.md"],
          },
        ],
      })}\n`,
      "utf8",
    );
    await assert.rejects(() => loadEvaluationCases(file), /must be between 0 and 1/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function testIsolatedArgumentParsing(): void {
  const cwd = path.join(path.sep, "tmp", "eval-base");
  const args = parseEvalArgs(
    [
      "--repo-root",
      "fixture-workspace",
      "--scan-root",
      "kb-one",
      "--scan-roots=kb-two,kb-one",
      "--deterministic",
    ],
    cwd,
  );
  assert.equal(args.repoRoot, path.join(cwd, "fixture-workspace"));
  assert.deepEqual(args.scanRoots, ["kb-one", "kb-two"]);
  assert.equal(args.deterministic, true);
  assert.equal(args.noCache, true);
}

async function testCategoriesFloorsAbstentionAndCitations(): Promise<void> {
  const args: EvalArgs = {
    file: "/fixture/cases.json",
    repoRoot: "/fixture",
    scanRoots: ["kb-fixture"],
    k: 2,
    limit: 4,
    context: 1,
    runs: 1,
    backend: "bm25",
    refresh: false,
    json: true,
    noCache: true,
    traces: false,
    deterministic: true,
    help: false,
  };
  const loaded: LoadedCases = {
    absolute: args.file,
    description: "Categorized fixture",
    floors: {
      overall: { passRateAtK: 1, citationResolvableRate: 1 },
      categories: {
        exact: { recallAtK: 1, citationPathCoverage: 1 },
        negative: { abstentionAccuracy: 1, hardNegativeCleanRateAtK: 1 },
      },
    },
    cases: [
      {
        id: "exact-answer",
        category: "exact",
        query: "known answer",
        mode: "generic",
        track: "",
        module: "",
        expectedPathPatterns: ["kb-fixture/topics/known.md"],
        expectedCitationPathPatterns: ["kb-fixture/topics/known.md"],
        forbiddenPathPatterns: ["kb-fixture/topics/stale.md"],
        expectAbstention: false,
      },
      {
        id: "unknown-answer",
        category: "negative",
        query: "unknown answer",
        mode: "generic",
        track: "",
        module: "",
        expectedPathPatterns: [],
        expectedCitationPathPatterns: [],
        forbiddenPathPatterns: ["kb-fixture/topics/known.md"],
        expectAbstention: true,
      },
    ],
  };
  const summary = await evaluateRetrieval({
    args,
    loaded,
    retriever: buildRetriever(),
  });

  assert.deepEqual(Object.keys(summary.categories), ["exact", "negative"]);
  assert.equal(summary.metrics.recallAtK, 1);
  assert.equal(summary.metrics.mrrAtK, 1, "negative cases must not dilute positive MRR");
  assert.equal(summary.metrics.citationPathCoverage, 1);
  assert.equal(summary.metrics.citationResolvableRate, 1);
  assert.equal(summary.metrics.abstentionAccuracy, 1);
  assert.equal(summary.metrics.hardNegative.caseCount, 2);
  assert.equal(summary.metrics.hardNegative.cleanRateAtK, 1);
  assert.equal(summary.categories.negative.metrics.recallAtK, null);
  assert.equal(summary.categories.negative.metrics.mrrAtK, null);
  assert.equal(summary.categories.negative.metrics.abstentionAccuracy, 1);
  assert.equal(summary.cases[0].abstained, false);
  assert.equal(summary.cases[0].citationPathCoverage, 1);
  assert.equal(summary.cases[1].abstained, true);
  assert.equal(summary.cases[1].hitAtK, false);
  assert.equal(summary.cases[1].passAtK, true);
  assert.equal(summary.floorsPassed, true);
  assert.equal(evaluationExitCode(summary), 0);
  assert.ok(summary.floorChecks.every((check) => check.passed));
  assert.deepEqual(summary.metrics.latencyMs, { mean: null, p50: null, p95: null });
  assert.deepEqual(summary.repository, { repoRoot: "/fixture", scanRoots: ["kb-fixture"] });

  const repeated = await evaluateRetrieval({ args, loaded, retriever: buildRetriever() });
  assert.equal(
    JSON.stringify(repeated),
    JSON.stringify(summary),
    "deterministic mode must produce byte-stable JSON for identical evidence",
  );

  const firstReport = formatEvaluationReport(summary, args.k);
  const secondReport = formatEvaluationReport(summary, args.k);
  assert.equal(firstReport, secondReport);
  assert.match(firstReport, /Floors: PASS/);
  assert.match(firstReport, /\[negative\] unknown-answer: negative/);

  const failing = await evaluateRetrieval({
    args,
    loaded: {
      ...loaded,
      floors: { overall: {}, categories: { missing: { recallAtK: 1 } } },
    },
    retriever: buildRetriever(),
  });
  assert.equal(failing.floorsPassed, false);
  assert.equal(evaluationExitCode(failing), 1);
  assert.deepEqual(failing.floorChecks[0], {
    scope: "category",
    category: "missing",
    metric: "recallAtK",
    minimum: 1,
    actual: null,
    passed: false,
  });
}

function buildRetriever(): KbRetriever {
  const documents = [
    document("kb-fixture/topics/known.md", "Known"),
    document("kb-fixture/topics/support.md", "Support"),
  ];
  return {
    search(args?: SearchArgs): SearchResult {
      const query = `${args?.query || ""}`;
      return query === "known answer"
        ? searchResult(query, [
            hit("kb-fixture/topics/known.md", 22, ["known", "answer"]),
            hit("kb-fixture/topics/support.md", 18, ["known"]),
            hit("kb-fixture/topics/known.md", 16, ["answer"]),
          ])
        : searchResult(query, []);
    },
    getDocuments: () => documents,
    getDocument: (pathValue) => documents.find((item) => item.relPath === pathValue) || null,
    getStats: () => ({
      documents: documents.length,
      chunks: 3,
      terms: 2,
      queryCache: { ttlMs: 0, maxEntries: 10, currentEntries: 0, hits: 0, misses: 0 },
      byTrack: { fixture: documents.length },
      bySourceKind: { topic: documents.length },
    }),
    meta: { scanRoots: ["kb-fixture"] },
  };
}

function document(relPath: string, title: string): IndexedDocument {
  return {
    id: relPath.length,
    relPath,
    title,
    track: "fixture",
    module: "general",
    sourceKind: "topic",
    frontmatter: {},
    body: `# ${title}\n\nFixture evidence.`,
    isArchive: false,
  };
}

function hit(pathValue: string, score: number, matchedTokens: string[]): SearchHit {
  return {
    path: pathValue,
    score,
    lineNumber: 1,
    endLine: 2,
    title: path.basename(pathValue, ".md"),
    sourceKind: "topic",
    track: "fixture",
    module: "general",
    snippet: "Fixture evidence.",
    matchedTokens,
    context: [],
  };
}

function searchResult(query: string, hits: SearchHit[]): SearchResult {
  return {
    query,
    mode: "generic",
    backend: "bm25",
    queryTokens: query.split(" "),
    filters: { track: null, module: null, includeArchive: false },
    retrieval: { maxPerPath: 2 },
    metrics: { latencyMs: 17, cache: { hit: false, ttlMs: 0 } },
    signals: {
      tokenCoverage: hits.length ? 1 : 0,
      uniqueSources: new Set(hits.map((item) => item.path)).size,
      topScore: hits[0]?.score || 0,
      dominantSourceShare: hits.length ? 2 / 3 : 1,
      hitCount: hits.length,
    } as SearchResult["signals"],
    hitCount: hits.length,
    hits,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
