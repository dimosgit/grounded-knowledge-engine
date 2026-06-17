#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getKbRetriever } from "./retriever.js";
import type {
  RetrievalBackend,
  RetrieverOptions,
  SearchHit,
  SearchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CASE_FILE = path.join(__dirname, "eval", "qa-set.json");

interface EvalArgs {
  file: string;
  k: number;
  limit: number;
  context: number;
  runs: number;
  backend: RetrievalBackend;
  refresh: boolean;
  json: boolean;
  noCache: boolean;
  traces: boolean;
  help: boolean;
}

interface EvalCase {
  id: string;
  query: string;
  mode: string;
  track: string;
  module: string;
  expectedPathPatterns: string[];
  forbiddenPathPatterns: string[];
}

interface LoadedCases {
  absolute: string;
  cases: EvalCase[];
  description: string;
}

interface CandidateTrace {
  path: string;
  lineNumber: number;
  score: number;
  baseScore: number;
  matchedTokens: string[];
  rerankAdjustments: unknown[];
}

interface EvalCaseResult {
  id: string;
  query: string;
  rank: number | null;
  forbiddenRank: number | null;
  hitAtK: boolean;
  forbiddenAtK: boolean;
  passAtK: boolean;
  topPath: string | null;
  topScore: number | null;
  precisionAtK: number;
  expectedCoverageAtK: number;
  ndcgAtK: number;
  latencyMs: number;
  expectedPathPatterns: string[];
  forbiddenPathPatterns: string[];
  traces?: CandidateTrace[];
}

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    file: DEFAULT_CASE_FILE,
    k: 5,
    limit: 8,
    context: 1,
    runs: 1,
    backend: "bm25",
    refresh: false,
    json: false,
    noCache: false,
    traces: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--file" || arg === "-f") {
      args.file = next || args.file;
      i += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
      continue;
    }
    if (arg === "--k") {
      args.k = Number.parseInt(next || `${args.k}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--k=")) {
      args.k = Number.parseInt(arg.slice("--k=".length), 10);
      continue;
    }
    if (arg === "--limit") {
      args.limit = Number.parseInt(next || `${args.limit}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = Number.parseInt(arg.slice("--limit=".length), 10);
      continue;
    }
    if (arg === "--context") {
      args.context = Number.parseInt(next || `${args.context}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--context=")) {
      args.context = Number.parseInt(arg.slice("--context=".length), 10);
      continue;
    }
    if (arg === "--runs") {
      args.runs = Number.parseInt(next || `${args.runs}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--runs=")) {
      args.runs = Number.parseInt(arg.slice("--runs=".length), 10);
      continue;
    }
    if (arg === "--backend") {
      args.backend = normalizeBackend(next || "bm25");
      i += 1;
      continue;
    }
    if (arg.startsWith("--backend=")) {
      args.backend = normalizeBackend(arg.slice("--backend=".length));
      continue;
    }
    if (arg === "--refresh") {
      args.refresh = true;
      continue;
    }
    if (arg === "--no-cache") {
      args.noCache = true;
      continue;
    }
    if (arg === "--traces") {
      args.traces = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
  }

  args.k = clampInt(args.k, 1, 50, 5);
  args.limit = clampInt(args.limit, 1, 50, 8);
  args.context = clampInt(args.context, 0, 3, 1);
  args.runs = clampInt(args.runs, 1, 20, 1);

  return args;
}

function printHelp() {
  console.log(`Evaluate local retrieval quality and latency against a QA set.

Usage:
  npm run eval:retrieval -- [options]

Options:
  -f, --file <path>        QA set JSON file (default: tools/grounding/eval/qa-set.json)
  --k <n>                  Metric cutoff @k (default: 5)
  --limit <n>              Search hit limit per query (default: 8)
  --context <n>            Context radius for search (default: 1)
  --runs <n>               Number of runs per query for latency sampling (default: 1)
  --backend <bm25|sqlite>  Retrieval backend (default: bm25)
  --refresh                Force index rebuild before evaluation
  --no-cache               Disable query-result cache during eval
  --traces                 Include top candidate traces in case output
  --json                   Print machine-readable JSON
  -h, --help               Show help
`);
}

async function loadCases(filePath: string): Promise<LoadedCases> {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(raw);

  const sourceCases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(sourceCases) || !sourceCases.length) {
    throw new Error(`No cases found in ${absolute}`);
  }

  const cases = sourceCases.map((item, index) => normalizeCase(item, index));
  return { absolute, cases, description: parsed.description || "" };
}

