import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  authorizeWorkspaceRead,
  authorizeWorkspaceRuntimePath,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import {
  DEFAULT_DOMAIN_PROFILE,
  applyDomainScoringRules,
  domainFingerprint,
  resolveModeAlias,
} from "../workspaces/domain-profile.js";
import type { DomainProfile, WorkspaceContext } from "../workspaces/types.js";
import { DEFAULT_SCAN_ROOTS } from "./retriever.js";
import {
  buildManifestHash,
  gatherCandidateFiles,
  getDocumentTitle,
  inferSourceKind,
  inferTrack,
  normalizeScalar,
  normalizeScanRoots,
  parseFrontmatter,
  parsePositiveInt,
} from "./document-core.js";
import type {
  CandidateFile,
  IndexedDocument,
  KbRetriever,
  ResolvedRetrieverOptions,
  RetrieverOptions,
  SearchArgs,
  SearchContextRow,
  SearchHit,
  SearchMode,
  SearchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_VERSION = 1;
const DEFAULT_SQLITE_INDEX_FILE = ".cache/kb-retriever.sqlite";
const DEFAULT_QUERY_CACHE_TTL_MS = 45000;
const DEFAULT_QUERY_CACHE_MAX_ENTRIES = 240;

const DEFAULT_CHUNK_TARGET = 560;
const DEFAULT_CHUNK_MAX = 920;
const DEFAULT_CHUNK_OVERLAP = 140;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
const MAX_CONTEXT = 3;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
  "after",
  "before",
  "during",
  "about",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "did",
  "done",
  "than",
  "over",
  "under",
  "through",
  "up",
  "down",
  "across",
  "within",
  "without",
  "using",
  "use",
  "used",
  "via",
  "only",
  "also",
  "more",
  "most",
  "less",
  "least",
  "very",
  "much",
  "many",
  "few",
  "some",
  "any",
]);

let runtimeCache = {
  cacheKey: "",
  retriever: null as KbRetriever | null,
};

type QueryWeights = Map<string, number>;

interface ChunkDraft {
  startLine: number;
  endLine: number;
  text: string;
}

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

interface SqliteChunkRow {
  id: number;
  path: string;
  title: string;
  sourceKind: string;
  module: string;
  track: string;
  startLine: number;
  endLine: number;
  text: string;
  tokenCount: number;
  isArchive: number;
  rank: number;
}

interface RankedSqliteRow extends SqliteChunkRow {
  score: number;
  baseScore: number;
  matchedTerms: string[];
  rerankAdjustments?: RerankAdjustment[];
}

interface RerankAdjustment {
  reason: string;
  delta: number;
}

interface RunFtsArgs {
  ftsQuery?: string;
  query: string;
  mode: string;
  track: string;
  module: string;
  includeArchive: boolean;
  windowSize: number;
}

interface RerankRowArgs {
  row: SqliteChunkRow;
  query: string;
  mode: string;
  tokenWeights: QueryWeights;
  debug: boolean;
  domain: DomainProfile;
}

interface AnchorLine {
  lineOffset: number;
  lineNumber: number;
}

export async function getSqliteKbRetriever(options: RetrieverOptions = {}): Promise<KbRetriever> {
  const resolved = resolveOptions(options);
  if (
    !resolved.forceRefresh &&
    runtimeCache.retriever &&
    runtimeCache.cacheKey === resolved.cacheKey
  ) {
    return runtimeCache.retriever;
  }

  const db = await loadOrBuildDatabase(resolved);
  const retriever = createSqliteRetriever(db, resolved);
  runtimeCache = {
    cacheKey: resolved.cacheKey,
    retriever,
  };
  return retriever;
}

