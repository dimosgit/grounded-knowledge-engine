export type SearchMode = "auto" | "domain" | "project" | "generic";
export type RetrievalBackend = "bm25" | "sqlite";

export interface Frontmatter {
  [key: string]: string;
}

export interface CandidateFile {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

export interface RetrieverOptions {
  repoRoot?: string;
  scanRoots?: string[] | string;
  cachePath?: string;
  cacheTtlMs?: number | string;
  queryCacheTtlMs?: number | string;
  queryCacheMaxEntries?: number | string;
  forceRefresh?: boolean;
}

export interface ResolvedRetrieverOptions {
  repoRoot: string;
  scanRoots: string[];
  cachePath: string;
  cacheTtlMs: number;
  queryCacheTtlMs: number;
  queryCacheMaxEntries: number;
  forceRefresh: boolean;
  cacheKey: string;
}

export interface SearchArgs {
  query?: string;
  mode?: SearchMode | string;
  limit?: number | string;
  context?: number | string;
  maxPerPath?: number | string;
  track?: string;
  module?: string;
  includeArchive?: boolean;
  disableCache?: boolean;
  debug?: boolean;
  debugTopN?: number | string;
}

export interface IndexedDocument {
  id: number;
  relPath: string;
  title: string;
  track: string;
  module: string;
  sourceKind: string;
  frontmatter: Frontmatter;
  body: string;
  isArchive: boolean;
}

export interface IndexedChunk {
  id: number;
  docId: number;
  path: string;
  title: string;
  track: string;
  module: string;
  sourceKind: string;
  isArchive: boolean;
  startLine: number;
  endLine: number;
  text: string;
  length: number;
}

export interface SearchContextRow {
  lineNumber: number;
  text: string;
  isHit: boolean;
}

export interface SearchHitDebug {
  baseScore?: number;
  rerankAdjustments?: unknown[];
  tokenContributions?: unknown;
  [key: string]: unknown;
}

export interface SearchHit {
  path: string;
  score: number;
  lineNumber: number;
  endLine: number;
  title: string;
  sourceKind: string;
  track: string;
  module: string;
  snippet: string;
  matchedTokens: string[];
  context: SearchContextRow[];
  debug?: SearchHitDebug;
}

export interface EvidenceSignals {
  tokenCoverage: number;
  uniqueSources: number;
  topScore: number;
  dominantSourceShare: number;
}

export interface SearchMetrics {
  latencyMs: number;
  cache: {
    hit: boolean;
    ttlMs: number;
  };
}

export interface SearchDebugQueryToken {
  token: string;
  weight: number;
  expanded: boolean;
}

export interface SearchDebugCandidate {
  path?: string;
  lineNumber?: number;
  title?: string;
  score?: number;
  baseScore?: number;
  matchedTokens?: string[];
  rerankAdjustments?: unknown[];
  [key: string]: unknown;
}

export interface SearchDebug {
  queryTokens?: SearchDebugQueryToken[];
  candidateCountBeforeDedupe?: number;
  candidateCountAfterDedupe?: number;
  topCandidates?: SearchDebugCandidate[];
  [key: string]: unknown;
}

export interface SearchResult {
  query: string;
  mode: string;
  backend?: RetrievalBackend;
  queryTokens: string[];
  filters: {
    track: string | null;
    module: string | null;
    includeArchive: boolean;
  };
  retrieval: {
    maxPerPath: number;
  };
  metrics: SearchMetrics;
  signals: EvidenceSignals;
  hitCount: number;
  hits: SearchHit[];
  debug?: SearchDebug;
}

export interface RetrieverStats {
  backend?: RetrievalBackend;
  documents: number;
  chunks: number;
  terms: number;
  queryCache: {
    ttlMs: number;
    maxEntries: number;
    currentEntries: number;
    hits: number;
    misses: number;
  };
  byTrack: Record<string, number>;
  bySourceKind: Record<string, number>;
}

export interface KbRetriever {
  search(args?: SearchArgs): SearchResult;
  getDocuments(): IndexedDocument[];
  getDocument(pathOrRelPath: string): IndexedDocument | null;
  getStats(): RetrieverStats;
  meta: Record<string, unknown>;
}

export interface RetrieverIndex {
  version: number;
  createdAt: string;
  manifestHash: string;
  scanRoots: string[];
  docs: IndexedDocument[];
  chunks: IndexedChunk[];
  postings: Map<string, Array<[number, number]>>;
  docFreq: Map<string, number>;
  avgChunkLength: number;
}

export interface CachedRetrieverIndex extends Omit<RetrieverIndex, "postings" | "docFreq"> {
  postings: Array<[string, Array<[number, number]>]>;
  docFreq: Array<[string, number]>;
}