function normalizeCase(item: unknown, index: number): EvalCase {
  const raw = (item ?? {}) as Record<string, unknown>;
  const id = normalizeString(raw.id) || `case-${index + 1}`;
  const query = normalizeString(raw.query);
  if (!query) throw new Error(`Case '${id}' is missing query`);

  const expected = normalizePatterns(raw.expectedPathPatterns);
  if (!expected.length) {
    throw new Error(`Case '${id}' is missing expectedPathPatterns`);
  }

  const forbidden = normalizePatterns(raw.forbiddenPathPatterns);

  return {
    id,
    query,
    mode: normalizeString(raw.mode),
    track: normalizeString(raw.track),
    module: normalizeString(raw.module),
    expectedPathPatterns: expected,
    forbiddenPathPatterns: forbidden,
  };
}

function normalizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBackend(value: unknown): RetrievalBackend {
  return `${value || ""}`.trim().toLowerCase() === "sqlite" ? "sqlite" : "bm25";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(`${value}`, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function matchesAnyPattern(pathValue: unknown, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const haystack = `${pathValue || ""}`.toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

function findRank(hits: SearchHit[], patterns: string[]): number | null {
  if (!patterns.length) return null;
  for (let i = 0; i < hits.length; i += 1) {
    if (matchesAnyPattern(hits[i]?.path, patterns)) return i + 1;
  }
  return null;
}

function countRelevantAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  if (!expectedPatterns.length) return 0;
  const seenPatternIndexes = new Set<number>();
  const window = hits.slice(0, k);
  for (const hit of window) {
    const pathLower = `${hit?.path || ""}`.toLowerCase();
    for (let i = 0; i < expectedPatterns.length; i += 1) {
      if (seenPatternIndexes.has(i)) continue;
      if (pathLower.includes(expectedPatterns[i].toLowerCase())) {
        seenPatternIndexes.add(i);
        break;
      }
    }
  }
  return seenPatternIndexes.size;
}

function dcgAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  if (!expectedPatterns.length) return 0;
  let dcg = 0;
  const seenPatternIndexes = new Set<number>();
  const window = hits.slice(0, k);
  for (let i = 0; i < window.length; i += 1) {
    const pathLower = `${window[i]?.path || ""}`.toLowerCase();
    let matchedPatternIndex = -1;
    for (let j = 0; j < expectedPatterns.length; j += 1) {
      if (seenPatternIndexes.has(j)) continue;
      if (pathLower.includes(expectedPatterns[j].toLowerCase())) {
        matchedPatternIndex = j;
        break;
      }
    }
    if (matchedPatternIndex === -1) continue;
    seenPatternIndexes.add(matchedPatternIndex);
    dcg += 1 / Math.log2(i + 2);
  }
  return dcg;
}

function ndcgAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  const dcg = dcgAtK(hits, expectedPatterns, k);
  const idealRelevant = Math.min(k, expectedPatterns.length);
  if (!idealRelevant) return 0;
  let idcg = 0;
  for (let i = 0; i < idealRelevant; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg ? dcg / idcg : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, decimals = 4): number {
  return Number(Number(value || 0).toFixed(decimals));
}

function buildTrace(result: SearchResult | null, limit = 3): CandidateTrace[] {
  const candidates = result?.debug?.topCandidates;
  if (!Array.isArray(candidates) || !candidates.length) return [];
  return candidates.slice(0, limit).map((item) => ({
    path: item.path,
    lineNumber: item.lineNumber,
    score: item.score,
    baseScore: item.baseScore,
    matchedTokens: item.matchedTokens,
    rerankAdjustments: item.rerankAdjustments,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const loaded = await loadCases(args.file);
  const retriever = args.backend === "sqlite"
    ? await getSqliteRetriever({ forceRefresh: args.refresh })
    : await getKbRetriever({ forceRefresh: args.refresh });

  const caseResults: EvalCaseResult[] = [];
  const allLatencies: number[] = [];
  const relevantRanks: number[] = [];
  const reciprocalRanks: number[] = [];
  const precisionAtKValues: number[] = [];
  const coverageAtKValues: number[] = [];
  const ndcgAtKValues: number[] = [];
  let runCount = 0;
  let cacheHits = 0;
  let hardNegativeCases = 0;
  let hardNegativeCleanCases = 0;

  for (const testCase of loaded.cases) {
    let primaryResult: SearchResult | null = null;
    const perCaseLatencies: number[] = [];

    for (let run = 0; run < args.runs; run += 1) {
      const result = retriever.search({
        query: testCase.query,
        mode: testCase.mode || undefined,
        track: testCase.track || undefined,
        module: testCase.module || undefined,
        limit: args.limit,
        context: args.context,
        disableCache: args.noCache,
        debug: args.traces && run === 0,
        debugTopN: args.traces ? 5 : undefined,
      });

      const latencyMs = Number(result?.metrics?.latencyMs || 0);
      perCaseLatencies.push(latencyMs);
      allLatencies.push(latencyMs);
      runCount += 1;
      if (result?.metrics?.cache?.hit) cacheHits += 1;

      if (!primaryResult) primaryResult = result;
    }

    const hits = primaryResult?.hits || [];
    const rank = findRank(hits, testCase.expectedPathPatterns);
    const forbiddenRank = findRank(hits, testCase.forbiddenPathPatterns);

    const hitAtK = rank !== null && rank <= args.k;
    const forbiddenAtK = forbiddenRank !== null && forbiddenRank <= args.k;
    if (rank !== null) {
      relevantRanks.push(rank);
      reciprocalRanks.push(1 / rank);
    } else {
      reciprocalRanks.push(0);
    }

    const relevantAtK = countRelevantAtK(hits, testCase.expectedPathPatterns, args.k);
    const precisionAtK = relevantAtK / args.k;
    const expectedCoverageAtK = relevantAtK / Math.max(1, Math.min(testCase.expectedPathPatterns.length, args.k));
    const ndcg = ndcgAtK(hits, testCase.expectedPathPatterns, args.k);

    precisionAtKValues.push(precisionAtK);
    coverageAtKValues.push(Math.min(1, expectedCoverageAtK));
    ndcgAtKValues.push(ndcg);

    if (testCase.forbiddenPathPatterns.length) {
      hardNegativeCases += 1;
      if (!forbiddenAtK) hardNegativeCleanCases += 1;
    }

    caseResults.push({
      id: testCase.id,
      query: testCase.query,
      rank,
      forbiddenRank,
      hitAtK,
      forbiddenAtK,
      passAtK: hitAtK && !forbiddenAtK,
      topPath: hits[0]?.path || null,
      topScore: hits[0]?.score ?? null,
      precisionAtK: round(precisionAtK),
      expectedCoverageAtK: round(Math.min(1, expectedCoverageAtK)),
      ndcgAtK: round(ndcg),
      latencyMs: round(mean(perCaseLatencies), 2),
      expectedPathPatterns: testCase.expectedPathPatterns,
      forbiddenPathPatterns: testCase.forbiddenPathPatterns,
      traces: args.traces ? buildTrace(primaryResult, 3) : undefined,
    });
  }

  const hitAtKCount = caseResults.filter((item) => item.hitAtK).length;
  const top1Count = caseResults.filter((item) => item.rank === 1).length;
  const forbiddenAtKCount = caseResults.filter((item) => item.forbiddenAtK).length;
  const passAtKCount = caseResults.filter((item) => item.passAtK).length;

  const summary = {
    description: loaded.description,
    file: loaded.absolute,
    backend: args.backend,
    totalCases: caseResults.length,
    runsPerCase: args.runs,
    evaluatedSearches: runCount,
    metrics: {
      recallAtK: round(hitAtKCount / caseResults.length),
      top1Accuracy: round(top1Count / caseResults.length),
      mrrAtK: round(mean(reciprocalRanks)),
      meanRelevantRank: relevantRanks.length ? round(mean(relevantRanks), 2) : null,
      passRateAtK: round(passAtKCount / caseResults.length),
      unresolvedCases: caseResults.filter((item) => item.rank === null).length,
      precisionAtK: round(mean(precisionAtKValues)),
      expectedCoverageAtK: round(mean(coverageAtKValues)),
      ndcgAtK: round(mean(ndcgAtKValues)),
      forbiddenHitRateAtK: round(forbiddenAtKCount / caseResults.length),
      hardNegative: {
        caseCount: hardNegativeCases,
        cleanRateAtK: hardNegativeCases ? round(hardNegativeCleanCases / hardNegativeCases) : null,
      },
      latencyMs: {
        mean: round(mean(allLatencies), 2),
        p50: round(percentile(allLatencies, 50), 2),
        p95: round(percentile(allLatencies, 95), 2),
      },
      cache: {
        enabled: !args.noCache,
        hitRate: runCount ? round(cacheHits / runCount) : 0,
        hits: cacheHits,
        misses: runCount - cacheHits,
      },
    },
    cases: caseResults,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("# Retrieval Evaluation");
  console.log(`Case file: ${summary.file}`);
  console.log(`Backend: ${summary.backend}`);
  if (summary.description) console.log(`Description: ${summary.description}`);
  console.log(`Cases: ${summary.totalCases} | runs per case: ${summary.runsPerCase}`);
  console.log("");
  console.log(`Recall@${args.k}: ${summary.metrics.recallAtK}`);
  console.log(`Top-1 accuracy: ${summary.metrics.top1Accuracy}`);
  console.log(`MRR@${args.k}: ${summary.metrics.mrrAtK}`);
  console.log(`Pass rate@${args.k}: ${summary.metrics.passRateAtK}`);
  console.log(`Mean relevant rank: ${summary.metrics.meanRelevantRank ?? "n/a"}`);
  console.log(`Precision@${args.k}: ${summary.metrics.precisionAtK}`);
  console.log(`Coverage@${args.k}: ${summary.metrics.expectedCoverageAtK}`);
  console.log(`nDCG@${args.k}: ${summary.metrics.ndcgAtK}`);
  console.log(`Forbidden hit rate@${args.k}: ${summary.metrics.forbiddenHitRateAtK}`);
  if (summary.metrics.hardNegative.caseCount) {
    console.log(`Hard-negative clean rate@${args.k}: ${summary.metrics.hardNegative.cleanRateAtK}`);
  }
  console.log(`Unresolved cases: ${summary.metrics.unresolvedCases}`);
  console.log(`Latency mean/p50/p95: ${summary.metrics.latencyMs.mean}/${summary.metrics.latencyMs.p50}/${summary.metrics.latencyMs.p95} ms`);
  console.log(`Cache hit rate: ${summary.metrics.cache.hitRate} (${summary.metrics.cache.hits}/${summary.metrics.cache.hits + summary.metrics.cache.misses})`);
  console.log("");
  console.log("Per-case results:");
  for (const item of summary.cases) {
    const rankLabel = item.rank === null ? "miss" : `rank ${item.rank}`;
    const forbiddenLabel = item.forbiddenAtK ? `forbidden@${args.k}` : "forbidden-clean";
    console.log(`- ${item.id}: ${rankLabel}, ${forbiddenLabel}, top=${item.topPath || "(none)"}, latency=${item.latencyMs} ms`);
  }
}

async function getSqliteRetriever(options: RetrieverOptions) {
  const { getSqliteKbRetriever } = await import("./sqlite-index.js");
  return getSqliteKbRetriever(options);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