function resolveOptions(options: RetrieverOptions): ResolvedRetrieverOptions {
  const workspace = options.workspace;
  const repoRoot = workspace
    ? workspace.realRepoRoot
    : path.resolve(
        options.repoRoot || process.env.KB_MCP_REPO_ROOT || path.join(__dirname, "..", ".."),
      );
  const scanRoots = workspace
    ? [...workspace.scanRoots]
    : normalizeScanRoots(
        options.scanRoots || process.env.KB_MCP_SCAN_ROOTS || DEFAULT_SCAN_ROOTS,
        DEFAULT_SCAN_ROOTS,
      );
  const cachePath = path.resolve(
    repoRoot,
    options.cachePath || process.env.KB_MCP_SQLITE_PATH || DEFAULT_SQLITE_INDEX_FILE,
  );
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
  const domain = workspace?.domain ?? DEFAULT_DOMAIN_PROFILE;
  const cacheKey = `${repoRoot}::${scanRoots.join(",")}::${cachePath}::${domainFingerprint(domain)}`;
  return {
    workspace,
    domain,
    repoRoot,
    scanRoots,
    cachePath,
    cacheTtlMs: 0,
    queryCacheTtlMs,
    queryCacheMaxEntries,
    forceRefresh,
    cacheKey,
  };
}

