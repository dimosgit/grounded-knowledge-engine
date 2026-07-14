import assert from "node:assert/strict";
import { answerGrounded } from "./answer-service.js";
import type { IndexedDocument, SearchArgs, SearchHit, SearchResult } from "./types.js";

function document(overrides: Partial<IndexedDocument> = {}): IndexedDocument {
  return {
    id: 1,
    relPath: "kb/topics/capture-routing.md",
    title: "Capture Routing",
    track: "knowledge",
    module: "capture",
    sourceKind: "kb-topic",
    frontmatter: {},
    body: "# Capture Routing\n\n## Summary\n\nRoutes reliable captures into the correct project.",
    isArchive: false,
    ...overrides,
  };
}

function hit(index: number, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    path: `kb/topics/evidence-${index}.md`,
    score: 20 - index,
    lineNumber: index + 1,
    endLine: index + 2,
    title: `Evidence ${index}`,
    sourceKind: "kb-topic",
    track: "knowledge",
    module: "capture",
    snippet: `Grounded evidence ${index} explains reliable capture routing.`,
    matchedTokens: ["capture", "routing"],
    context: [],
    ...overrides,
  };
}

function result(hits: SearchHit[]): SearchResult {
  return {
    query: "capture routing",
    mode: "generic",
    backend: "bm25",
    queryTokens: ["capture", "routing"],
    filters: { track: null, module: null, includeArchive: false },
    retrieval: { maxPerPath: 2 },
    metrics: { latencyMs: 4.25, cache: { hit: false, ttlMs: 1000 } },
    signals: {
      tokenCoverage: hits.length ? 1 : 0,
      uniqueSources: new Set(hits.map((item) => item.path)).size,
      topScore: hits[0]?.score || 0,
      dominantSourceShare: hits.length ? 1 / hits.length : 1,
    },
    hitCount: hits.length,
    hits,
  };
}

function clock(): () => number {
  let value = 0;
  return () => (value += 2);
}

async function testNoEvidenceAndForwarding(): Promise<void> {
  let received: (SearchArgs & { backend?: unknown }) | null = null;
  const answer = await answerGrounded(
    {
      question: "Where should this be captured?",
      mode: "generic",
      track: "knowledge",
      module: "capture",
      backend: "sqlite",
      limit: 99,
      debug: true,
      debugTopN: 8,
    },
    {
      search: async (args) => {
        received = args;
        return result([]);
      },
      listDocuments: async () => [],
      now: clock(),
    },
  );

  assert.equal(answer.abstained, true);
  assert.equal(answer.sourceTier, "no-local-evidence");
  assert.equal(answer.gate.pass, false);
  assert.deepEqual(answer.citations, []);
  assert.deepEqual(answer.tokenUsage, {
    kind: "estimate",
    scope: "gke-visible-text",
    requestTokens: 8,
    evidenceTokens: 0,
    answerTokens: 26,
    totalTokens: 34,
    method: "characters-divided-by-4",
  });
  assert.ok(received);
  const forwarded = received as SearchArgs & { backend?: unknown };
  assert.equal(forwarded.limit, 30);
  assert.equal(forwarded.track, "knowledge");
  assert.equal(forwarded.module, "capture");
  assert.equal(forwarded.backend, "sqlite");
  assert.equal(forwarded.context, 1);
}

async function testEvidenceGate(): Promise<void> {
  const evidence = [hit(0), hit(1), hit(2, { path: "kb/topics/evidence-1.md" })];
  const answer = await answerGrounded(
    { question: "Explain capture routing", responseMode: "curate", strict: true },
    {
      search: async () => result(evidence),
      listDocuments: async () => [],
      now: clock(),
    },
  );

  assert.equal(answer.abstained, false);
  assert.equal(answer.gate.pass, true);
  assert.equal(answer.confidence.label, "high");
  assert.equal(answer.citations.length, 3);
  assert.match(answer.answer, /Grounded answer \(retrieval-based\)/);
  assert.ok(answer.tokenUsage.evidenceTokens > 0);
  assert.equal(
    answer.tokenUsage.totalTokens,
    answer.tokenUsage.requestTokens +
      answer.tokenUsage.evidenceTokens +
      answer.tokenUsage.answerTokens,
  );

  const weak = result([hit(0)]);
  weak.signals = {
    tokenCoverage: 0.2,
    uniqueSources: 1,
    topScore: 6,
    dominantSourceShare: 1,
  };
  const strictAnswer = await answerGrounded(
    { question: "Explain a weak match", responseMode: "curate" },
    { search: async () => weak, listDocuments: async () => [], now: clock() },
  );
  const permissiveAnswer = await answerGrounded(
    { question: "Explain a weak match", responseMode: "curate", strict: false },
    { search: async () => weak, listDocuments: async () => [], now: clock() },
  );
  assert.equal(strictAnswer.abstained, true);
  assert.match(strictAnswer.answer, /withheld/);
  assert.equal(permissiveAnswer.abstained, false);
}

async function testFastTermAndTopicPaths(): Promise<void> {
  let searchCalls = 0;
  const documents = [
    document({
      relPath: "kb/terms/MCP.md",
      title: "MCP",
      body: "# MCP\n\n## Definition\n\nModel Context Protocol.",
    }),
    document({
      relPath: "kb/topics/capture-routing in domain.md",
      title: "Capture Routing in Domain",
    }),
  ];
  const dependencies = {
    search: async () => {
      searchCalls += 1;
      return result([]);
    },
    listDocuments: async () => documents,
    now: clock(),
  };

  const termAnswer = await answerGrounded(
    { question: "What is MCP in Domain?", responseMode: "fast" },
    dependencies,
  );
  assert.equal(termAnswer.fastPath.strategy, "term-note");
  assert.equal(termAnswer.fastPath.alreadyCaptured, true);
  assert.equal(termAnswer.sourceTier, "exact-term");
  assert.equal(termAnswer.citations[0]?.path, "kb/terms/MCP.md");

  const topicAnswer = await answerGrounded(
    { question: "What is capture-routing in Domain?", responseMode: "auto" },
    dependencies,
  );
  assert.equal(topicAnswer.fastPath.strategy, "topic-note");
  assert.equal(topicAnswer.sourceTier, "exact-topic");
  assert.equal(topicAnswer.evidence[0]?.module, "capture");
  assert.equal(searchCalls, 0);
}

async function main(): Promise<void> {
  await testNoEvidenceAndForwarding();
  await testEvidenceGate();
  await testFastTermAndTopicPaths();
  console.log("Grounded answer service tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
