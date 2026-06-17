import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CandidateFile,
  CachedRetrieverIndex,
  Frontmatter,
  IndexedChunk,
  IndexedDocument,
  KbRetriever,
  ResolvedRetrieverOptions,
  RetrieverIndex,
  RetrieverOptions,
  SearchArgs,
  SearchContextRow,
  SearchHit,
  SearchMode,
  SearchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_SCAN_ROOTS = ["demo-kb", "kb", "README.md"];

const INDEX_VERSION = 2;
const DEFAULT_INDEX_CACHE_FILE = ".cache/kb-retriever-index.v2.json";
const DEFAULT_INDEX_CACHE_TTL_MS = 30000;
const DEFAULT_QUERY_CACHE_TTL_MS = 45000;
const DEFAULT_QUERY_CACHE_MAX_ENTRIES = 240;

const DEFAULT_CHUNK_TARGET = 560;
const DEFAULT_CHUNK_MAX = 920;
const DEFAULT_CHUNK_OVERLAP = 140;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
const MAX_CONTEXT = 3;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "if", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their", "then", "there", "these", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you", "your", "after", "before", "during", "about", "can", "could", "should", "would", "do", "does", "did", "done", "than", "over", "under", "through", "up", "down", "across", "within", "without", "using", "use", "used", "via", "only", "also", "more", "most", "less", "least", "very", "much", "many", "few", "some", "any",
]);

const QUERY_EXPANSIONS: Record<string, string[]> = {
  rap: ["restful", "abap", "behavior", "eml", "cds"],
  eml: ["entity", "manipulation", "language", "rap"],
  cds: ["core", "data", "services"],
  btp: ["business", "technology", "platform"],
  flp: ["fiori", "launchpad", "intent"],
  so: ["sales", "order"],
  cr: ["change", "request", "workflow"],
  s4: ["s4hana", "s/4", "s/4hana"],
  s4hana: ["s4", "s/4", "s/4hana"],
  "s/4": ["s4", "s4hana", "s/4hana"],
  "s/4hana": ["s4", "s4hana", "s/4"],
  fiori: ["flp", "launchpad"],
};

let runtimeCache = {
  loadedAt: 0,
  cacheKey: "",
  retriever: null as KbRetriever | null,
};

type QueryWeights = Map<string, number>;
type CandidateScoreMap = Map<number, number>;
type MatchedTermsMap = Map<number, Set<string>>;
type TokenContributionMap = Map<number, Map<string, number>>;

interface SearchCacheKeyParts {
  query: string;
  mode: string;
  limit: number;
  contextRadius: number;
  maxPerPath: number;
  track: string;
  module: string;
  includeArchive: boolean;
  debug: boolean;
  debugTopN: number;
}

interface RankedCandidate {
  chunk: IndexedChunk;
  baseScore: number;
  score: number;
  matchedTerms: string[];
  rerankAdjustments?: RerankAdjustment[];
  tokenContributions: Map<string, number> | null;
}

interface RerankAdjustment {
  reason: string;
  delta: number;
}

interface RerankArgs {
  chunk: IndexedChunk;
  baseScore: number;
  query: string;
  mode: string;
  matchedTokenCount: number;
  tokenWeights: QueryWeights;
  debug: boolean;
}

interface RerankResult {
  score: number;
  adjustments?: RerankAdjustment[];
}

interface AnchorLine {
  lineOffset: number;
  lineNumber: number;
}

interface DebugCandidateArgs {
  candidates: RankedCandidate[];
  query: string;
  tokenWeights: QueryWeights;
  limit: number;
}

interface FallbackCandidateArgs {
  chunks: IndexedChunk[];
  query: string;
  mode: string;
  activeChunks: (chunk: IndexedChunk) => boolean;
  outScores: CandidateScoreMap;
  outMatchedTerms: MatchedTermsMap;
}

interface ChunkDraft {
  startLine: number;
  endLine: number;
  text: string;
}

interface ParsedFrontmatter {
  frontmatter: Frontmatter;
  body: string;
}

export async function getKbRetriever(options: RetrieverOptions = {}): Promise<KbRetriever> {
  const resolved = resolveOptions(options);
  const now = Date.now();

  if (
    !resolved.forceRefresh &&
    runtimeCache.retriever &&
    runtimeCache.cacheKey === resolved.cacheKey &&
    now - runtimeCache.loadedAt < resolved.cacheTtlMs
  ) {
    return runtimeCache.retriever;
  }

  const indexed = await loadOrBuildIndex(resolved);
  const retriever = createRetriever(indexed, resolved);

  runtimeCache = {
    loadedAt: now,
    cacheKey: resolved.cacheKey,
    retriever,
  };

  return retriever;
}

