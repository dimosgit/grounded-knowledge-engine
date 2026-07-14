import path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeScalar, parsePositiveInt } from "./document-core.js";
import type { IndexedDocument, SearchArgs, SearchHit, SearchResult } from "./types.js";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
const SIMILARITY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "into",
  "when",
  "what",
  "where",
  "which",
  "how",
  "why",
  "are",
  "was",
  "were",
  "can",
  "use",
  "using",
  "local",
  "domain",
  "note",
  "topic",
  "term",
]);

export type AnswerResponseMode = "auto" | "fast" | "curate";

export interface GroundedAnswerInput {
  question?: unknown;
  strict?: boolean;
  responseMode?: unknown;
  limit?: number | string;
  mode?: unknown;
  track?: unknown;
  module?: unknown;
  includeArchive?: boolean;
  backend?: unknown;
  debug?: boolean;
  debugTopN?: number | string;
}

export interface GroundedCitation {
  path: string;
  line: number;
  score: number;
}

export interface GroundingConfidence extends Record<string, unknown> {
  label: "low" | "medium" | "high";
  score: number;
  rationale: string;
}

export interface GroundingGate {
  pass: boolean;
  reasons: string[];
  thresholds: ReturnType<typeof buildGateThresholds>;
  measured: {
    hitCount: number;
    uniqueSources: number;
    tokenCoverage: number;
    topScore: number;
    dominantSourceShare?: number;
  };
}

export interface GroundedAnswerResult {
  question: string;
  answer: string;
  strict: boolean;
  responseMode: AnswerResponseMode;
  sourceTier: string;
  abstained: boolean;
  confidence: GroundingConfidence;
  gate: GroundingGate;
  citations: GroundedCitation[];
  evidence: SearchHit[];
  search: {
    signals: SearchResult["signals"] | null;
    debug: SearchResult["debug"] | null;
    metrics?: SearchResult["metrics"] | null;
  };
  fastPath: {
    used: boolean;
    alreadyCaptured: boolean;
    mode?: string;
    strategy?: string;
    term?: string;
    topic?: string;
    path?: string;
  };
  timings: {
    retrievalMs: number;
    synthesisMs: number;
    captureMs: null;
    totalMs: number;
  };
}

export interface GroundedAnswerDependencies {
  search: (args: SearchArgs & { backend?: unknown }) => Promise<SearchResult>;
  listDocuments: () => Promise<IndexedDocument[]>;
  now?: () => number;
}

interface AnswerDocument extends IndexedDocument {
  lines: string[];
}

