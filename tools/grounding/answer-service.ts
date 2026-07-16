import path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeScalar, parsePositiveInt } from "./document-core.js";
import { DEFAULT_DOMAIN_PROFILE, resolveModeAlias } from "../workspaces/domain-profile.js";
import type { DomainProfile } from "../workspaces/types.js";
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
  projectId?: unknown;
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

export interface GroundedTokenUsage {
  kind: "estimate";
  scope: "gke-visible-text";
  requestTokens: number;
  evidenceTokens: number;
  answerTokens: number;
  totalTokens: number;
  method: "characters-divided-by-4";
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
  tokenUsage: GroundedTokenUsage;
}

type GroundedAnswerWithoutTokenUsage = Omit<GroundedAnswerResult, "tokenUsage">;

export interface GroundedAnswerDependencies {
  search: (args: SearchArgs & { backend?: unknown }) => Promise<SearchResult>;
  listDocuments: () => Promise<IndexedDocument[]>;
  now?: () => number;
  domain?: DomainProfile;
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
  const domain = dependencies.domain ?? DEFAULT_DOMAIN_PROFILE;
  const mode = resolveModeAlias(domain, normalizeScalar(input.mode).toLowerCase());
  const fastAnswer = await tryBuildFastAnswer({
    question,
    mode,
    responseMode,
    strict,
    domain,
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
    return attachTokenUsage({
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
    });
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
  const directAnswerLines = shouldAbstain
    ? []
    : await extractDirectAnswerLines(question, bestEvidence, dependencies.listDocuments);
  let answer: string;

  if (shouldAbstain) {
    const reasonText = gate.reasons.length
      ? gate.reasons.join("; ")
      : "evidence thresholds not met";
    answer =
      "Grounded answer withheld (strict evidence gate):\n" +
      `- Reason: ${reasonText}.\n` +
      `- Please refine your question with specific ${domain.label} object names, transaction codes, or implementation context.\n` +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: Strict mode avoids weakly-grounded synthesis.";
  } else if (confidence.label === "low") {
    answer =
      "Grounded answer (retrieval-based, low confidence):\n" +
      "- The current evidence is partial or weak for a reliable direct answer.\n" +
      `- Please refine with more specific ${domain.label} object names, transaction codes, or module context.\n` +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: This output is extractive and intentionally conservative.";
  } else {
    answer = directAnswerLines.length
      ? directAnswerLines.map((line) => `- ${line}`).join("\n")
      : evidenceBullets.map((line) => `- ${line}`).join("\n");
  }

  return attachTokenUsage({
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
  });
}

/**
 * Produce a short, clearly extractive answer from the most title-relevant
 * source. This is intentionally not model synthesis: every visible line is a
 * cleaned line from canonical local Markdown, while citations remain separate
 * structured data for clients that need the provenance.
 */
async function extractDirectAnswerLines(
  question: string,
  evidence: SearchHit[],
  listDocuments: () => Promise<IndexedDocument[]>,
): Promise<string[]> {
  try {
    const sourcePaths = [...new Set(evidence.map((hit) => hit.path))];
    if (!sourcePaths.length) return [];
    const sourceRanks = new Map(sourcePaths.map((path, index) => [path, index]));
    const queryTokens = new Set(tokenizeForSimilarity(question));
    const documents = (await listDocuments())
      .map(toAnswerDocument)
      .filter((document) => sourceRanks.has(document.relPath));
    if (!documents.length) return [];

    const primary = [...documents].sort((left, right) => {
      const titleDifference =
        titleOverlap(right.title, queryTokens) - titleOverlap(left.title, queryTokens);
      if (titleDifference) return titleDifference;
      return (sourceRanks.get(left.relPath) || 0) - (sourceRanks.get(right.relPath) || 0);
    })[0];
    if (!primary) return [];

    const candidates = extractSourceAnswerEntries(primary.lines)
      .map(({ rawLine, index }) => ({ rawLine, line: cleanAnswerLine(rawLine), index }))
      .map(({ rawLine, line, index }) => ({
        rawLine,
        line,
        index,
        matches: tokenizeForSimilarity(line).filter((token) => queryTokens.has(token)),
      }))
      .filter(
        ({ line, index, matches }) =>
          line && !isMarkdownHeading(primary.lines[index]) && matches.length > 0,
      )
      .map((candidate) => ({
        ...candidate,
        score:
          candidate.matches.length +
          (isMarkdownListItem(primary.lines[candidate.index]) ? 0.25 : 0),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const listCandidates = candidates.filter((candidate) => isMarkdownListItem(candidate.rawLine));
    const preferredCandidates = listCandidates.length >= 2 ? listCandidates : candidates;
    const selectedCandidates = preferredCandidates
      .slice(0, 3)
      .sort((left, right) => left.index - right.index);

    return selectedCandidates.map((candidate) => compactExtractedLine(candidate.line));
  } catch {
    // Retrieval remains useful when a source document disappears between the
    // search and this optional direct-answer extraction step.
    return [];
  }
}

function titleOverlap(title: string, queryTokens: ReadonlySet<string>): number {
  return tokenizeForSimilarity(title).filter((token) => queryTokens.has(token)).length;
}

/** Markdown often wraps one list item across several physical lines. */
function extractSourceAnswerEntries(lines: string[]): Array<{ rawLine: string; index: number }> {
  const entries: Array<{ rawLine: string; index: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim() || isMarkdownHeading(rawLine)) continue;
    if (!isMarkdownListItem(rawLine)) {
      entries.push({ rawLine, index });
      continue;
    }
    const parts = [rawLine.trim()];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const next = lines[nextIndex];
      if (!next.trim() || isMarkdownHeading(next) || isMarkdownListItem(next)) break;
      parts.push(next.trim());
      nextIndex += 1;
    }
    entries.push({ rawLine: parts.join(" "), index });
    index = nextIndex - 1;
  }
  return entries;
}

function isMarkdownListItem(value: string | undefined): boolean {
  return /^\s*[-*+]\s+/.test(value || "");
}

function isMarkdownHeading(value: string | undefined): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(value || "");
}

function cleanAnswerLine(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Make common source-list patterns answer-sized without adding new claims. */
function compactExtractedLine(value: string): string {
  const stdioMatch = value.match(
    /^(.+?) communicates over standard input\/output streams\s+—\s+the natural fit for (.+)$/i,
  );
  if (stdioMatch) {
    return `${stdioMatch[1]}: standard input/output for ${stdioMatch[2]}`;
  }
  const httpSseMatch = value.match(
    /^(.+?) streams server-to-client over Server-Sent Events while the client posts requests over HTTP\s+—\s+suited to (.+)$/i,
  );
  if (httpSseMatch) {
    return `${httpSseMatch[1]}: server-to-client events plus HTTP requests for ${httpSseMatch[2]}`;
  }
  return value;
}

async function tryBuildFastAnswer({
  question,
  mode,
  responseMode,
  strict,
  domain,
  listDocuments,
  now,
  startedAt,
}: {
  question: string;
  mode: string;
  responseMode: AnswerResponseMode;
  strict: boolean;
  domain: DomainProfile;
  listDocuments: () => Promise<IndexedDocument[]>;
  now: () => number;
  startedAt: number;
}): Promise<GroundedAnswerResult | null> {
  if (responseMode === "curate" || mode === "project") return null;
  const extractedTerm = extractSimpleTerm(question, domain);
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
      `${termDoc.title} is a curated ${domain.label} term in the local KB.`;
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
  return attachTokenUsage({
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
  });
}

function attachTokenUsage(result: GroundedAnswerWithoutTokenUsage): GroundedAnswerResult {
  const requestTokens = estimateTokens(result.question);
  const evidenceTokens = estimateTokens(
    result.evidence
      .map((item) => [item.title, item.path, item.snippet, ...(item.context || [])].join("\n"))
      .join("\n"),
  );
  const answerTokens = estimateTokens(result.answer);
  return {
    ...result,
    tokenUsage: {
      kind: "estimate",
      scope: "gke-visible-text",
      requestTokens,
      evidenceTokens,
      answerTokens,
      totalTokens: requestTokens + evidenceTokens + answerTokens,
      method: "characters-divided-by-4",
    },
  };
}

function estimateTokens(value: string): number {
  const characters = Array.from(value.trim()).length;
  return characters ? Math.max(1, Math.ceil(characters / 4)) : 0;
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

function extractSimpleTerm(question: string, domain: DomainProfile): string {
  const q = singleLine(question);
  const excluded = new Set(
    [domain.label, ...domain.labelTokens].map((token) => normalizeTermKey(token).toLowerCase()),
  );
  for (const pattern of domain.termQuestionPatterns) {
    const match = q.match(pattern);
    const candidate = normalizeScalar(match?.[1]).replace(/[^A-Za-z0-9/_-]+/g, "");
    if (candidate && !excluded.has(normalizeTermKey(candidate).toLowerCase())) return candidate;
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
  const focusedCanonicalHit = findFocusedCanonicalHit(topHits, queryTokens);
  const thresholds = focusedCanonicalHit
    ? buildFocusedCanonicalGateThresholds()
    : buildGateThresholds();
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
    focusedCanonicalHit && reasons.length === 0
      ? {
          label: "high",
          score: Math.max(score, 0.8),
          rationale: "Direct match to a canonical local source",
        }
      : score >= 0.75
        ? {
            label: "high",
            score,
            rationale: "High-scoring evidence with strong query coverage and source diversity",
          }
        : score >= 0.5
          ? {
              label: "medium",
              score,
              rationale:
                "Moderate evidence quality; answer is grounded but may require verification",
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

/**
 * A question that names a canonical note directly is safely answerable from
 * that one source. Broad questions still use the stricter multi-source gate.
 */
function buildFocusedCanonicalGateThresholds() {
  return {
    ...buildGateThresholds(),
    minHits: 1,
    minUniqueSources: 1,
    minTopScore: 4,
    maxDominantSourceShare: 1,
  };
}

function findFocusedCanonicalHit(hits: SearchHit[], queryTokens: string[]): SearchHit | undefined {
  const topHit = hits[0];
  if (!topHit) return undefined;
  const tokens = new Set(queryTokens);
  return isCanonicalTopicOrTerm(topHit) && titleOverlap(topHit.title, tokens) >= 2
    ? topHit
    : undefined;
}

function isCanonicalTopicOrTerm(hit: SearchHit): boolean {
  return (
    hit.sourceKind === "kb-topic" ||
    hit.sourceKind === "kb-term" ||
    /(?:^|\/)(?:demo-kb|kb)\/(?:topics|terms)\//.test(hit.path)
  );
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
