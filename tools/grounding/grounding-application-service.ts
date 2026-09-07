import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerGrounded,
  type GroundedAnswerInput,
  type GroundedAnswerResult,
} from "./answer-service.js";
import { loadDocumentSnapshot, normalizeScanRoots } from "./document-core.js";
import { getKbRetriever, DEFAULT_SCAN_ROOTS } from "./retriever.js";
import type {
  DocumentSnapshot,
  IndexedDocument,
  KbRetriever,
  RetrievalBackend,
  RetrieverOptions,
  RetrieverStats,
  SearchArgs,
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
      scanRoots: cloneScanRoots(workspace ? [...workspace.scanRoots] : options.scanRoots),
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
        return {
          ...retriever.search({
            ...searchArgs,
            ...(allowedPaths ? { allowedPaths: [...allowedPaths] } : {}),
          }),
          backend,
        };
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

  /** Rebuild both backends from the same document bytes with one filesystem read pass. */
  async refreshAll(): Promise<Record<RetrievalBackend, RetrieverStats>> {
    const snapshot = await loadDocumentSnapshot(
      this.context.repoRoot!,
      normalizeScanRoots(this.context.scanRoots || DEFAULT_SCAN_ROOTS, DEFAULT_SCAN_ROOTS),
      this.context.workspace,
      this.context.workspace?.domain,
    );
    const bm25 = await this.getRetriever("bm25", true, snapshot);
    const sqlite = await this.getRetriever("sqlite", true, snapshot);
    return {
      bm25: { ...bm25.getStats(), backend: "bm25" },
      sqlite: { ...sqlite.getStats(), backend: "sqlite" },
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
    snapshot?: DocumentSnapshot,
  ): Promise<KbRetriever> {
    const options = {
      ...this.context,
      snapshot,
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
