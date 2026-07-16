#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { answerGrounded } from "./answer-service.js";
import { getKbRetriever } from "./retriever.js";
import { loadWorkspaceContext } from "../workspaces/config.js";
import type { WorkspaceContext } from "../workspaces/types.js";

// Set during arg parsing: an explicit --repo-root pins the evaluation to that
// checkout and skips workspace-context resolution.
let repoRootExplicit = false;
import type {
  KbRetriever,
  RetrievalBackend,
  RetrieverOptions,
  SearchHit,
  SearchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CASE_FILE = path.join(__dirname, "eval", "qa-set.json");
const DEFAULT_CATEGORY = "uncategorized";

export interface EvalArgs {
  file: string;
  repoRoot: string;
  scanRoots: string[];
  k: number;
  limit: number;
  context: number;
  runs: number;
  backend: RetrievalBackend;
  refresh: boolean;
  json: boolean;
  noCache: boolean;
  traces: boolean;
  deterministic: boolean;
  help: boolean;
}

export interface EvalCase {
  id: string;
  category: string;
  query: string;
  mode: string;
  track: string;
  module: string;
  expectedPathPatterns: string[];
  expectedCitationPathPatterns: string[];
  forbiddenPathPatterns: string[];
  expectAbstention: boolean | null;
}

export type FloorMetricName =
  | "recallAtK"
  | "top1Accuracy"
  | "mrrAtK"
  | "passRateAtK"
  | "expectedCoverageAtK"
  | "citationPathCoverage"
  | "citationResolvableRate"
  | "hardNegativeCleanRateAtK"
  | "abstentionAccuracy";

export type MetricFloors = Partial<Record<FloorMetricName, number>>;

export interface EvaluationFloors {
  overall: MetricFloors;
  categories: Record<string, MetricFloors>;
}

export interface LoadedCases {
  absolute: string;
  cases: EvalCase[];
  description: string;
  floors: EvaluationFloors;
}

export interface CandidateTrace {
  path: string;
  lineNumber: number;
  score: number;
  baseScore: number;
  matchedTokens: string[];
  rerankAdjustments: unknown[];
}

export interface EvalCaseResult {
  id: string;
  category: string;
  query: string;
  rank: number | null;
  forbiddenRank: number | null;
  hitAtK: boolean;
  forbiddenAtK: boolean;
  passAtK: boolean;
  topPath: string | null;
  topScore: number | null;
  precisionAtK: number | null;
  expectedCoverageAtK: number | null;
  ndcgAtK: number | null;
  citationPathCoverage: number | null;
  citationResolvableRate: number | null;
  abstained: boolean;
  expectAbstention: boolean | null;
  abstentionMatched: boolean | null;
  latencyMs: number | null;
  expectedPathPatterns: string[];
  expectedCitationPathPatterns: string[];
  forbiddenPathPatterns: string[];
  traces?: CandidateTrace[];
}

export interface EvaluationMetrics {
  recallAtK: number | null;
  top1Accuracy: number | null;
  mrrAtK: number | null;
  meanRelevantRank: number | null;
  passRateAtK: number;
  unresolvedCases: number;
  precisionAtK: number | null;
  expectedCoverageAtK: number | null;
  ndcgAtK: number | null;
  citationPathCoverage: number | null;
  citationResolvableRate: number | null;
  abstentionAccuracy: number | null;
  forbiddenHitRateAtK: number;
  hardNegative: {
    caseCount: number;
    cleanRateAtK: number | null;
  };
}

export interface CategoryEvaluation {
  category: string;
  totalCases: number;
  positiveCases: number;
  metrics: EvaluationMetrics;
}

export interface FloorCheck {
  scope: "overall" | "category";
  category: string | null;
  metric: FloorMetricName;
  minimum: number;
  actual: number | null;
  passed: boolean;
}

export interface EvaluationSummary {
  description: string;
  file: string;
  backend: RetrievalBackend;
  repository: {
    repoRoot: string;
    scanRoots: string[];
  };
  totalCases: number;
  positiveCases: number;
  runsPerCase: number;
  evaluatedSearches: number;
  deterministic: boolean;
  metrics: EvaluationMetrics & {
    latencyMs: { mean: number | null; p50: number | null; p95: number | null };
    cache: {
      enabled: boolean;
      hitRate: number;
      hits: number;
      misses: number;
    };
  };
  categories: Record<string, CategoryEvaluation>;
  floorChecks: FloorCheck[];
  floorsPassed: boolean;
  cases: EvalCaseResult[];
}

const FLOOR_METRICS = new Set<FloorMetricName>([
  "recallAtK",
  "top1Accuracy",
  "mrrAtK",
  "passRateAtK",
  "expectedCoverageAtK",
  "citationPathCoverage",
  "citationResolvableRate",
  "hardNegativeCleanRateAtK",
  "abstentionAccuracy",
]);

export function parseEvalArgs(argv: string[], cwd = process.cwd()): EvalArgs {
  const args: EvalArgs = {
    file: DEFAULT_CASE_FILE,
    repoRoot: cwd,
    scanRoots: [],
    k: 5,
    limit: 8,
    context: 1,
    runs: 1,
    backend: "bm25",
    refresh: false,
    json: false,
    noCache: false,
    traces: false,
    deterministic: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--file" || arg === "-f") {
      args.file = next || args.file;
      index += 1;
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    } else if (arg === "--repo-root") {
      args.repoRoot = next || args.repoRoot;
      repoRootExplicit = true;
      index += 1;
    } else if (arg.startsWith("--repo-root=")) {
      args.repoRoot = arg.slice("--repo-root=".length);
      repoRootExplicit = true;
    } else if (arg === "--scan-root") {
      if (next) args.scanRoots.push(next);
      index += 1;
    } else if (arg.startsWith("--scan-root=")) {
      args.scanRoots.push(arg.slice("--scan-root=".length));
    } else if (arg === "--scan-roots") {
      args.scanRoots.push(...splitList(next));
      index += 1;
    } else if (arg.startsWith("--scan-roots=")) {
      args.scanRoots.push(...splitList(arg.slice("--scan-roots=".length)));
    } else if (arg === "--k") {
      args.k = Number.parseInt(next || `${args.k}`, 10);
      index += 1;
    } else if (arg.startsWith("--k=")) {
      args.k = Number.parseInt(arg.slice("--k=".length), 10);
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(next || `${args.limit}`, 10);
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    } else if (arg === "--context") {
      args.context = Number.parseInt(next || `${args.context}`, 10);
      index += 1;
    } else if (arg.startsWith("--context=")) {
      args.context = Number.parseInt(arg.slice("--context=".length), 10);
    } else if (arg === "--runs") {
      args.runs = Number.parseInt(next || `${args.runs}`, 10);
      index += 1;
    } else if (arg.startsWith("--runs=")) {
      args.runs = Number.parseInt(arg.slice("--runs=".length), 10);
    } else if (arg === "--backend") {
      args.backend = normalizeBackend(next || "bm25");
      index += 1;
    } else if (arg.startsWith("--backend=")) {
      args.backend = normalizeBackend(arg.slice("--backend=".length));
    } else if (arg === "--refresh") {
      args.refresh = true;
    } else if (arg === "--no-cache") {
      args.noCache = true;
    } else if (arg === "--traces") {
      args.traces = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--deterministic") {
      args.deterministic = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  args.repoRoot = path.resolve(cwd, args.repoRoot);
  args.scanRoots = unique(args.scanRoots.map(normalizeScanRoot).filter(Boolean));
  args.k = clampInt(args.k, 1, 50, 5);
  args.limit = clampInt(args.limit, 1, 50, 8);
  args.context = clampInt(args.context, 0, 3, 1);
  args.runs = clampInt(args.runs, 1, 20, 1);
  if (args.deterministic) args.noCache = true;
  return args;
}

function printHelp(): void {
  console.log(`Evaluate local retrieval quality and grounded citation coverage against a QA set.

Usage:
  npm run eval -- [options]

Options:
  -f, --file <path>        QA set JSON file (default: tools/grounding/eval/qa-set.json)
  --repo-root <path>       Isolated repository root for fixture evaluation
  --scan-root <path>       Scan root relative to repo root (repeatable)
  --scan-roots <a,b>       Comma-separated scan roots
  --k <n>                  Metric cutoff @k (default: 5)
  --limit <n>              Search hit limit per query (default: 8)
  --context <n>            Context radius for search (default: 1)
  --runs <n>               Number of runs per query for latency sampling (default: 1)
  --backend <bm25|sqlite>  Retrieval backend (default: bm25)
  --refresh                Force index rebuild before evaluation
  --no-cache               Disable query-result cache during eval
  --traces                 Include top candidate traces in case output
  --deterministic          Disable cache and omit nondeterministic timings
  --json                   Print machine-readable JSON
  -h, --help               Show help
`);
}

export async function loadEvaluationCases(
  filePath: string,
  cwd = process.cwd(),
): Promise<LoadedCases> {
  const absolute = path.resolve(cwd, filePath);
  const raw = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const envelope = Array.isArray(parsed) ? { cases: parsed } : asObject(parsed, "Evaluation file");
  const sourceCases = envelope.cases;
  if (!Array.isArray(sourceCases) || !sourceCases.length) {
    throw new Error(`No cases found in ${absolute}`);
  }

  return {
    absolute,
    cases: sourceCases.map((item, index) => normalizeCase(item, index)),
    description: normalizeString(envelope.description),
    floors: normalizeFloors(envelope.floors, envelope.categoryFloors),
  };
}

function normalizeCase(item: unknown, index: number): EvalCase {
  const raw = asObject(item, `Case ${index + 1}`);
  const id = normalizeString(raw.id) || `case-${index + 1}`;
  const query = normalizeString(raw.query);
  if (!query) throw new Error(`Case '${id}' is missing query`);

  const expected = normalizePatterns(raw.expectedPathPatterns);
  const expectAbstention = normalizeOptionalBoolean(raw.expectAbstention, id);
  if (!expected.length && expectAbstention !== true) {
    throw new Error(`Case '${id}' is missing expectedPathPatterns`);
  }

  return {
    id,
    category: normalizeString(raw.category) || DEFAULT_CATEGORY,
    query,
    mode: normalizeString(raw.mode),
    track: normalizeString(raw.track),
    module: normalizeString(raw.module),
    expectedPathPatterns: expected,
    expectedCitationPathPatterns:
      normalizePatterns(raw.expectedCitationPathPatterns).length > 0
        ? normalizePatterns(raw.expectedCitationPathPatterns)
        : expected,
    forbiddenPathPatterns: normalizePatterns(raw.forbiddenPathPatterns),
    expectAbstention,
  };
}

function normalizeOptionalBoolean(value: unknown, id: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new Error(`Case '${id}' expectAbstention must be boolean`);
  }
  return value;
}

function normalizeFloors(value: unknown, legacyCategories: unknown): EvaluationFloors {
  if (value === undefined && legacyCategories === undefined) return { overall: {}, categories: {} };
  const raw = value === undefined ? {} : asObject(value, "Evaluation floors");
  const categoryValue = raw.categories ?? legacyCategories;
  const categoryObject =
    categoryValue === undefined ? {} : asObject(categoryValue, "Evaluation category floors");
  return {
    overall: normalizeMetricFloors(raw.overall, "overall"),
    categories: Object.fromEntries(
      Object.keys(categoryObject)
        .sort()
        .map((category) => [
          category,
          normalizeMetricFloors(categoryObject[category], `category '${category}'`),
        ]),
    ),
  };
}

function normalizeMetricFloors(value: unknown, label: string): MetricFloors {
  if (value === undefined) return {};
  const raw = asObject(value, `Floors for ${label}`);
  const normalized: MetricFloors = {};
  for (const metric of Object.keys(raw).sort()) {
    if (!FLOOR_METRICS.has(metric as FloorMetricName)) {
      throw new Error(`Unknown floor metric '${metric}' for ${label}`);
    }
    const minimum = raw[metric];
    if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum < 0 || minimum > 1) {
      throw new Error(`Floor '${metric}' for ${label} must be between 0 and 1`);
    }
    normalized[metric as FloorMetricName] = minimum;
  }
  return normalized;
}