function resolveOptions(options: RetrieverOptions): ResolvedRetrieverOptions {
  const repoRoot = path.resolve(options.repoRoot || process.env.KB_MCP_REPO_ROOT || path.join(__dirname, "..", ".."));
  const scanRoots = normalizeScanRoots(options.scanRoots || process.env.KB_MCP_SCAN_ROOTS || DEFAULT_SCAN_ROOTS);
  const cachePath = path.resolve(repoRoot, options.cachePath || DEFAULT_INDEX_CACHE_FILE);
  const cacheTtlMs = parsePositiveInt(options.cacheTtlMs, DEFAULT_INDEX_CACHE_TTL_MS, 1000, 10 * 60 * 1000);
  const queryCacheTtlMs = parsePositiveInt(
    options.queryCacheTtlMs ?? process.env.KB_MCP_QUERY_CACHE_TTL_MS,
    DEFAULT_QUERY_CACHE_TTL_MS,
    0,
    10 * 60 * 1000,
  );
  const queryCacheMaxEntries = parsePositiveInt(
    options.queryCacheMaxEntries ?? process.env.KB_MCP_QUERY_CACHE_MAX_ENTRIES,
    DEFAULT_QUERY_CACHE_MAX_ENTRIES,
    10,
    2000,
  );
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `${repoRoot}::${scanRoots.join(",")}::${cachePath}`;

  return {
    repoRoot,
    scanRoots,
    cachePath,
    cacheTtlMs,
    queryCacheTtlMs,
    queryCacheMaxEntries,
    forceRefresh,
    cacheKey,
  };
}

async function loadOrBuildIndex(options: ResolvedRetrieverOptions): Promise<RetrieverIndex> {
  const files = await gatherCandidateFiles(options.repoRoot, options.scanRoots);
  const manifestHash = buildManifestHash(files);

  if (!options.forceRefresh) {
    const cached = await tryLoadCachedIndex(options.cachePath);
    if (cached && cached.version === INDEX_VERSION && cached.manifestHash === manifestHash) {
      return hydrateIndex(cached);
    }
  }

  const built = await buildIndex({
    repoRoot: options.repoRoot,
    files,
    manifestHash,
    scanRoots: options.scanRoots,
  });

  await trySaveCachedIndex(options.cachePath, built);
  return hydrateIndex(built);
}

async function buildIndex({
  repoRoot,
  files,
  manifestHash,
  scanRoots,
}: {
  repoRoot: string;
  files: CandidateFile[];
  manifestHash: string;
  scanRoots: string[];
}): Promise<CachedRetrieverIndex> {
  const docs: IndexedDocument[] = [];
  const chunks: IndexedChunk[] = [];
  const postings = new Map<string, Array<[number, number]>>();
  const docFreq = new Map<string, number>();
  let totalChunkLength = 0;

  for (const file of files) {
    let raw;
    try {
      raw = await fs.readFile(file.absPath, "utf8");
    } catch {
      continue;
    }

    const isMarkdown = file.relPath.endsWith(".md");
    const parsed = isMarkdown ? parseFrontmatter(raw) : { frontmatter: {} as Record<string, string>, body: raw };
    const body = parsed.body || "";
    if (!body.trim()) continue;

    const frontmatter = parsed.frontmatter || {};
    const docId = docs.length;
    const doc = {
      id: docId,
      relPath: file.relPath,
      title: getDocumentTitle(body, file.relPath),
      track: inferTrack(file.relPath, frontmatter),
      module: normalizeScalar(frontmatter.module),
      sourceKind: inferSourceKind(file.relPath),
      frontmatter,
      body,
      isArchive: file.relPath.startsWith("kb/archive/"),
    };
    docs.push(doc);

    const bodyLines = body.split(/\r?\n/);
    const docChunks = chunkDocument(bodyLines);
    for (const piece of docChunks) {
      const chunkId = chunks.length;
      const tokens = tokenizeForIndex(piece.text);
      if (!tokens.length) continue;

      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + 1);
      }

      const chunk = {
        id: chunkId,
        docId,
        path: doc.relPath,
        title: doc.title,
        track: doc.track,
        module: doc.module,
        sourceKind: doc.sourceKind,
        isArchive: doc.isArchive,
        startLine: piece.startLine,
        endLine: piece.endLine,
        text: piece.text,
        length: tokens.length,
      };
      chunks.push(chunk);
      totalChunkLength += chunk.length;

      for (const [term, tf] of termFreq.entries()) {
        if (!postings.has(term)) postings.set(term, []);
        postings.get(term).push([chunk.id, tf]);
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }
  }

  const avgChunkLength = chunks.length ? totalChunkLength / chunks.length : 0;

  return {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    manifestHash,
    scanRoots,
    docs,
    chunks,
    postings: serializeMap(postings),
    docFreq: serializeMap(docFreq),
    avgChunkLength,
  };
}