async function loadOrBuildDatabase(options: ResolvedRetrieverOptions): Promise<DatabaseSync> {
  const files = await gatherCandidateFiles(options.repoRoot, options.scanRoots, options.workspace);
  const manifestHash = `${buildManifestHash(files)}::${domainFingerprint(options.domain)}`;
  if (options.workspace) {
    await authorizeWorkspaceRuntimePath(options.workspace, options.cachePath);
  }
  if (!options.workspace?.readOnly) {
    if (options.workspace) await authorizeWorkspaceWrite(options.workspace, options.cachePath);
    await fs.mkdir(path.dirname(options.cachePath), { recursive: true });
  }

  const db = new DatabaseSync(options.workspace?.readOnly ? ":memory:" : options.cachePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  const valid =
    !options.workspace?.readOnly && !options.forceRefresh && isDatabaseCurrent(db, manifestHash);
  if (!valid) {
    await rebuildDatabase(db, {
      repoRoot: options.repoRoot,
      workspace: options.workspace,
      domain: options.domain,
      files,
      manifestHash,
      scanRoots: options.scanRoots,
    });
  }

  return db;
}

function isDatabaseCurrent(db: DatabaseSync, manifestHash: string): boolean {
  try {
    const version = db
      .prepare("SELECT value FROM metadata WHERE key = 'index_version'")
      .get()?.value;
    const storedHash = db
      .prepare("SELECT value FROM metadata WHERE key = 'manifest_hash'")
      .get()?.value;
    return Number(version) === INDEX_VERSION && storedHash === manifestHash;
  } catch {
    return false;
  }
}

async function rebuildDatabase(
  db: DatabaseSync,
  {
    files,
    manifestHash,
    scanRoots,
    workspace,
    domain,
  }: {
    repoRoot: string;
    workspace?: WorkspaceContext;
    domain: DomainProfile;
    files: CandidateFile[];
    manifestHash: string;
    scanRoots: string[];
  },
): Promise<void> {
  db.exec(`
    DROP TABLE IF EXISTS metadata;
    DROP TABLE IF EXISTS aliases;
    DROP TABLE IF EXISTS terms;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS query_log;
    DROP TABLE IF EXISTS embeddings;
    DROP TABLE IF EXISTS fts_chunks;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      module TEXT,
      track TEXT,
      status TEXT,
      type TEXT,
      updated TEXT,
      mtime_ms REAL NOT NULL,
      size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      is_archive INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      module TEXT,
      track TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      is_archive INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE terms (
      normalized_term TEXT PRIMARY KEY,
      display_title TEXT NOT NULL,
      path TEXT NOT NULL,
      short_answer TEXT
    );

    CREATE TABLE aliases (
      alias TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_path TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      provider TEXT,
      model TEXT,
      vector_json TEXT
    );

    CREATE TABLE query_log (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      backend TEXT NOT NULL,
      latency_ms REAL NOT NULL,
      hit_count INTEGER NOT NULL,
      mode TEXT,
      track TEXT,
      module TEXT
    );

    CREATE VIRTUAL TABLE fts_chunks USING fts5(
      text,
      title,
      path,
      content='chunks',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE INDEX idx_documents_path ON documents(path);
    CREATE INDEX idx_documents_module_track ON documents(module, track);
    CREATE INDEX idx_chunks_path ON chunks(path);
    CREATE INDEX idx_chunks_module_track ON chunks(module, track);
  `);

  const insertDocument = db.prepare(`
    INSERT INTO documents
      (id, path, title, source_kind, module, track, status, type, updated, mtime_ms, size, content_hash, is_archive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks
      (id, document_id, chunk_index, path, title, source_kind, module, track, start_line, end_line, text, token_count, is_archive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(
    "INSERT INTO fts_chunks(rowid, text, title, path) VALUES (?, ?, ?, ?)",
  );
  const insertTerm = db.prepare(`
    INSERT OR REPLACE INTO terms (normalized_term, display_title, path, short_answer)
    VALUES (?, ?, ?, ?)
  `);
  const insertAlias = db.prepare(`
    INSERT OR REPLACE INTO aliases (alias, target_kind, target_path, confidence)
    VALUES (?, ?, ?, ?)
  `);
  const setMeta = db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)");

  db.exec("BEGIN IMMEDIATE;");
  try {
    let docId = 0;
    let chunkId = 0;
    for (const file of files) {
      let raw;
      try {
        if (workspace) await authorizeWorkspaceRead(workspace, file.absPath);
        raw = await fs.readFile(file.absPath, "utf8");
      } catch {
        continue;
      }

      const isMarkdown = file.relPath.endsWith(".md");
      const parsed = isMarkdown
        ? parseFrontmatter(raw)
        : { frontmatter: {} as Record<string, string>, body: raw };
      const body = parsed.body || "";
      if (!body.trim()) continue;

      const frontmatter = parsed.frontmatter || {};
      const title = getDocumentTitle(body, file.relPath);
      const sourceKind = inferSourceKind(file.relPath, domain);
      const track = inferTrack(file.relPath, frontmatter, domain);
      const module = normalizeScalar(frontmatter.module);
      const status = normalizeScalar(frontmatter.status);
      const type = normalizeScalar(frontmatter.type);
      const updated = normalizeScalar(frontmatter.updated);
      const contentHash = crypto.createHash("sha1").update(raw).digest("hex");
      const isArchive = file.relPath.startsWith("kb/archive/") ? 1 : 0;

      insertDocument.run(
        docId,
        file.relPath,
        title,
        sourceKind,
        module,
        track,
        status,
        type,
        updated,
        file.mtimeMs,
        file.size,
        contentHash,
        isArchive,
      );

      if (sourceKind === "kb-term") {
        const normalizedTerm = normalizeTermKey(path.basename(file.relPath, ".md"));
        if (normalizedTerm) {
          insertTerm.run(normalizedTerm, title, file.relPath, extractFastTermSummary(body));
          insertAlias.run(normalizedTerm, "term", file.relPath, 1);
          insertAlias.run(normalizeTermKey(title), "term", file.relPath, 1);
        }
      } else if (sourceKind === "kb-topic") {
        insertAlias.run(
          normalizeAliasKey(path.basename(file.relPath, ".md")),
          "topic",
          file.relPath,
          0.96,
        );
        insertAlias.run(normalizeAliasKey(title), "topic", file.relPath, 0.96);
      }

      const pieces = chunkDocument(body.split(/\r?\n/));
      let chunkIndex = 0;
      for (const piece of pieces) {
        const tokens = tokenizeQuery(piece.text, domain);
        if (!tokens.length) continue;
        insertChunk.run(
          chunkId,
          docId,
          chunkIndex,
          file.relPath,
          title,
          sourceKind,
          module,
          track,
          piece.startLine,
          piece.endLine,
          piece.text,
          tokens.length,
          isArchive,
        );
        insertFts.run(chunkId, piece.text, title, file.relPath);
        chunkId += 1;
        chunkIndex += 1;
      }

      docId += 1;
    }

    setMeta.run("index_version", String(INDEX_VERSION));
    setMeta.run("manifest_hash", manifestHash);
    setMeta.run("scan_roots", scanRoots.join(","));
    setMeta.run("built_at", new Date().toISOString());
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function createSqliteRetriever(db: DatabaseSync, options: ResolvedRetrieverOptions): KbRetriever {
  const queryCache = new Map<string, { createdAt: number; value: SearchResult }>();
  let queryCacheHits = 0;
  let queryCacheMisses = 0;

  function search(args: SearchArgs = {}): SearchResult {
    const startedAt = Date.now();
    const query = normalizeScalar(args.query);
    if (!query) throw new Error("Missing required argument: query");

    const mode = inferMode(query, normalizeScalar(args.mode) || "auto", options.domain);
    const limit = parsePositiveInt(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const contextRadius = parsePositiveInt(args.context, 1, 0, MAX_CONTEXT);
    const maxPerPath = parsePositiveInt(
      args.maxPerPath,
      Math.max(2, Math.ceil(limit / 2)),
      1,
      limit,
    );
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
          cache: { hit: true, ttlMs: options.queryCacheTtlMs },
        };
        return cachedResult;
      }
      if (cached) queryCache.delete(cacheKey);
      queryCacheMisses += 1;
    }

    const tokenWeights = buildWeightedQueryTokens(query, options.domain);
    const ftsQuery = buildFtsQuery([...tokenWeights.keys()]);
    const sqlRows = runFtsQuery(db, {
      ftsQuery,
      query,
      mode,
      track,
      module,
      includeArchive,
      windowSize: Math.max(limit * 14, 90),
    });

    const ranked: RankedSqliteRow[] = sqlRows
      .map((row: SqliteChunkRow) =>
        rerankRow({ row, query, mode, tokenWeights, debug, domain: options.domain }),
      )
      .sort(
        (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine,
      );

    const hits: SearchHit[] = [];
    const seenHitKeys = new Set<string>();
    const pathHitCounts = new Map<string, number>();
    for (const item of ranked) {
      const pathCount = pathHitCounts.get(item.path) || 0;
      if (pathCount >= maxPerPath) continue;

      const anchor = chooseAnchorLine(item, query, tokenWeights);
      const hitKey = `${item.path}:${anchor.lineNumber}`;
      if (seenHitKeys.has(hitKey)) continue;
      seenHitKeys.add(hitKey);
      pathHitCounts.set(item.path, pathCount + 1);

      const hit: SearchHit = {
        path: item.path,
        score: Number(item.score.toFixed(2)),
        lineNumber: anchor.lineNumber,
        endLine: item.endLine + 1,
        title: item.title,
        sourceKind: item.sourceKind,
        track: item.track,
        module: item.module,
        snippet: buildSnippet(item.text, query, tokenWeights),
        matchedTokens: item.matchedTerms,
        context: buildChunkContext(item, anchor.lineOffset, contextRadius),
      };
      if (debug) {
        hit.debug = {
          baseScore: round(item.baseScore),
          rerankAdjustments: item.rerankAdjustments || [],
        };
      }
      hits.push(hit);
      if (hits.length >= limit) break;
    }

    const queryTokenList = [...tokenWeights.keys()];
    const result: SearchResult = {
      query,
      mode,
      backend: "sqlite" as const,
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
        cache: { hit: false, ttlMs: options.queryCacheTtlMs },
      },
      signals: buildEvidenceSignals(hits, queryTokenList),
      hitCount: hits.length,
      hits,
    };
    if (debug) {
      result.debug = {
        queryTokens: [...tokenWeights.entries()].map(([token, weight]) => ({
          token,
          weight: round(weight),
          expanded: weight < 1,
        })),
        topCandidates: ranked.slice(0, debugTopN).map((item: RankedSqliteRow) => ({
          path: item.path,
          lineNumber: chooseAnchorLine(item, query, tokenWeights).lineNumber,
          title: item.title,
          score: round(item.score),
          baseScore: round(item.baseScore),
          matchedTokens: item.matchedTerms,
          rerankAdjustments: item.rerankAdjustments || [],
        })),
      };
    }

    if (shouldUseCache) {
      queryCache.set(cacheKey, { createdAt: Date.now(), value: cloneSearchResult(result) });
      trimQueryCache(queryCache, options.queryCacheMaxEntries);
    }

    return result;
  }

  function getDocuments(): IndexedDocument[] {
    return db
      .prepare(
        `
      SELECT
        id,
        path AS relPath,
        title,
        track,
        module,
        source_kind AS sourceKind,
        status,
        type,
        updated,
        is_archive AS isArchive
      FROM documents
      ORDER BY path
    `,
      )
      .all()
      .map((row) => ({
        id: Number(row.id || 0),
        relPath: `${row.relPath || ""}`,
        title: `${row.title || ""}`,
        track: `${row.track || ""}`,
        module: `${row.module || ""}`,
        sourceKind: `${row.sourceKind || ""}`,
        frontmatter: {},
        body: "",
        isArchive: Boolean(row.isArchive),
      }));
  }

  function getStats() {
    const docs = Number(db.prepare("SELECT COUNT(*) AS count FROM documents").get()?.count || 0);
    const chunks = Number(db.prepare("SELECT COUNT(*) AS count FROM chunks").get()?.count || 0);
    const terms = Number(db.prepare("SELECT COUNT(*) AS count FROM terms").get()?.count || 0);
    return {
      backend: "sqlite" as const,
      documents: docs,
      chunks,
      terms,
      queryCache: {
        ttlMs: options.queryCacheTtlMs,
        maxEntries: options.queryCacheMaxEntries,
        currentEntries: queryCache.size,
        hits: queryCacheHits,
        misses: queryCacheMisses,
      },
      byTrack: countBy(db, "track"),
      bySourceKind: countBy(db, "source_kind"),
    };
  }

  function getDocument(pathOrRelPath: string): IndexedDocument | null {
    const row = db.prepare("SELECT * FROM documents WHERE path = ?").get(pathOrRelPath);
    if (!row) return null;
    return {
      id: Number(row.id || 0),
      relPath: `${row.path || ""}`,
      title: `${row.title || ""}`,
      track: `${row.track || ""}`,
      module: `${row.module || ""}`,
      sourceKind: `${row.source_kind || ""}`,
      frontmatter: {},
      body: "",
      isArchive: Boolean(row.is_archive),
    };
  }

  return {
    search,
    getDocuments,
    getDocument,
    getStats,
    meta: {
      backend: "sqlite",
      scanRoots: options.scanRoots,
      repoRoot: options.repoRoot,
      cachePath: options.cachePath,
    },
  };
}

function runFtsQuery(
  db: DatabaseSync,
  { ftsQuery, query, mode, track, module, includeArchive, windowSize }: RunFtsArgs,
): SqliteChunkRow[] {
  const rows: SqliteChunkRow[] = [];
  if (ftsQuery) {
    const filters: string[] = [];
    const params: string[] = [ftsQuery];
    if (!includeArchive) filters.push("c.is_archive = 0");
    if (track) {
      filters.push("c.track = ?");
      params.push(track);
    }
    if (module) {
      filters.push("c.module = ?");
      params.push(module);
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
    rows.push(
      ...(db
        .prepare(
          `
      SELECT
        c.id,
        c.path,
        c.title,
        c.source_kind AS sourceKind,
        c.module,
        c.track,
        c.start_line AS startLine,
        c.end_line AS endLine,
        c.text,
        c.token_count AS tokenCount,
        c.is_archive AS isArchive,
        bm25(fts_chunks) AS rank
      FROM fts_chunks
      JOIN chunks c ON c.id = fts_chunks.rowid
      WHERE fts_chunks MATCH ? ${where}
      ORDER BY rank
      LIMIT ${Math.max(1, Math.min(500, windowSize))}
    `,
        )
        .all(...params) as unknown as SqliteChunkRow[]),
    );
  }

  if (rows.length) return rows;
  return seedFallbackRows(db, { query, mode, track, module, includeArchive, windowSize });
}

function seedFallbackRows(
  db: DatabaseSync,
  { query, mode, track, module, includeArchive, windowSize }: RunFtsArgs,
): SqliteChunkRow[] {
  const filters = ["LOWER(c.text) LIKE ?"];
  const params = [`%${query.toLowerCase()}%`];
  if (!includeArchive) filters.push("c.is_archive = 0");
  if (track) {
    filters.push("c.track = ?");
    params.push(track);
  }
  if (module) {
    filters.push("c.module = ?");
    params.push(module);
  }
  const rows = db
    .prepare(
      `
    SELECT
      c.id,
      c.path,
      c.title,
      c.source_kind AS sourceKind,
      c.module,
      c.track,
      c.start_line AS startLine,
      c.end_line AS endLine,
      c.text,
      c.token_count AS tokenCount,
      c.is_archive AS isArchive,
      0 AS rank
    FROM chunks c
    WHERE ${filters.join(" AND ")}
    LIMIT ${Math.max(1, Math.min(500, windowSize))}
  `,
    )
    .all(...params) as unknown as SqliteChunkRow[];
  return rows.map((row: SqliteChunkRow) => ({
    ...row,
    rank: mode === "project" && row.sourceKind === "project" ? -5 : row.rank,
  }));
}

function rerankRow({
  row,
  query,
  mode,
  tokenWeights,
  debug,
  domain,
}: RerankRowArgs): RankedSqliteRow {
  const textLower = `${row.text || ""}`.toLowerCase();
  const pathLower = `${row.path || ""}`.toLowerCase();
  const titleLower = `${row.title || ""}`.toLowerCase();
  const queryLower = query.toLowerCase();
  const matchedTerms: string[] = [];
  let score = Math.max(0, -Number(row.rank || 0) * 100);
  const baseScore = score;
  const adjustments: RerankAdjustment[] = [];

  if (queryLower.length >= 5 && textLower.includes(queryLower)) {
    score += 5;
    if (debug) adjustments.push({ reason: "exact_query_match", delta: 5 });
  }

  for (const [token, weight] of tokenWeights.entries()) {
    let matched = false;
    if (textLower.includes(token)) {
      score += 0.9 * weight;
      matched = true;
    }
    if (pathLower.includes(token)) {
      score += 0.35 * weight;
      matched = true;
      if (debug) adjustments.push({ reason: `path_token:${token}`, delta: round(0.35 * weight) });
    }
    if (titleLower.includes(token)) {
      score += 0.55 * weight;
      matched = true;
      if (debug) adjustments.push({ reason: `title_token:${token}`, delta: round(0.55 * weight) });
    }
    if (matched) matchedTerms.push(token);
  }

  const tokenMatchBoost = Math.min(3.2, matchedTerms.length * 0.45);
  score += tokenMatchBoost;
  if (debug && tokenMatchBoost)
    adjustments.push({ reason: "matched_token_count", delta: round(tokenMatchBoost) });

  if (mode === "domain") {
    if (row.sourceKind === "reference-source") {
      score += 2.4;
      if (debug) adjustments.push({ reason: "mode_domain_source_preference", delta: 2.4 });
    }
    if (row.track === domain.defaultTrack) {
      score += 1.1;
      if (debug) adjustments.push({ reason: "mode_domain_track_preference", delta: 1.1 });
    }
    if (row.sourceKind === "project" && !domain.projectQueryPattern.test(query)) {
      score -= 420;
      if (debug) adjustments.push({ reason: "mode_domain_project_penalty", delta: -420 });
    }
  } else if (mode === "project") {
    if (row.sourceKind === "project") {
      score += 2.8;
      if (debug) adjustments.push({ reason: "mode_project_source_preference", delta: 2.8 });
    }
  }

  for (const rule of applyDomainScoringRules(domain, {
    backend: "sqlite",
    mode,
    query,
    sourceKind: normalizeScalar(row.sourceKind),
    module: normalizeScalar(row.module),
    track: normalizeScalar(row.track),
  })) {
    score += rule.boost;
    if (debug) adjustments.push({ reason: rule.id, delta: rule.boost });
  }

  if (row.isArchive) {
    score -= 2;
    if (debug) adjustments.push({ reason: "archive_penalty", delta: -2 });
  }
  if (/<\?xml\b/i.test(row.text) || /xmlns:/i.test(row.text)) {
    score -= 8;
    if (debug) adjustments.push({ reason: "xml_noise_penalty", delta: -8 });
  }
  if ((row.text.match(/</g) || []).length >= 8) {
    score -= 4;
    if (debug) adjustments.push({ reason: "markup_density_penalty", delta: -4 });
  }

  return {
    ...row,
    score,
    baseScore,
    matchedTerms: [...new Set(matchedTerms)],
    rerankAdjustments: debug ? adjustments : undefined,
  };
}

function countBy(db: DatabaseSync, column: string): Record<string, number> {
  const out: Record<string, number> = {};
  const safeColumn = column === "source_kind" ? "source_kind" : "track";
  for (const row of db
    .prepare(
      `SELECT COALESCE(${safeColumn}, '(none)') AS key, COUNT(*) AS count FROM chunks GROUP BY key`,
    )
    .all()) {
    const typedRow = row as { key: string; count: number };
    out[typedRow.key] = typedRow.count;
  }
  return out;
}

function buildFtsQuery(tokens: string[]): string {
  const cleaned = tokens
    .map((token) => token.replace(/"/g, ""))
    .filter((token) => /^[a-z0-9_/-]{2,}$/i.test(token))
    .slice(0, 16);
  if (!cleaned.length) return "";
  return cleaned.map((token) => `"${token}"`).join(" OR ");
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
  for (const hit of hits) counts.set(hit.path, (counts.get(hit.path) || 0) + 1);
  return [...counts.values()].map((count) => count / hits.length);
}

function chooseAnchorLine(
  chunk: SqliteChunkRow | RankedSqliteRow,
  query: string,
  tokenWeights: QueryWeights,
): AnchorLine {
  const lines = `${chunk.text || ""}`.split(/\r?\n/);
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
    lineNumber: Number(chunk.startLine || 0) + bestOffset + 1,
  };
}

function buildChunkContext(
  chunk: SqliteChunkRow | RankedSqliteRow,
  anchorLineOffset: number,
  radius: number,
): SearchContextRow[] {
  const lines = `${chunk.text || ""}`.split(/\r?\n/);
  const start = Math.max(0, anchorLineOffset - radius);
  const end = Math.min(lines.length - 1, anchorLineOffset + radius);
  const out: SearchContextRow[] = [];
  for (let i = start; i <= end; i += 1) {
    out.push({
      lineNumber: Number(chunk.startLine || 0) + i + 1,
      text: lines[i],
      isHit: i === anchorLineOffset,
    });
  }
  return out;
}

function buildSnippet(text: string, query: string, tokenWeights: QueryWeights): string {
  const compact = `${text || ""}`.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const queryLower = query.toLowerCase();
  if (queryLower.length >= 4) {
    const idx = lower.indexOf(queryLower);
    if (idx >= 0) return trimWindow(compact, idx, queryLower.length, 240);
  }
  for (const token of tokenWeights.keys()) {
    const idx = lower.indexOf(token);
    if (idx >= 0) return trimWindow(compact, idx, token.length, 240);
  }
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function trimWindow(text: string, index: number, length: number, maxChars: number): string {
  const pivot = index + Math.floor(length / 2);
  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, pivot - half);
  const end = Math.min(text.length, start + maxChars);
  if (end - start < maxChars) start = Math.max(0, end - maxChars);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}

function buildWeightedQueryTokens(query: string, domain: DomainProfile): QueryWeights {
  const tokens = tokenizeQuery(query, domain);
  const weighted: QueryWeights = new Map();
  for (const token of tokens) weighted.set(token, 1);
  for (const token of tokens) {
    const expansions = domain.queryExpansions[token] || [];
    for (const expanded of expansions) {
      for (const expandedToken of tokenizeQuery(expanded, domain)) {
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
      chunks.push({ startLine: chunkStartLine, endLine: lineIndex, text });
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

function tokenizeQuery(text: string, domain: DomainProfile): string[] {
  const normalized = normalizeForTokenization(text, domain);
  const raw = normalized
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

function normalizeForTokenization(text: string, domain: DomainProfile): string {
  let normalized = `${text || ""}`
    .toLowerCase()
    .replace(/\bbrown[\s-]+field\b/g, " brownfield ")
    .replace(/\bgreen[\s-]+field\b/g, " greenfield ")
    .replace(/[’']/g, "")
    .replace(/[\u2013\u2014]/g, "-");
  for (const rule of domain.textNormalizations) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }
  return normalized;
}

function extractFastTermSummary(body: string): string {
  const lines = `${body || ""}`.split(/\r?\n/);
  const minuteIndex = lines.findIndex((line) => /^##\s+1-minute explanation\b/i.test(line));
  if (minuteIndex >= 0) {
    const bullets: string[] = [];
    for (let i = minuteIndex + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i])) break;
      const match = lines[i].match(/^\s*-\s+(.*)$/);
      if (!match) continue;
      bullets.push(singleLine(match[1]));
      if (bullets.length >= 2) break;
    }
    if (bullets.length) return bullets.join(" ");
  }
  const definitionIndex = lines.findIndex((line) => /^##\s+Definition\b/i.test(line));
  if (definitionIndex >= 0) {
    for (let i = definitionIndex + 1; i < lines.length; i += 1) {
      const line = singleLine(lines[i]);
      if (!line) continue;
      if (/^##\s+/.test(line)) break;
      return line;
    }
  }
  return "";
}

function inferMode(query: string, explicitMode: string, domain: DomainProfile): SearchMode {
  const resolved = resolveModeAlias(domain, explicitMode);
  if (resolved === "domain" || resolved === "project" || resolved === "generic") return resolved;
  const q = query.toLowerCase();
  if (domain.inferModeProject.some((pattern) => pattern.test(q))) return "project";
  if (domain.inferModeDomain.some((pattern) => pattern.test(q))) return "domain";
  return "generic";
}

function trimQueryCache(
  cache: Map<string, { createdAt: number; value: SearchResult }>,
  maxEntries: number,
): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function buildSearchCacheKey(payload: SearchCacheKeyParts): string {
  return JSON.stringify({
    q: payload.query.toLowerCase(),
    mode: payload.mode,
    limit: payload.limit,
    contextRadius: payload.contextRadius,
    maxPerPath: payload.maxPerPath,
    track: payload.track || "",
    module: payload.module || "",
    includeArchive: Boolean(payload.includeArchive),
    debug: Boolean(payload.debug),
    debugTopN: payload.debugTopN,
  });
}

function cloneSearchResult(result: SearchResult): SearchResult {
  return JSON.parse(JSON.stringify(result));
}

function normalizeTermKey(value: unknown): string {
  return normalizeScalar(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeAliasKey(value: unknown): string {
  return normalizeScalar(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singleLine(value: unknown): string {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(Number(value || 0).toFixed(3));
}
