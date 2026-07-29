import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerGrounded,
  type GroundedAnswerInput,
  type GroundedAnswerResult,
} from "./answer-service.js";
import { getKbRetriever } from "./retriever.js";
import type {
  IndexedDocument,
  KbRetriever,
  RetrievalBackend,
  RetrieverOptions,
  RetrieverStats,
  SearchArgs,
  SearchHit,
  SearchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type GroundingSearchInput = SearchArgs & { backend?: unknown };

export interface GroundingApplicationServiceOptions extends Omit<RetrieverOptions, "forceRefresh"> {
  backend?: unknown;
}

export interface GroundingAnswerOptions {
  allowedPaths?: Iterable<string>;
  now?: () => number;
}

export interface GroundingDocumentOptions {
  backend?: unknown;
  forceRefresh?: boolean;
}

export class GroundingApplicationService {
  private readonly context: Omit<RetrieverOptions, "forceRefresh">;
  private readonly defaultBackend: RetrievalBackend;

  constructor(options: GroundingApplicationServiceOptions = {}) {
    const workspace = options.workspace;
    this.context = {
      repoRoot: workspace
        ? workspace.realRepoRoot
        : path.resolve(options.repoRoot || path.join(__dirname, "..", "..")),
      scanRoots: cloneScanRoots(
        options.scanRoots ?? (workspace ? [...workspace.scanRoots] : undefined),
      ),
      cachePath: options.cachePath,
      cacheTtlMs: options.cacheTtlMs,
      queryCacheTtlMs: options.queryCacheTtlMs,
      queryCacheMaxEntries: options.queryCacheMaxEntries,
      workspace,
    };
    this.defaultBackend = normalizeRetrievalBackend(options.backend);
  }

  async search(input: GroundingSearchInput): Promise<SearchResult> {
    const backend = this.resolveBackend(input.backend);
    const retriever = await this.getRetriever(backend);
    const { backend: _backend, ...searchArgs } = input;
    return { ...retriever.search(searchArgs), backend };
  }

  async answer(
    input: GroundedAnswerInput,
    options: GroundingAnswerOptions = {},
  ): Promise<GroundedAnswerResult> {
    const backend = this.resolveBackend(input.backend);
    const retriever = await this.getRetriever(backend);
    const allowedPaths = options.allowedPaths ? new Set(options.allowedPaths) : null;
    const documents = allowedPaths
      ? retriever.getDocuments().filter((document) => allowedPaths.has(document.relPath))
      : retriever.getDocuments();

    return answerGrounded(input, {
      search: async (args) => {
        const { backend: _backend, ...searchArgs } = args;
        const result = {
          ...retriever.search(
            allowedPaths ? { ...searchArgs, limit: 30, disableCache: true } : searchArgs,
          ),
          backend,
        };
        return allowedPaths
          ? scopeSearchResult(result, allowedPaths, Number(searchArgs.limit) || 8)
          : result;
      },
      listDocuments: async () => documents,
      domain: this.context.workspace?.domain,
      now: options.now,
    });
  }

  async listDocuments(options: GroundingDocumentOptions = {}): Promise<IndexedDocument[]> {
    const retriever = await this.getRetriever(
      this.resolveBackend(options.backend),
      options.forceRefresh,
    );
    return [...retriever.getDocuments()];
  }

  async refresh(backend?: unknown): Promise<RetrieverStats> {
    const resolvedBackend = this.resolveBackend(backend);
    return {
      ...(await this.getRetriever(resolvedBackend, true)).getStats(),
      backend: resolvedBackend,
    };
  }

  private resolveBackend(value: unknown): RetrievalBackend {
    return value === undefined || value === null || value === ""
      ? this.defaultBackend
      : normalizeRetrievalBackend(value);
  }

  private async getRetriever(
    backend: RetrievalBackend,
    forceRefresh = false,
  ): Promise<KbRetriever> {
    const options = {
      ...this.context,
      scanRoots: cloneScanRoots(this.context.scanRoots),
      forceRefresh,
    };
    if (backend === "sqlite") {
      const { getSqliteKbRetriever } = await import("./sqlite-index.js");
      return getSqliteKbRetriever(options);
    }
    return getKbRetriever(options);
  }
}

export function createGroundingApplicationService(
  options: GroundingApplicationServiceOptions = {},
): GroundingApplicationService {
  return new GroundingApplicationService(options);
}

export function normalizeRetrievalBackend(value: unknown): RetrievalBackend {
  return `${value || ""}`.trim().toLowerCase() === "sqlite" ? "sqlite" : "bm25";
}

function cloneScanRoots(scanRoots: RetrieverOptions["scanRoots"]): RetrieverOptions["scanRoots"] {
  return Array.isArray(scanRoots) ? [...scanRoots] : scanRoots;
}

function scopeSearchResult(
  result: SearchResult,
  allowedPaths: ReadonlySet<string>,
  limit: number,
): SearchResult {
  const hits = result.hits.filter((hit) => allowedPaths.has(hit.path)).slice(0, limit);
  return {
    ...result,
    hitCount: hits.length,
    hits,
    signals: buildEvidenceSignals(hits, result.queryTokens),
  };
}

function buildEvidenceSignals(hits: SearchHit[], queryTokens: string[]) {
  const topHits = hits.slice(0, 5);
  const coveredTokens = new Set<string>();
  const sourceCounts = new Map<string, number>();
  for (const hit of topHits) {
    for (const token of hit.matchedTokens || []) coveredTokens.add(token);
    sourceCounts.set(hit.path, (sourceCounts.get(hit.path) || 0) + 1);
  }
  const dominantSourceShare = topHits.length
    ? Math.max(...sourceCounts.values()) / topHits.length
    : 0;
  return {
    topScore: roundSignal(topHits[0]?.score || 0),
    uniqueSources: sourceCounts.size,
    tokenCoverage: roundSignal(queryTokens.length ? coveredTokens.size / queryTokens.length : 0),
    dominantSourceShare: roundSignal(dominantSourceShare),
  };
}

function roundSignal(value: number): number {
  return Number(value.toFixed(3));
}