export async function answerGrounded(
  input: GroundedAnswerInput,
  dependencies: GroundedAnswerDependencies,
): Promise<GroundedAnswerResult> {
  const now = dependencies.now || (() => performance.now());
  const startedAt = now();
  const question = normalizeScalar(input.question);
  if (!question) throw new Error("Missing required argument: question");

  const strict = input.strict !== false;
  const responseMode = normalizeResponseMode(input.responseMode);
  const mode = normalizeScalar(input.mode).toLowerCase();
  const fastAnswer = await tryBuildFastAnswer({
    question,
    mode,
    responseMode,
    strict,
    listDocuments: dependencies.listDocuments,
    now,
    startedAt,
  });
  if (fastAnswer) return fastAnswer;

  const retrievalStartedAt = now();
  const searchResult = await dependencies.search({
    query: question,
    limit: parsePositiveInt(input.limit, DEFAULT_LIMIT, 3, MAX_LIMIT),
    context: 1,
    mode,
    track: normalizeScalar(input.track),
    module: normalizeScalar(input.module),
    includeArchive: Boolean(input.includeArchive),
    backend: input.backend,
    debug: Boolean(input.debug),
    debugTopN: parsePositiveInt(input.debugTopN, 5, 1, 25),
  });
  const retrievalMs = Number.isFinite(searchResult?.metrics?.latencyMs)
    ? roundMs(searchResult.metrics.latencyMs)
    : roundMs(now() - retrievalStartedAt);
  const synthesisStartedAt = now();

  if (!searchResult.hits.length) {
    const gate: GroundingGate = {
      pass: false,
      reasons: ["no evidence hits"],
      thresholds: buildGateThresholds(),
      measured: {
        hitCount: 0,
        uniqueSources: 0,
        tokenCoverage: 0,
        topScore: 0,
        dominantSourceShare: 1,
      },
    };
    return {
      question,
      answer:
        "No grounded answer available from local KB evidence for this query. Broaden the query or remove filters.",
      strict,
      responseMode,
      sourceTier: "no-local-evidence",
      abstained: true,
      confidence: { label: "low", score: 0.15, rationale: "No evidence hits" },
      gate,
      citations: [],
      evidence: [],
      search: {
        signals: searchResult.signals || null,
        debug: searchResult.debug || null,
        metrics: searchResult.metrics || null,
      },
      fastPath: { used: false, alreadyCaptured: false },
      timings: {
        retrievalMs,
        synthesisMs: roundMs(now() - synthesisStartedAt),
        captureMs: null,
        totalMs: roundMs(now() - startedAt),
      },
    };
  }

  const bestEvidence = searchResult.hits.slice(0, Math.min(6, searchResult.hits.length));
  const citations = bestEvidence.map((hit) => ({
    path: hit.path,
    line: hit.lineNumber,
    score: hit.score,
  }));
  const { confidence, gate } = assessGrounding(searchResult);
  const evidenceBullets = bestEvidence
    .slice(0, 4)
    .map((hit) => `${trimSentence(hit.snippet)} (${hit.path}:${hit.lineNumber})`);
  const shouldAbstain = strict && !gate.pass;
  let answer: string;

  if (shouldAbstain) {
    const reasonText = gate.reasons.length
      ? gate.reasons.join("; ")
      : "evidence thresholds not met";
    answer =
      "Grounded answer withheld (strict evidence gate):\n" +
      `- Reason: ${reasonText}.\n` +
      "- Please refine your question with specific Domain object names, transaction codes, or implementation context.\n" +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: Strict mode avoids weakly-grounded synthesis.";
  } else if (confidence.label === "low") {
    answer =
      "Grounded answer (retrieval-based, low confidence):\n" +
      "- The current evidence is partial or weak for a reliable direct answer.\n" +
      "- Please refine with more specific Domain object names, transaction codes, or module context.\n" +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: This output is extractive and intentionally conservative.";
  } else {
    answer =
      "Grounded answer (retrieval-based):\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: This synthesis is extractive from local KB evidence.";
  }

  return {
    question,
    answer,
    strict,
    responseMode,
    sourceTier: inferSourceTier(searchResult, bestEvidence),
    abstained: shouldAbstain,
    confidence,
    gate,
    citations,
    evidence: bestEvidence,
    search: {
      signals: searchResult.signals || null,
      debug: searchResult.debug || null,
      metrics: searchResult.metrics || null,
    },
    fastPath: { used: false, alreadyCaptured: false },
    timings: {
      retrievalMs,
      synthesisMs: roundMs(now() - synthesisStartedAt),
      captureMs: null,
      totalMs: roundMs(now() - startedAt),
    },
  };
}