function createRetriever(indexed: RetrieverIndex, options: ResolvedRetrieverOptions): KbRetriever {
  const { docs, chunks, postings, docFreq, avgChunkLength } = indexed;
  const byPath = new Map(docs.map((doc) => [doc.relPath, doc]));
  const queryCache = new Map<string, { createdAt: number; value: SearchResult }>();
  let queryCacheHits = 0;
  let queryCacheMisses = 0;

  function search(args: SearchArgs = {}): SearchResult {
    const startedAt = Date.now();
    const query = normalizeScalar(args.query);
    if (!query) throw new Error("Missing required argument: query");

    const mode = inferMode(query, normalizeScalar(args.mode) || "auto");
    const limit = parsePositiveInt(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const contextRadius = parsePositiveInt(args.context, 1, 0, MAX_CONTEXT);
    const maxPerPath = parsePositiveInt(args.maxPerPath, Math.max(2, Math.ceil(limit / 2)), 1, limit);
    const track = normalizeScalar(args.track);
    const module = normalizeScalar(args.module);
    const includeArchive = Boolean(args.includeArchive);
    const disableCache = Boolean(args.disableCache);
    const debug = Boolean(args.debug);
    const debugTopN = parsePositiveInt(args.debugTopN, 5, 1, 25);
    const shouldUseCache = options.queryCacheTtlMs > 0 && !disableCache && !debug;

    const cacheKey = buildSearchCacheKey({
      query,
      mode,
      limit,
      contextRadius,
      maxPerPath,
      track,
      module,
      includeArchive,
      debug,
      debugTopN,
    });

    if (shouldUseCache) {
      const cached = queryCache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt <= options.queryCacheTtlMs) {
        queryCacheHits += 1;
        const cachedResult = cloneSearchResult(cached.value);
        cachedResult.metrics = {
          ...(cachedResult.metrics || {}),
          latencyMs: Date.now() - startedAt,
          cache: {
            hit: true,
            ttlMs: options.queryCacheTtlMs,
          },
        };
        return cachedResult;
      }
      if (cached) queryCache.delete(cacheKey);
      queryCacheMisses += 1;
    }

    const tokenWeights = buildWeightedQueryTokens(query);
    const candidateScores: CandidateScoreMap = new Map();
    const matchedTerms: MatchedTermsMap = new Map();
    const tokenContributions: TokenContributionMap | null = debug ? new Map() : null;

    const activeChunks = (chunk: IndexedChunk): boolean => {
      if (!includeArchive && chunk.isArchive) return false;
      if (track && chunk.track !== track) return false;
      if (module && chunk.module !== module) return false;
      return true;
    };

    const nChunks = Math.max(chunks.length, 1);
    for (const [token, weight] of tokenWeights.entries()) {
      const posting = postings.get(token);
      if (!posting || !posting.length) continue;
      const df = docFreq.get(token) || 0;
      const idf = Math.log(1 + (nChunks - df + 0.5) / (df + 0.5));

      for (const [chunkId, tf] of posting) {
        const chunk = chunks[chunkId];
        if (!chunk || !activeChunks(chunk)) continue;

        const bm25 = bm25Score(tf, chunk.length, avgChunkLength, idf);
        const weightedContribution = bm25 * weight;
        candidateScores.set(chunkId, (candidateScores.get(chunkId) || 0) + weightedContribution);

        if (!matchedTerms.has(chunkId)) matchedTerms.set(chunkId, new Set());
        matchedTerms.get(chunkId).add(token);
        if (tokenContributions) {
          if (!tokenContributions.has(chunkId)) tokenContributions.set(chunkId, new Map());
          const chunkTokenContrib = tokenContributions.get(chunkId);
          if (!chunkTokenContrib) continue;
          chunkTokenContrib.set(token, (chunkTokenContrib.get(token) || 0) + weightedContribution);
        }
      }
    }

    if (!candidateScores.size) {
      seedFallbackCandidates({
        chunks,
        query,
        mode,
        activeChunks,
        outScores: candidateScores,
        outMatchedTerms: matchedTerms,
      });
    }

    const topWindow = Math.max(limit * 12, 80);
    const prelim: RankedCandidate[] = [...candidateScores.entries()]
      .map(([chunkId, baseScore]) => {
        const chunk = chunks[chunkId];
        const terms = matchedTerms.get(chunkId) || new Set();
        const rerankResult = rerankCandidate({
          chunk,
          baseScore,
          query,
          mode,
          matchedTokenCount: terms.size,
          tokenWeights,
          debug,
        });
        return {
          chunk,
          baseScore,
          score: rerankResult.score,
          matchedTerms: [...terms],
          rerankAdjustments: rerankResult.adjustments,
          tokenContributions: tokenContributions ? tokenContributions.get(chunkId) : null,
        };
      })
      .sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine)
      .slice(0, topWindow);

    const deduped = dedupeCandidates(prelim);
    const selected = deduped.slice(0, topWindow);
    const hits: SearchHit[] = [];
    const seenHitKeys = new Set<string>();
    const pathHitCounts = new Map<string, number>();
    for (const item of selected) {
      const pathCount = pathHitCounts.get(item.chunk.path) || 0;
      if (pathCount >= maxPerPath) continue;

      const anchor = chooseAnchorLine(item.chunk, query, tokenWeights);
      const hitKey = `${item.chunk.path}:${anchor.lineNumber}`;
      if (seenHitKeys.has(hitKey)) continue;
      seenHitKeys.add(hitKey);
      pathHitCounts.set(item.chunk.path, pathCount + 1);

      const context = buildChunkContext(item.chunk, anchor.lineOffset, contextRadius);
      const hit: SearchHit = {
        path: item.chunk.path,
        score: Number(item.score.toFixed(2)),
        lineNumber: anchor.lineNumber,
        endLine: item.chunk.endLine + 1,
        title: item.chunk.title,
        sourceKind: item.chunk.sourceKind,
        track: item.chunk.track,
        module: item.chunk.module,
        snippet: buildSnippet(item.chunk.text, query, tokenWeights),
        matchedTokens: item.matchedTerms,
        context,
      };
      if (debug) {
        hit.debug = {
          baseScore: round(item.baseScore),
          rerankAdjustments: item.rerankAdjustments || [],
          tokenContributions: summarizeTokenContributions(item.tokenContributions),
        };
      }
      hits.push(hit);
      if (hits.length >= limit) break;
    }

    const queryTokenList = [...tokenWeights.keys()];
    const evidenceSignals = buildEvidenceSignals(hits, queryTokenList);
    const debugPayload = debug
      ? {
          queryTokens: [...tokenWeights.entries()].map(([token, weight]) => ({
            token,
            weight: round(weight),
            expanded: weight < 1,
          })),
          candidateCountBeforeDedupe: prelim.length,
          candidateCountAfterDedupe: deduped.length,
          topCandidates: buildDebugCandidates({
            candidates: deduped,
            query,
            tokenWeights,
            limit: debugTopN,
          }),
        }
      : undefined;

    const result: SearchResult = {
      query,
      mode,
      queryTokens: queryTokenList,
      filters: {
        track: track || null,
        module: module || null,
        includeArchive,
      },
      retrieval: {
        maxPerPath,
      },
      metrics: {
        latencyMs: Date.now() - startedAt,
        cache: {
          hit: false,
          ttlMs: options.queryCacheTtlMs,
        },
      },
      signals: evidenceSignals,
      hitCount: hits.length,
      hits,
    };
    if (debugPayload) result.debug = debugPayload;

    if (shouldUseCache) {
      queryCache.set(cacheKey, {
        createdAt: Date.now(),
        value: cloneSearchResult(result),
      });
      trimQueryCache(queryCache, options.queryCacheMaxEntries);
    }

    return result;
  }

  function getDocuments() {
    return docs;
  }

  function getStats() {
    const byTrack: Record<string, number> = {};
    const bySourceKind: Record<string, number> = {};
    for (const chunk of chunks) {
      const track = chunk.track || "(none)";
      const kind = chunk.sourceKind || "(none)";
      byTrack[track] = (byTrack[track] || 0) + 1;
      bySourceKind[kind] = (bySourceKind[kind] || 0) + 1;
    }
    return {
      documents: docs.length,
      chunks: chunks.length,
      terms: postings.size,
      queryCache: {
        ttlMs: options.queryCacheTtlMs,
        maxEntries: options.queryCacheMaxEntries,
        currentEntries: queryCache.size,
        hits: queryCacheHits,
        misses: queryCacheMisses,
      },
      byTrack,
      bySourceKind,
    };
  }

  function getDocument(pathOrRelPath: string) {
    return byPath.get(pathOrRelPath) || null;
  }

  return {
    search,
    getDocuments,
    getDocument,
    getStats,
    meta: {
      scanRoots: options.scanRoots,
      repoRoot: options.repoRoot,
    },
  };
}