export async function evaluateRetrieval(options: {
  args: EvalArgs;
  loaded: LoadedCases;
  retriever: KbRetriever;
}): Promise<EvaluationSummary> {
  const { args, loaded, retriever } = options;
  const caseResults: EvalCaseResult[] = [];
  const allLatencies: number[] = [];
  let runCount = 0;
  let cacheHits = 0;
  const indexedPaths = new Set(retriever.getDocuments().map((document) => document.relPath));

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
      if (!args.deterministic) {
        const latencyMs = Number(result?.metrics?.latencyMs || 0);
        perCaseLatencies.push(latencyMs);
        allLatencies.push(latencyMs);
      }
      runCount += 1;
      if (result?.metrics?.cache?.hit) cacheHits += 1;
      if (!primaryResult) primaryResult = result;
    }

    const answer = await answerGrounded(
      {
        question: testCase.query,
        strict: true,
        responseMode: "curate",
        limit: args.limit,
        mode: testCase.mode,
        track: testCase.track,
        module: testCase.module,
      },
      {
        search: async (searchArgs) =>
          retriever.search({ ...searchArgs, disableCache: true, debug: false }),
        listDocuments: async () => retriever.getDocuments(),
      },
    );
    const hits = primaryResult?.hits || [];
    const rank = findRank(hits, testCase.expectedPathPatterns);
    const forbiddenRank = findRank(hits, testCase.forbiddenPathPatterns);
    const positive = testCase.expectedPathPatterns.length > 0;
    const hitAtK = positive && rank !== null && rank <= args.k;
    const forbiddenAtK = forbiddenRank !== null && forbiddenRank <= args.k;
    const relevantAtK = positive
      ? countRelevantAtK(hits, testCase.expectedPathPatterns, args.k)
      : 0;
    const expectedCoverageAtK = positive
      ? relevantAtK / Math.max(1, Math.min(testCase.expectedPathPatterns.length, args.k))
      : null;
    const citationPathCoverage = positive
      ? countPatternCoverage(
          answer.citations.map((citation) => citation.path),
          testCase.expectedCitationPathPatterns,
        )
      : null;
    const citationResolvableRate = answer.citations.length
      ? answer.citations.filter((citation) => indexedPaths.has(citation.path)).length /
        answer.citations.length
      : positive
        ? 0
        : null;
    const abstentionMatched =
      testCase.expectAbstention === null ? null : answer.abstained === testCase.expectAbstention;
    const positivePass = positive ? hitAtK : true;

    caseResults.push({
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      rank,
      forbiddenRank,
      hitAtK,
      forbiddenAtK,
      passAtK: positivePass && !forbiddenAtK && abstentionMatched !== false,
      topPath: hits[0]?.path || null,
      topScore: hits[0]?.score ?? null,
      precisionAtK: positive ? round(relevantAtK / args.k) : null,
      expectedCoverageAtK:
        expectedCoverageAtK === null ? null : round(Math.min(1, expectedCoverageAtK)),
      ndcgAtK: positive ? round(ndcgAtK(hits, testCase.expectedPathPatterns, args.k)) : null,
      citationPathCoverage: citationPathCoverage === null ? null : round(citationPathCoverage),
      citationResolvableRate:
        citationResolvableRate === null ? null : round(citationResolvableRate),
      abstained: answer.abstained,
      expectAbstention: testCase.expectAbstention,
      abstentionMatched,
      latencyMs: args.deterministic ? null : round(mean(perCaseLatencies), 2),
      expectedPathPatterns: testCase.expectedPathPatterns,
      expectedCitationPathPatterns: testCase.expectedCitationPathPatterns,
      forbiddenPathPatterns: testCase.forbiddenPathPatterns,
      traces: args.traces ? buildTrace(primaryResult, 3) : undefined,
    });
  }

  const metrics = calculateMetrics(caseResults);
  const categories = Object.fromEntries(
    unique(caseResults.map((result) => result.category))
      .sort()
      .map((category) => {
        const categoryCases = caseResults.filter((result) => result.category === category);
        return [
          category,
          {
            category,
            totalCases: categoryCases.length,
            positiveCases: categoryCases.filter(isPositiveResult).length,
            metrics: calculateMetrics(categoryCases),
          } satisfies CategoryEvaluation,
        ];
      }),
  );
  const floorChecks = buildFloorChecks(loaded.floors, metrics, categories);

  return {
    description: loaded.description,
    file: loaded.absolute,
    backend: args.backend,
    repository: {
      repoRoot: args.repoRoot,
      scanRoots: args.scanRoots.length
        ? args.scanRoots
        : (retriever.meta.scanRoots as string[]) || [],
    },
    totalCases: caseResults.length,
    positiveCases: caseResults.filter(isPositiveResult).length,
    runsPerCase: args.runs,
    evaluatedSearches: runCount,
    deterministic: args.deterministic,
    metrics: {
      ...metrics,
      latencyMs: args.deterministic
        ? { mean: null, p50: null, p95: null }
        : {
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
    categories,
    floorChecks,
    floorsPassed: floorChecks.every((check) => check.passed),
    cases: caseResults,
  };
}

function calculateMetrics(results: EvalCaseResult[]): EvaluationMetrics {
  const positive = results.filter(isPositiveResult);
  const relevantRanks = positive
    .map((result) => result.rank)
    .filter((rank): rank is number => rank !== null);
  const reciprocalRanks = positive.map((result) => (result.rank ? 1 / result.rank : 0));
  const hardNegatives = results.filter(
    (result) => result.forbiddenPathPatterns.length > 0 || result.expectAbstention === true,
  );
  const cleanHardNegatives = hardNegatives.filter(
    (result) => !result.forbiddenAtK && result.abstentionMatched !== false,
  );
  const abstentionCases = results.filter((result) => result.expectAbstention !== null);

  return {
    recallAtK: positive.length
      ? round(positive.filter((result) => result.hitAtK).length / positive.length)
      : null,
    top1Accuracy: positive.length
      ? round(positive.filter((result) => result.rank === 1).length / positive.length)
      : null,
    mrrAtK: positive.length ? round(mean(reciprocalRanks)) : null,
    meanRelevantRank: relevantRanks.length ? round(mean(relevantRanks), 2) : null,
    passRateAtK: results.length
      ? round(results.filter((result) => result.passAtK).length / results.length)
      : 0,
    unresolvedCases: positive.filter((result) => result.rank === null).length,
    precisionAtK: meanNullable(positive.map((result) => result.precisionAtK)),
    expectedCoverageAtK: meanNullable(positive.map((result) => result.expectedCoverageAtK)),
    ndcgAtK: meanNullable(positive.map((result) => result.ndcgAtK)),
    citationPathCoverage: meanNullable(positive.map((result) => result.citationPathCoverage)),
    citationResolvableRate: meanNullable(results.map((result) => result.citationResolvableRate)),
    abstentionAccuracy: abstentionCases.length
      ? round(
          abstentionCases.filter((result) => result.abstentionMatched).length /
            abstentionCases.length,
        )
      : null,
    forbiddenHitRateAtK: results.length
      ? round(results.filter((result) => result.forbiddenAtK).length / results.length)
      : 0,
    hardNegative: {
      caseCount: hardNegatives.length,
      cleanRateAtK: hardNegatives.length
        ? round(cleanHardNegatives.length / hardNegatives.length)
        : null,
    },
  };
}

function buildFloorChecks(
  floors: EvaluationFloors,
  overall: EvaluationMetrics,
  categories: Record<string, CategoryEvaluation>,
): FloorCheck[] {
  const checks: FloorCheck[] = [];
  appendFloorChecks(checks, "overall", null, floors.overall, overall);
  for (const category of Object.keys(floors.categories).sort()) {
    appendFloorChecks(
      checks,
      "category",
      category,
      floors.categories[category],
      categories[category]?.metrics || null,
    );
  }
  return checks;
}

function appendFloorChecks(
  checks: FloorCheck[],
  scope: FloorCheck["scope"],
  category: string | null,
  floors: MetricFloors,
  metrics: EvaluationMetrics | null,
): void {
  for (const metric of Object.keys(floors).sort() as FloorMetricName[]) {
    const minimum = floors[metric] as number;
    const actual = metrics ? getFloorMetric(metrics, metric) : null;
    checks.push({
      scope,
      category,
      metric,
      minimum,
      actual,
      passed: actual !== null && actual >= minimum,
    });
  }
}

function getFloorMetric(metrics: EvaluationMetrics, metric: FloorMetricName): number | null {
  if (metric === "hardNegativeCleanRateAtK") return metrics.hardNegative.cleanRateAtK;
  return metrics[metric];
}

export function formatEvaluationReport(summary: EvaluationSummary, k: number): string {
  const lines = [
    "# Retrieval Evaluation",
    `Case file: ${summary.file}`,
    `Backend: ${summary.backend}`,
    `Repository root: ${summary.repository.repoRoot}`,
    `Scan roots: ${summary.repository.scanRoots.join(", ") || "(defaults)"}`,
  ];
  if (summary.description) lines.push(`Description: ${summary.description}`);
  lines.push(
    `Cases: ${summary.totalCases} (${summary.positiveCases} positive) | runs per case: ${summary.runsPerCase}`,
    "",
    `Recall@${k}: ${formatMetric(summary.metrics.recallAtK)}`,
    `Top-1 accuracy: ${formatMetric(summary.metrics.top1Accuracy)}`,
    `MRR@${k}: ${formatMetric(summary.metrics.mrrAtK)}`,
    `Pass rate@${k}: ${formatMetric(summary.metrics.passRateAtK)}`,
    `Mean relevant rank: ${formatMetric(summary.metrics.meanRelevantRank)}`,
    `Precision@${k}: ${formatMetric(summary.metrics.precisionAtK)}`,
    `Path coverage@${k}: ${formatMetric(summary.metrics.expectedCoverageAtK)}`,
    `Citation path coverage: ${formatMetric(summary.metrics.citationPathCoverage)}`,
    `Citation resolvable rate: ${formatMetric(summary.metrics.citationResolvableRate)}`,
    `Abstention accuracy: ${formatMetric(summary.metrics.abstentionAccuracy)}`,
    `nDCG@${k}: ${formatMetric(summary.metrics.ndcgAtK)}`,
    `Forbidden hit rate@${k}: ${formatMetric(summary.metrics.forbiddenHitRateAtK)}`,
  );
  if (summary.metrics.hardNegative.caseCount) {
    lines.push(
      `Hard-negative clean rate@${k}: ${formatMetric(summary.metrics.hardNegative.cleanRateAtK)}`,
    );
  }
  lines.push(`Unresolved positive cases: ${summary.metrics.unresolvedCases}`);
  if (!summary.deterministic) {
    lines.push(
      `Latency mean/p50/p95: ${summary.metrics.latencyMs.mean}/${summary.metrics.latencyMs.p50}/${summary.metrics.latencyMs.p95} ms`,
      `Cache hit rate: ${summary.metrics.cache.hitRate} (${summary.metrics.cache.hits}/${summary.metrics.cache.hits + summary.metrics.cache.misses})`,
    );
  }

  lines.push("", "Per-category results:");
  for (const category of Object.keys(summary.categories).sort()) {
    const item = summary.categories[category];
    lines.push(
      `- ${category}: cases=${item.totalCases}, pass@${k}=${item.metrics.passRateAtK}, recall@${k}=${formatMetric(item.metrics.recallAtK)}, citation=${formatMetric(item.metrics.citationPathCoverage)}, abstention=${formatMetric(item.metrics.abstentionAccuracy)}`,
    );
  }

  if (summary.floorChecks.length) {
    lines.push("", `Floors: ${summary.floorsPassed ? "PASS" : "FAIL"}`);
    for (const check of summary.floorChecks) {
      const label = check.category ? `category:${check.category}` : check.scope;
      lines.push(
        `- ${check.passed ? "PASS" : "FAIL"} ${label}.${check.metric}: ${formatMetric(check.actual)} >= ${check.minimum}`,
      );
    }
  }

  lines.push("", "Per-case results:");
  for (const item of summary.cases) {
    const rankLabel = item.expectedPathPatterns.length
      ? item.rank === null
        ? "miss"
        : `rank ${item.rank}`
      : "negative";
    const abstentionLabel =
      item.expectAbstention === null
        ? "abstention-unscored"
        : item.abstentionMatched
          ? `abstention-${item.abstained ? "yes" : "no"}`
          : `abstention-mismatch(${item.abstained})`;
    lines.push(
      `- [${item.category}] ${item.id}: ${rankLabel}, ${item.forbiddenAtK ? `forbidden@${k}` : "forbidden-clean"}, ${abstentionLabel}, top=${item.topPath || "(none)"}, latency=${item.latencyMs ?? "omitted"} ms`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function evaluationExitCode(summary: Pick<EvaluationSummary, "floorsPassed">): 0 | 1 {
  return summary.floorsPassed ? 0 : 1;
}

async function runCli(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const loaded = await loadEvaluationCases(args.file);
  // Without explicit repository arguments, evaluate against the active
  // workspace so its scan roots and domain vocabulary apply (matching the
  // MCP server and the search CLI).
  let workspace: WorkspaceContext | undefined;
  if (!repoRootExplicit && !args.scanRoots.length) {
    try {
      workspace = await loadWorkspaceContext({ repoRoot: args.repoRoot });
    } catch {
      workspace = undefined;
    }
  }
  const retrieverOptions: RetrieverOptions = {
    repoRoot: args.repoRoot,
    forceRefresh: args.refresh,
    ...(workspace ? { workspace } : {}),
    ...(args.scanRoots.length ? { scanRoots: args.scanRoots } : {}),
  };
  const retriever =
    args.backend === "sqlite"
      ? await getSqliteRetriever(retrieverOptions)
      : await getKbRetriever(retrieverOptions);
  const summary = await evaluateRetrieval({ args, loaded, retriever });
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else process.stdout.write(formatEvaluationReport(summary, args.k));
  process.exitCode = evaluationExitCode(summary);
}

function normalizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => normalizeString(item)).filter(Boolean));
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBackend(value: unknown): RetrievalBackend {
  return `${value || ""}`.trim().toLowerCase() === "sqlite" ? "sqlite" : "bm25";
}

function normalizeScanRoot(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function splitList(value: string | undefined): string[] {
  return `${value || ""}`
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
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
  for (let index = 0; index < hits.length; index += 1) {
    if (matchesAnyPattern(hits[index]?.path, patterns)) return index + 1;
  }
  return null;
}

function countRelevantAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  return countMatchedPatterns(
    hits.slice(0, k).map((hit) => hit.path),
    expectedPatterns,
  );
}

function countPatternCoverage(paths: string[], patterns: string[]): number {
  if (!patterns.length) return 1;
  return countMatchedPatterns(paths, patterns) / patterns.length;
}

function countMatchedPatterns(paths: string[], patterns: string[]): number {
  const matched = new Set<number>();
  for (const pathValue of paths) {
    const normalizedPath = pathValue.toLowerCase();
    for (let index = 0; index < patterns.length; index += 1) {
      if (!matched.has(index) && normalizedPath.includes(patterns[index].toLowerCase())) {
        matched.add(index);
      }
    }
  }
  return matched.size;
}

function dcgAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  let dcg = 0;
  const matched = new Set<number>();
  for (let index = 0; index < Math.min(k, hits.length); index += 1) {
    const pathLower = `${hits[index]?.path || ""}`.toLowerCase();
    const patternIndex = expectedPatterns.findIndex(
      (pattern, candidate) => !matched.has(candidate) && pathLower.includes(pattern.toLowerCase()),
    );
    if (patternIndex === -1) continue;
    matched.add(patternIndex);
    dcg += 1 / Math.log2(index + 2);
  }
  return dcg;
}

function ndcgAtK(hits: SearchHit[], expectedPatterns: string[], k: number): number {
  const dcg = dcgAtK(hits, expectedPatterns, k);
  const idealRelevant = Math.min(k, expectedPatterns.length);
  let ideal = 0;
  for (let index = 0; index < idealRelevant; index += 1) ideal += 1 / Math.log2(index + 2);
  return ideal ? dcg / ideal : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (percentileValue / 100) * (sorted.length - 1);
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

function meanNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? round(mean(present)) : null;
}

function round(value: number, decimals = 4): number {
  return Number(Number(value || 0).toFixed(decimals));
}

function buildTrace(result: SearchResult | null, limit = 3): CandidateTrace[] {
  const candidates = result?.debug?.topCandidates;
  if (!Array.isArray(candidates) || !candidates.length) return [];
  return candidates.slice(0, limit).map((item) => ({
    path: item.path || "",
    lineNumber: item.lineNumber || 0,
    score: item.score || 0,
    baseScore: item.baseScore || 0,
    matchedTokens: item.matchedTokens || [],
    rerankAdjustments: item.rerankAdjustments || [],
  }));
}

function isPositiveResult(result: EvalCaseResult): boolean {
  return result.expectedPathPatterns.length > 0;
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : `${value}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function getSqliteRetriever(options: RetrieverOptions): Promise<KbRetriever> {
  const { getSqliteKbRetriever } = await import("./sqlite-index.js");
  return getSqliteKbRetriever(options);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