async function tryBuildFastAnswer({
  question,
  mode,
  responseMode,
  strict,
  listDocuments,
  now,
  startedAt,
}: {
  question: string;
  mode: string;
  responseMode: AnswerResponseMode;
  strict: boolean;
  listDocuments: () => Promise<IndexedDocument[]>;
  now: () => number;
  startedAt: number;
}): Promise<GroundedAnswerResult | null> {
  if (responseMode === "curate" || mode === "project") return null;
  const extractedTerm = extractSimpleTerm(question);
  if (!extractedTerm) return null;
  const retrievalStartedAt = now();
  const documents = (await listDocuments()).map(toAnswerDocument);

  const termDoc = findFastTermDocument(documents, extractedTerm);
  if (termDoc) {
    const retrievalMs = roundMs(now() - retrievalStartedAt);
    const synthesisStartedAt = now();
    const citationLine =
      findHeadingLine(termDoc.lines, /^##\s+Definition\b/i) ||
      findHeadingLine(termDoc.lines, /^##\s+1-minute explanation\b/i) ||
      1;
    const shortAnswer =
      extractFastTermSummary(termDoc) ||
      `${termDoc.title} is a curated Domain term in the local KB.`;
    const answer = [
      "Fast grounded answer (term cache hit):",
      `- ${trimSentence(shortAnswer)}`,
      `- Source: ${termDoc.relPath}:${citationLine}`,
      "",
      "Note: Fast mode reused an existing curated term note.",
    ].join("\n");
    return buildFastResult({
      question,
      answer,
      strict,
      responseMode,
      sourceTier: "exact-term",
      confidenceScore: 0.94,
      confidenceRationale: "Direct match to an existing curated term note",
      score: 99,
      document: termDoc,
      citationLine,
      endLine: Math.min(termDoc.lines.length, citationLine + 1),
      snippet: shortAnswer,
      matchedTokens: [normalizeScalar(extractedTerm).toLowerCase()],
      fastPath: {
        used: true,
        mode: responseMode === "fast" ? "forced-fast" : "auto-fast",
        strategy: "term-note",
        term: extractedTerm,
        path: termDoc.relPath,
        alreadyCaptured: true,
      },
      retrievalMs,
      synthesisStartedAt,
      startedAt,
      now,
    });
  }

  const topicQuery = extractLikelyTopicQuery(question);
  if (!topicQuery) return null;
  const topicDoc = findFastTopicDocument(documents, topicQuery);
  if (!topicDoc) return null;

  const retrievalMs = roundMs(now() - retrievalStartedAt);
  const synthesisStartedAt = now();
  const citationLine = findHeadingLine(topicDoc.lines, /^#\s+/) || 1;
  const shortAnswer =
    extractFastTopicSummary(topicDoc) || `${topicDoc.title} is a curated local KB topic.`;
  const answer = [
    "Fast grounded answer (topic cache hit):",
    `- ${trimSentence(shortAnswer)}`,
    `- Source: ${topicDoc.relPath}:${citationLine}`,
    "",
    "Note: Fast mode reused an existing curated topic note.",
  ].join("\n");
  return buildFastResult({
    question,
    answer,
    strict,
    responseMode,
    sourceTier: "exact-topic",
    confidenceScore: 0.91,
    confidenceRationale: "Direct match to an existing curated topic note",
    score: 95,
    document: topicDoc,
    citationLine,
    endLine: Math.min(topicDoc.lines.length, citationLine + 3),
    snippet: shortAnswer,
    matchedTokens: tokenizeForSimilarity(topicQuery).slice(0, 12),
    fastPath: {
      used: true,
      mode: responseMode === "fast" ? "forced-fast" : "auto-fast",
      strategy: "topic-note",
      topic: topicQuery,
      path: topicDoc.relPath,
      alreadyCaptured: true,
    },
    retrievalMs,
    synthesisStartedAt,
    startedAt,
    now,
  });
}

function buildFastResult({
  question,
  answer,
  strict,
  responseMode,
  sourceTier,
  confidenceScore,
  confidenceRationale,
  score,
  document,
  citationLine,
  endLine,
  snippet,
  matchedTokens,
  fastPath,
  retrievalMs,
  synthesisStartedAt,
  startedAt,
  now,
}: {
  question: string;
  answer: string;
  strict: boolean;
  responseMode: AnswerResponseMode;
  sourceTier: string;
  confidenceScore: number;
  confidenceRationale: string;
  score: number;
  document: AnswerDocument;
  citationLine: number;
  endLine: number;
  snippet: string;
  matchedTokens: string[];
  fastPath: GroundedAnswerResult["fastPath"];
  retrievalMs: number;
  synthesisStartedAt: number;
  startedAt: number;
  now: () => number;
}): GroundedAnswerResult {
  return {
    question,
    answer,
    strict,
    responseMode,
    sourceTier,
    abstained: false,
    confidence: {
      label: "high",
      score: confidenceScore,
      rationale: confidenceRationale,
    },
    gate: {
      pass: true,
      reasons: [],
      thresholds: {
        ...buildGateThresholds(),
        minHits: 1,
        minUniqueSources: 1,
        minTokenCoverage: 0,
        minTopScore: 0,
        maxDominantSourceShare: 1,
      },
      measured: {
        hitCount: 1,
        uniqueSources: 1,
        tokenCoverage: 1,
        topScore: score,
        dominantSourceShare: 1,
      },
    },
    citations: [{ path: document.relPath, line: citationLine, score }],
    evidence: [
      {
        path: document.relPath,
        score,
        lineNumber: citationLine,
        endLine,
        title: document.title,
        sourceKind: document.sourceKind,
        track: document.track,
        module: document.module,
        snippet,
        matchedTokens,
        context: [],
      },
    ],
    search: { signals: null, debug: null },
    fastPath,
    timings: {
      retrievalMs,
      synthesisMs: roundMs(now() - synthesisStartedAt),
      captureMs: null,
      totalMs: roundMs(now() - startedAt),
    },
  };
}

function toAnswerDocument(document: IndexedDocument): AnswerDocument {
  return { ...document, lines: document.body.split(/\r?\n/) };
}

function findFastTermDocument(documents: AnswerDocument[], term: string): AnswerDocument | null {
  const termDocs = documents.filter(
    (document) => document.relPath.startsWith("kb/terms/") && document.relPath.endsWith(".md"),
  );
  const target = normalizeTermKey(term);
  if (!target) return null;
  const exact = termDocs.find((document) => {
    const base = path.basename(document.relPath, ".md");
    return normalizeTermKey(base) === target || normalizeTermKey(document.title) === target;
  });
  if (exact) return exact;
  const normalizedQuery = normalizeForMatch(term);
  const best = termDocs
    .map((document) => ({ document, score: scoreDocumentMatch(document, normalizedQuery) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.document.relPath.localeCompare(right.document.relPath),
    )[0];
  return best && best.score >= 95 ? best.document : null;
}

function findFastTopicDocument(
  documents: AnswerDocument[],
  topicQuery: string,
): AnswerDocument | null {
  const normalizedQuery = normalizeForMatch(topicQuery);
  const best = documents
    .filter(
      (document) => document.relPath.startsWith("kb/topics/") && document.relPath.endsWith(".md"),
    )
    .map((document) => ({ document, score: scoreDocumentMatch(document, normalizedQuery) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.document.relPath.localeCompare(right.document.relPath),
    )[0];
  return best && best.score >= 95 ? best.document : null;
}

function extractSimpleTerm(question: string): string {
  const q = singleLine(question);
  const patterns = [
    /^\s*what(?:'s|\s+is)\s+([A-Za-z0-9/_-]{2,24})\s+in\s+domain\s*\??\s*$/i,
    /^\s*define\s+([A-Za-z0-9/_-]{2,24})\s+(?:in\s+domain)?\s*\??\s*$/i,
    /^\s*meaning\s+of\s+([A-Za-z0-9/_-]{2,24})\s+in\s+domain\s*\??\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    const candidate = normalizeScalar(match?.[1]).replace(/[^A-Za-z0-9/_-]+/g, "");
    if (candidate && normalizeTermKey(candidate) !== "Domain") return candidate;
  }
  return "";
}

function extractLikelyTopicQuery(question: string): string {
  const q = singleLine(question).replace(/\?+$/, "");
  const patterns = [
    /^\s*(?:explain|summarize|tell\s+me\s+about)\s+(.+)$/i,
    /^\s*what(?:'s|\s+is)\s+(.+)$/i,
    /^\s*how\s+does\s+(.+)\s+work\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match?.[1]) return singleLine(match[1]);
  }
  return q.length <= 160 ? q : "";
}

function extractFastTermSummary(document: AnswerDocument): string {
  const { lines } = document;
  const minuteHeading = findHeadingLine(lines, /^##\s+1-minute explanation\b/i);
  if (minuteHeading) {
    const bullets: string[] = [];
    for (let index = minuteHeading; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) break;
      const bullet = lines[index].match(/^\s*-\s+(.*)$/)?.[1];
      if (bullet) bullets.push(singleLine(bullet));
      if (bullets.length >= 2) break;
    }
    if (bullets.length) return bullets.join(" ");
  }
  const definitionHeading = findHeadingLine(lines, /^##\s+Definition\b/i);
  if (definitionHeading) {
    for (let index = definitionHeading; index < lines.length; index += 1) {
      const line = singleLine(lines[index]);
      if (!line) continue;
      if (/^##\s+/.test(line)) break;
      return line;
    }
  }
  for (const raw of lines) {
    const line = singleLine(raw);
    if (!line || line.startsWith("#")) continue;
    return line.startsWith("- ") ? line.slice(2).trim() : line;
  }
  return "";
}

function extractFastTopicSummary(document: AnswerDocument): string {
  const { lines } = document;
  const heading = lines.findIndex((line) =>
    /^##\s+(Decision|Definition|Goal|Purpose|1-minute explanation|Current status|Summary)\b/i.test(
      line,
    ),
  );
  const start = heading >= 0 ? heading + 1 : 0;
  const bullets: string[] = [];
  const paragraphs: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^##\s+/.test(lines[index])) break;
    const line = singleLine(lines[index]);
    if (!line || line.startsWith("#")) continue;
    const bullet = line.match(/^[-*]\s+(.+)$/)?.[1];
    if (bullet) {
      bullets.push(singleLine(bullet));
      if (bullets.length >= 2) break;
    } else {
      paragraphs.push(line);
      if (paragraphs.join(" ").length >= 180) break;
    }
  }
  return bullets.length ? bullets.join(" ") : paragraphs.join(" ");
}

function assessGrounding(searchResult: SearchResult): {
  confidence: GroundingConfidence;
  gate: GroundingGate;
} {
  const hits = searchResult.hits || [];
  const queryTokens = searchResult.queryTokens || [];
  const topHits = hits.slice(0, 5);
  const signals = searchResult.signals as SearchResult["signals"] & { hitCount?: number };
  const topScore = Number.isFinite(signals?.topScore) ? signals.topScore : topHits[0]?.score || 0;
  const hitCount =
    typeof signals?.hitCount === "number" && Number.isFinite(signals.hitCount)
      ? signals.hitCount
      : hits.length;
  const uniqueSources = Number.isFinite(signals?.uniqueSources)
    ? signals.uniqueSources
    : new Set(topHits.map((hit) => hit.path)).size;
  const tokenCoverage = Number.isFinite(signals?.tokenCoverage)
    ? signals.tokenCoverage
    : estimateTokenCoverage(topHits, queryTokens);
  const dominantSourceShare = Number.isFinite(signals?.dominantSourceShare)
    ? signals.dominantSourceShare
    : estimateDominantSourceShare(topHits);
  const thresholds = buildGateThresholds();
  const reasons: string[] = [];
  if (hitCount < thresholds.minHits)
    reasons.push(`evidence hits ${hitCount} < ${thresholds.minHits}`);
  if (uniqueSources < thresholds.minUniqueSources)
    reasons.push(`unique sources ${uniqueSources} < ${thresholds.minUniqueSources}`);
  if (tokenCoverage < thresholds.minTokenCoverage)
    reasons.push(`token coverage ${tokenCoverage} < ${thresholds.minTokenCoverage}`);
  if (topScore < thresholds.minTopScore)
    reasons.push(`top score ${topScore} < ${thresholds.minTopScore}`);
  if (dominantSourceShare > thresholds.maxDominantSourceShare)
    reasons.push(`source dominance ${dominantSourceShare} > ${thresholds.maxDominantSourceShare}`);

  const score = Number(
    (
      0.45 * Math.min(1, topScore / 18) +
      0.3 * (queryTokens.length ? Math.min(1, tokenCoverage) : 0.5) +
      0.25 * Math.min(1, uniqueSources / 3)
    ).toFixed(2),
  );
  const confidence: GroundingConfidence =
    score >= 0.75
      ? {
          label: "high",
          score,
          rationale: "High-scoring evidence with strong query coverage and source diversity",
        }
      : score >= 0.5
        ? {
            label: "medium",
            score,
            rationale: "Moderate evidence quality; answer is grounded but may require verification",
          }
        : {
            label: "low",
            score,
            rationale: "Weak or partial evidence coverage; refine query for a reliable answer",
          };
  return {
    confidence,
    gate: {
      pass: reasons.length === 0,
      reasons,
      thresholds,
      measured: {
        hitCount,
        uniqueSources,
        tokenCoverage: Number(tokenCoverage.toFixed(3)),
        topScore: Number(topScore.toFixed(3)),
        dominantSourceShare: Number(dominantSourceShare.toFixed(3)),
      },
    },
  };
}

function buildGateThresholds() {
  return {
    minHits: 3,
    minUniqueSources: 2,
    minTokenCoverage: 0.45,
    minTopScore: 14,
    maxDominantSourceShare: 0.9,
  };
}

function inferSourceTier(searchResult: SearchResult, evidence: SearchHit[]): string {
  if (evidence.some((hit) => hit.sourceKind === "reference-source")) return "local-book";
  return searchResult.backend === "sqlite" ? "sqlite" : "bm25";
}

function estimateTokenCoverage(hits: SearchHit[], queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const covered = new Set(hits.flatMap((hit) => hit.matchedTokens || []));
  return covered.size / queryTokens.length;
}

function estimateDominantSourceShare(hits: SearchHit[]): number {
  if (!hits.length) return 1;
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.path, (counts.get(hit.path) || 0) + 1);
  return Math.max(...counts.values()) / hits.length;
}

function normalizeResponseMode(value: unknown): AnswerResponseMode {
  const mode = normalizeScalar(value).toLowerCase();
  return mode === "fast" || mode === "curate" ? mode : "auto";
}

function normalizeForMatch(value: unknown): string {
  return normalizeScalar(value).toLowerCase().replace(/\\/g, "/").replace(/\.md$/i, "");
}

function normalizeTermKey(value: unknown): string {
  return normalizeScalar(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function scoreDocumentMatch(document: AnswerDocument, normalizedQuery: string): number {
  const rel = normalizeForMatch(document.relPath);
  const base = normalizeForMatch(path.basename(document.relPath, path.extname(document.relPath)));
  const title = normalizeForMatch(document.title);
  let score = 0;
  if (rel === normalizedQuery) score += 120;
  if (rel.endsWith(`/${normalizedQuery}`)) score += 100;
  if (base === normalizedQuery) score += 95;
  if (base.includes(normalizedQuery)) score += 60;
  if (title && title.includes(normalizedQuery)) score += 40;
  if (normalizedQuery.includes(base)) score += 25;
  return score;
}

function findHeadingLine(lines: string[], pattern: RegExp): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1;
  }
  return 0;
}

function singleLine(value: unknown): string {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function tokenizeForSimilarity(value: unknown): string[] {
  return normalizeScalar(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !SIMILARITY_STOPWORDS.has(token));
}

function trimSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function roundMs(value: number): number {
  return Number(Number(value || 0).toFixed(2));
}