function trimQueryCache(cache: Map<string, { createdAt: number; value: SearchResult }>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function buildSearchCacheKey({
  query,
  mode,
  limit,
  contextRadius,
  maxPerPath,
  track,
  module,
  includeArchive,
  debug,
  debugTopN,
}: SearchCacheKeyParts): string {
  return JSON.stringify({
    q: query.toLowerCase(),
    mode,
    limit,
    contextRadius,
    maxPerPath,
    track: track || "",
    module: module || "",
    includeArchive: Boolean(includeArchive),
    debug: Boolean(debug),
    debugTopN,
  });
}

function cloneSearchResult(result: SearchResult): SearchResult {
  return JSON.parse(JSON.stringify(result));
}

function buildEvidenceSignals(hits: SearchHit[], queryTokens: string[]) {
  const topHits = hits.slice(0, 5);
  const uniqueSources = new Set(topHits.map((hit) => hit.path)).size;
  const topScore = topHits[0]?.score || 0;
  const avgTopScore = topHits.length ? mean(topHits.map((hit) => hit.score || 0)) : 0;
  const coveredTokens = new Set<string>();
  for (const hit of topHits) {
    const matched = Array.isArray(hit.matchedTokens) ? hit.matchedTokens : [];
    for (const token of matched) coveredTokens.add(token);
  }
  const tokenCoverage = queryTokens.length ? coveredTokens.size / queryTokens.length : 0;
  const dominantSourceShare = topHits.length ? Math.max(...sourceShares(topHits)) : 0;
  return {
    topScore: round(topScore),
    avgTopScore: round(avgTopScore),
    uniqueSources,
    tokenCoverage: round(tokenCoverage),
    dominantSourceShare: round(dominantSourceShare),
    hitCount: hits.length,
  };
}

function sourceShares(hits: SearchHit[]): number[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    counts.set(hit.path, (counts.get(hit.path) || 0) + 1);
  }
  return [...counts.values()].map((count) => count / hits.length);
}

function summarizeTokenContributions(contribMap: Map<string, number> | null): Array<{ token: string; score: number }> {
  if (!(contribMap instanceof Map)) return [];
  return [...contribMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token, score]) => ({ token, score: round(score) }));
}

function buildDebugCandidates({ candidates, query, tokenWeights, limit }: DebugCandidateArgs) {
  return candidates.slice(0, limit).map((item) => {
    const anchor = chooseAnchorLine(item.chunk, query, tokenWeights);
    return {
      path: item.chunk.path,
      lineNumber: anchor.lineNumber,
      title: item.chunk.title,
      score: round(item.score),
      baseScore: round(item.baseScore),
      matchedTokens: item.matchedTerms,
      rerankAdjustments: item.rerankAdjustments || [],
      tokenContributions: summarizeTokenContributions(item.tokenContributions),
    };
  });
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(Number(value || 0).toFixed(3));
}

function bm25Score(tf: number, docLength: number, avgDocLength: number, idf: number): number {
  const k1 = 1.2;
  const b = 0.75;
  const safeAvg = avgDocLength > 0 ? avgDocLength : 1;
  const numerator = tf * (k1 + 1);
  const denominator = tf + k1 * (1 - b + b * (docLength / safeAvg));
  return idf * (numerator / denominator);
}

function rerankCandidate({ chunk, baseScore, query, mode, matchedTokenCount, tokenWeights, debug }: RerankArgs): RerankResult {
  let score = baseScore;
  const adjustments: RerankAdjustment[] = [];
  const queryLower = query.toLowerCase();
  const textLower = chunk.text.toLowerCase();
  const pathLower = chunk.path.toLowerCase();
  const titleLower = (chunk.title || "").toLowerCase();

  if (queryLower.length >= 5 && textLower.includes(queryLower)) {
    score += 5;
    if (debug) adjustments.push({ reason: "exact_query_match", delta: 5 });
  }

  const tokenMatchBoost = Math.min(3.2, matchedTokenCount * 0.45);
  score += tokenMatchBoost;
  if (debug && tokenMatchBoost) adjustments.push({ reason: "matched_token_count", delta: round(tokenMatchBoost) });

  for (const token of tokenWeights.keys()) {
    if (pathLower.includes(token)) {
      score += 0.35;
      if (debug) adjustments.push({ reason: `path_token:${token}`, delta: 0.35 });
    }
    if (titleLower.includes(token)) {
      score += 0.55;
      if (debug) adjustments.push({ reason: `title_token:${token}`, delta: 0.55 });
    }
  }

  if (mode === "domain") {
    if (chunk.sourceKind === "reference-source") {
      score += 2.4;
      if (debug) adjustments.push({ reason: "mode_sap_source_preference", delta: 2.4 });
    }
    if (chunk.track === "domain") {
      score += 1.1;
      if (debug) adjustments.push({ reason: "mode_sap_track_preference", delta: 1.1 });
    }
  } else if (mode === "project") {
    if (chunk.sourceKind === "project") {
      score += 2.8;
      if (debug) adjustments.push({ reason: "mode_project_source_preference", delta: 2.8 });
    }
    if (chunk.module === "project-cr-so") {
      score += 2.1;
      if (debug) adjustments.push({ reason: "mode_project_module_preference", delta: 2.1 });
    }
  }

  if (chunk.isArchive) {
    score -= 2;
    if (debug) adjustments.push({ reason: "archive_penalty", delta: -2 });
  }
  if (/<\?xml\b/i.test(chunk.text) || /xmlns:/i.test(chunk.text)) {
    score -= 8;
    if (debug) adjustments.push({ reason: "xml_noise_penalty", delta: -8 });
  }
  if ((chunk.text.match(/</g) || []).length >= 8) {
    score -= 4;
    if (debug) adjustments.push({ reason: "markup_density_penalty", delta: -4 });
  }

  return {
    score,
    adjustments: debug ? adjustments : undefined,
  };
}

function dedupeCandidates(candidates: RankedCandidate[]): RankedCandidate[] {
  const seen = new Set<string>();
  const out: RankedCandidate[] = [];
  for (const item of candidates) {
    const key = `${item.chunk.path}::${normalizeSnippetKey(item.chunk.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeSnippetKey(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 180);
}

function chooseAnchorLine(chunk: IndexedChunk, query: string, tokenWeights: QueryWeights): AnchorLine {
  const lines = chunk.text.split(/\r?\n/);
  const queryLower = query.toLowerCase();
  const tokens = [...tokenWeights.keys()];

  let bestOffset = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (!lower.trim()) continue;

    let lineScore = 0;
    if (queryLower.length >= 4 && lower.includes(queryLower)) lineScore += 10;
    for (const token of tokens) {
      if (lower.includes(token)) lineScore += 2;
    }
    if (lineScore > bestScore) {
      bestScore = lineScore;
      bestOffset = i;
    }
  }

  return {
    lineOffset: bestOffset,
    lineNumber: chunk.startLine + bestOffset + 1,
  };
}

function buildChunkContext(chunk: IndexedChunk, anchorLineOffset: number, radius: number): SearchContextRow[] {
  const lines = chunk.text.split(/\r?\n/);
  const start = Math.max(0, anchorLineOffset - radius);
  const end = Math.min(lines.length - 1, anchorLineOffset + radius);
  const out: SearchContextRow[] = [];
  for (let i = start; i <= end; i += 1) {
    out.push({
      lineNumber: chunk.startLine + i + 1,
      text: lines[i],
      isHit: i === anchorLineOffset,
    });
  }
  return out;
}

function buildSnippet(text: string, query: string, tokenWeights: QueryWeights): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const lower = compact.toLowerCase();
  const queryLower = query.toLowerCase();
  if (queryLower.length >= 4) {
    const idx = lower.indexOf(queryLower);
    if (idx >= 0) {
      return trimWindow(compact, idx, queryLower.length, 240);
    }
  }

  for (const token of tokenWeights.keys()) {
    const idx = lower.indexOf(token);
    if (idx >= 0) {
      return trimWindow(compact, idx, token.length, 240);
    }
  }

  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function trimWindow(text: string, index: number, length: number, maxChars: number): string {
  const pivot = index + Math.floor(length / 2);
  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, pivot - half);
  let end = Math.min(text.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }

  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}

function seedFallbackCandidates({ chunks, query, mode, activeChunks, outScores, outMatchedTerms }: FallbackCandidateArgs): void {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return;

  const fallbackTokens = tokenizeQuery(query);
  for (const chunk of chunks) {
    if (!activeChunks(chunk)) continue;
    const textLower = chunk.text.toLowerCase();
    if (!textLower.includes(queryLower)) continue;

    let score = 5;
    for (const token of fallbackTokens) {
      if (textLower.includes(token)) score += 0.8;
    }
    if (mode === "domain" && chunk.track === "domain") score += 1;
    if (mode === "project" && chunk.sourceKind === "project") score += 1.5;

    outScores.set(chunk.id, score);
    outMatchedTerms.set(chunk.id, new Set(fallbackTokens.filter((token) => textLower.includes(token))));
  }
}

function buildWeightedQueryTokens(query: string): QueryWeights {
  const tokens = tokenizeQuery(query);
  const weighted: QueryWeights = new Map();

  for (const token of tokens) {
    weighted.set(token, 1);
  }

  for (const token of tokens) {
    const expansions = QUERY_EXPANSIONS[token] || [];
    for (const expanded of expansions) {
      const expandedTokens = tokenizeQuery(expanded);
      for (const expandedToken of expandedTokens) {
        if (!expandedToken || STOPWORDS.has(expandedToken)) continue;
        weighted.set(expandedToken, Math.max(weighted.get(expandedToken) || 0, 0.58));
      }
    }
  }

  if (query.toLowerCase().includes("sales order")) {
    weighted.set("sales", Math.max(weighted.get("sales") || 0, 0.9));
    weighted.set("order", Math.max(weighted.get("order") || 0, 0.9));
    weighted.set("so", Math.max(weighted.get("so") || 0, 0.85));
  }
  if (query.toLowerCase().includes("change request")) {
    weighted.set("change", Math.max(weighted.get("change") || 0, 0.9));
    weighted.set("request", Math.max(weighted.get("request") || 0, 0.9));
    weighted.set("cr", Math.max(weighted.get("cr") || 0, 0.85));
  }

  return weighted;
}

function chunkDocument(lines: string[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;
  let chunkStartLine = 0;

  const flush = (lineIndex: number): void => {
    const text = buffer.join("\n").trim();
    if (text) {
      chunks.push({
        startLine: chunkStartLine,
        endLine: lineIndex,
        text,
      });
    }

    const overlapLines: string[] = [];
    let overlapChars = 0;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      const candidate = buffer[i];
      const projected = overlapChars + candidate.length + 1;
      if (overlapLines.length && projected > DEFAULT_CHUNK_OVERLAP) break;
      overlapLines.unshift(candidate);
      overlapChars = projected;
      if (overlapChars >= DEFAULT_CHUNK_OVERLAP) break;
    }

    if (overlapLines.length >= buffer.length) {
      overlapLines.splice(0, Math.max(0, overlapLines.length - 1));
      overlapChars = overlapLines.reduce((sum, line) => sum + line.length + 1, 0);
    }

    chunkStartLine = lineIndex - overlapLines.length + 1;
    buffer = overlapLines;
    bufferChars = overlapChars;
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (!buffer.length) chunkStartLine = i;

    const line = lines[i];
    buffer.push(line);
    bufferChars += line.length + 1;

    const boundary = !line.trim();
    if (bufferChars >= DEFAULT_CHUNK_TARGET && (boundary || bufferChars >= DEFAULT_CHUNK_MAX)) {
      flush(i);
    }
  }

  if (buffer.length) flush(lines.length - 1);
  return chunks;
}

function tokenizeForIndex(text: string): string[] {
  return tokenizeCore(text, { keepStopwords: false });
}

function tokenizeQuery(text: string): string[] {
  return tokenizeCore(text, { keepStopwords: false });
}

function tokenizeCore(text: string, { keepStopwords }: { keepStopwords: boolean }): string[] {
  const normalized = normalizeForTokenization(text);
  const raw = normalized
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) continue;
    if (!keepStopwords && STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

function normalizeForTokenization(text: string): string {
  return `${text || ""}`
    .toLowerCase()
    .replace(/\bbrown[\s-]+field\b/g, " brownfield ")
    .replace(/\bgreen[\s-]+field\b/g, " greenfield ")
    .replace(/\bblue[\s-]+field\b/g, " bluefield ")
    .replace(/s\s*\/\s*4\s*h?ana/g, " s4hana ")
    .replace(/s\s*\/\s*4/g, " s4 ")
    .replace(/\bmy\s*inbox\b/g, " myinbox ")
    .replace(/[’']/g, "")
    .replace(/[\u2013\u2014]/g, "-");
}

async function gatherCandidateFiles(repoRoot: string, scanRoots: string[]): Promise<CandidateFile[]> {
  const candidates: CandidateFile[] = [];

  for (const root of scanRoots) {
    const absRoot = path.resolve(repoRoot, root);
    let stat;
    try {
      stat = await fs.stat(absRoot);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      await walk(absRoot, repoRoot, candidates);
      continue;
    }

    const relPath = toPosix(path.relative(repoRoot, absRoot));
    if (!isSearchableTextFile(relPath)) continue;
    candidates.push({
      absPath: absRoot,
      relPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  candidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return candidates;
}

async function walk(dir: string, repoRoot: string, out: CandidateFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = toPosix(path.relative(repoRoot, absPath));

    if (entry.isDirectory()) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "content" ||
        entry.name === ".cache"
      ) {
        continue;
      }
      await walk(absPath, repoRoot, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!isSearchableTextFile(relPath)) continue;

    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      continue;
    }

    out.push({
      absPath,
      relPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

function buildManifestHash(files: CandidateFile[]): string {
  const hash = crypto.createHash("sha1");
  for (const file of files) {
    hash.update(`${file.relPath}:${file.size}:${Math.floor(file.mtimeMs)}\n`);
  }
  return hash.digest("hex");
}

async function tryLoadCachedIndex(cachePath: string): Promise<CachedRetrieverIndex | null> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function trySaveCachedIndex(cachePath: string, index: CachedRetrieverIndex | RetrieverIndex): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(index), "utf8");
  } catch {
    // Cache is an optimization; fail open.
  }
}

function hydrateIndex(payload: CachedRetrieverIndex | RetrieverIndex): RetrieverIndex {
  return {
    version: payload.version,
    createdAt: payload.createdAt,
    manifestHash: payload.manifestHash,
    scanRoots: payload.scanRoots,
    docs: payload.docs || [],
    chunks: payload.chunks || [],
    postings: deserializeMap(payload.postings || []),
    docFreq: deserializeMap(payload.docFreq || []),
    avgChunkLength: Number.isFinite(payload.avgChunkLength) ? payload.avgChunkLength : 0,
  };
}

function serializeMap<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()];
}

function deserializeMap<T>(serialized: Array<[string, T]> | Map<string, T>): Map<string, T> {
  return serialized instanceof Map ? serialized : new Map(serialized);
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: raw };

  const header = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const frontmatter: Record<string, string> = {};

  for (const line of header.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function getDocumentTitle(body: string, relPath: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return path.basename(relPath, path.extname(relPath));
}

function inferSourceKind(relPath: string): string {
  if (relPath.startsWith("source-docs/")) return "reference-source";
  if (relPath.startsWith("kb/topics/")) return "kb-topic";
  if (relPath.startsWith("kb/terms/")) return "kb-term";
  if (relPath.startsWith("kb/modules/")) return "kb-module";
  if (relPath.startsWith("kb/digests/")) return "kb-digest";
  if (relPath.startsWith("kb/clients/")) return "kb-client";
  if (relPath.startsWith("project/")) return "project";
  return "doc";
}

function inferTrack(relPath: string, frontmatter: Frontmatter): string {
  const explicit = normalizeScalar(frontmatter.track);
  if (explicit) return explicit;
  if (relPath.startsWith("source-docs/")) return "domain";
  if (relPath.startsWith("project/")) return "domain";
  if (relPath.startsWith("kb/")) return "domain";
  return "";
}

function inferMode(query: string, explicitMode: string): SearchMode {
  if (explicitMode === "domain" || explicitMode === "project" || explicitMode === "generic") return explicitMode;
  const q = query.toLowerCase();
  if (/\bproject\b|\btask\s*\d+\b|\bcr_so\b|\bflp\b/.test(q)) return "project";
  if (/\brap\b|\babap\b|\bs\/4\b|\bs4\b|\bbtp\b|\badt\b|\beml\b|\bcds\b|\bppf\b/.test(q)) return "domain";
  return "generic";
}

function normalizeScanRoots(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value.map((part) => `${part}`.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return DEFAULT_SCAN_ROOTS;
}

function isSearchableTextFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return true;
  return false;
}

function normalizeScalar(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "string" || typeof value === "number" ? Number.parseInt(`${value}`, 10) : Number.NaN;
  let out = Number.isFinite(raw) ? raw : fallback;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
