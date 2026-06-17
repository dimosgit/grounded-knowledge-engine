#!/usr/bin/env node
import { getKbRetriever } from "./retriever.js";
import type {
  RetrievalBackend,
  RetrieverOptions,
  SearchHit,
  SearchMode,
} from "./types.js";

const DEFAULT_LIMIT = 12;
const DEFAULT_CONTEXT = 1;

interface SearchCliArgs {
  query: string;
  mode: SearchMode;
  track: string;
  module: string;
  limit: number;
  context: number;
  includeArchive: boolean;
  backend: RetrievalBackend;
  maxPerPath: number;
  disableCache: boolean;
  debug: boolean;
  debugTopN: number;
  json: boolean;
  refresh: boolean;
  help: boolean;
}

interface WeightedDebugToken {
  token: string;
  weight: number;
  expanded?: boolean;
}

interface DebugTokenContribution {
  token: string;
  score: number;
}

interface DebugRerankAdjustment {
  reason: string;
  delta: number;
}

interface DebugCandidate {
  path: string;
  lineNumber: number;
  score: number;
  baseScore: number;
  tokenContributions?: DebugTokenContribution[];
  rerankAdjustments?: DebugRerankAdjustment[];
}

interface SearchDebug {
  candidateCountBeforeDedupe: number;
  candidateCountAfterDedupe: number;
  queryTokens: WeightedDebugToken[];
  topCandidates: DebugCandidate[];
}

function normalizeMode(value: string): SearchMode {
  const mode = value.trim().toLowerCase();
  if (mode === "domain" || mode === "project" || mode === "generic") return mode;
  return "auto";
}

function parseArgs(argv: string[]): SearchCliArgs {
  const args: SearchCliArgs = {
    query: "",
    mode: "auto",
    track: "",
    module: "",
    limit: DEFAULT_LIMIT,
    context: DEFAULT_CONTEXT,
    includeArchive: false,
    backend: "bm25",
    maxPerPath: 0,
    disableCache: false,
    debug: false,
    debugTopN: 5,
    json: false,
    refresh: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--query" || arg === "-q") {
      args.query = next || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--query=")) {
      args.query = arg.slice("--query=".length);
      continue;
    }

    if (arg === "--mode") {
      args.mode = normalizeMode(next || "auto");
      i += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      args.mode = normalizeMode(arg.slice("--mode=".length));
      continue;
    }

    if (arg === "--track") {
      args.track = (next || "").toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith("--track=")) {
      args.track = arg.slice("--track=".length).toLowerCase();
      continue;
    }

    if (arg === "--module") {
      args.module = (next || "").toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith("--module=")) {
      args.module = arg.slice("--module=".length).toLowerCase();
      continue;
    }

    if (arg === "--limit") {
      args.limit = Number.parseInt(next || `${DEFAULT_LIMIT}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = Number.parseInt(arg.slice("--limit=".length), 10);
      continue;
    }

    if (arg === "--context") {
      args.context = Number.parseInt(next || `${DEFAULT_CONTEXT}`, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--context=")) {
      args.context = Number.parseInt(arg.slice("--context=".length), 10);
      continue;
    }

    if (arg === "--include-archive") {
      args.includeArchive = true;
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
    if (arg === "--max-per-path") {
      args.maxPerPath = Number.parseInt(next || "0", 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-per-path=")) {
      args.maxPerPath = Number.parseInt(arg.slice("--max-per-path=".length), 10);
      continue;
    }
    if (arg === "--no-cache") {
      args.disableCache = true;
      continue;
    }
    if (arg === "--debug") {
      args.debug = true;
      continue;
    }
    if (arg === "--debug-top") {
      args.debugTopN = Number.parseInt(next || "5", 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--debug-top=")) {
      args.debugTopN = Number.parseInt(arg.slice("--debug-top=".length), 10);
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--refresh") {
      args.refresh = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (!args.query && !arg.startsWith("-")) {
      args.query = arg;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = DEFAULT_LIMIT;
  if (!Number.isFinite(args.context) || args.context < 0) args.context = DEFAULT_CONTEXT;
  if (!Number.isFinite(args.debugTopN) || args.debugTopN <= 0) args.debugTopN = 5;
  args.context = Math.min(args.context, 3);
  args.debugTopN = Math.min(args.debugTopN, 25);

  return args;
}

function printHelp() {
  console.log(`Local grounding search (repo-local evidence retriever)

Usage:
  npm run search -- --query "model controlled tools vs application controlled resources"

Options:
  -q, --query <text>       Query string (required)
  --mode <auto|domain|project|generic>
  --track <track-key>      Optional track filter (e.g. domain, demo, knowledge-ops)
  --module <module-key>    Optional module filter (e.g. agent-runtime)
  --limit <n>              Max hits (default: ${DEFAULT_LIMIT})
  --context <n>            Context lines before/after hit (default: ${DEFAULT_CONTEXT}, max: 3)
  --include-archive        Include kb/archive markdown files
  --backend <bm25|sqlite>  Retrieval backend (default: bm25)
  --max-per-path <n>       Max hits per source file (default: auto diversity cap)
  --no-cache               Disable query-result cache for this run
  --debug                  Include retrieval traces (token weights + candidate reasoning)
  --debug-top <n>          Number of traced candidates (default: 5, max: 25)
  --refresh                Force index refresh before search
  --json                   Emit machine-readable JSON

Examples:
  npm run search -- -q "how are MCP tools invoked" --mode generic
  npm run search -- -q "how are MCP tools invoked" --mode generic --backend sqlite
  npm run search -- -q "project board next actions" --mode project --track demo
`);
}

function formatHit(hit: SearchHit, index: number): string {
  const meta = [
    hit.sourceKind,
    hit.track ? `track=${hit.track}` : "",
    hit.module ? `module=${hit.module}` : "",
  ].filter(Boolean);

  const lines: string[] = [];
  lines.push(`${index + 1}. [score ${hit.score}] ${hit.path}:${hit.lineNumber}`);
  if (meta.length) lines.push(`   ${meta.join(" · ")}`);
  if (hit.title) lines.push(`   title: ${hit.title}`);

  for (const row of hit.context || []) {
    const marker = row.isHit ? ">" : " ";
    lines.push(` ${marker} ${String(row.lineNumber).padStart(5, " ")} | ${row.text}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.query.trim()) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const retriever = args.backend === "sqlite"
    ? await getSqliteRetriever({ forceRefresh: args.refresh })
    : await getKbRetriever({ forceRefresh: args.refresh });
  const result = retriever.search({
    query: args.query,
    mode: args.mode,
    track: args.track,
    module: args.module,
    limit: args.limit,
    context: args.context,
    includeArchive: args.includeArchive,
    maxPerPath: args.maxPerPath > 0 ? args.maxPerPath : undefined,
    disableCache: args.disableCache,
    debug: args.debug,
    debugTopN: args.debugTopN,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("# Local Grounding Search");
  console.log(`Query: ${result.query}`);
  console.log(`Mode: ${result.mode}`);
  if (result.backend) console.log(`Backend: ${result.backend}`);
  console.log(`Track filter: ${result.filters.track || "(none)"}`);
  console.log(`Module filter: ${result.filters.module || "(none)"}`);
  console.log(`Hits returned: ${result.hitCount}`);
  if (result.metrics?.latencyMs !== undefined) {
    const cacheHit = result.metrics?.cache?.hit ? "yes" : "no";
    console.log(`Latency: ${result.metrics.latencyMs} ms (cache hit: ${cacheHit})`);
  }
  console.log("");

  if (!result.hits.length) {
    console.log("No local evidence found.");
    console.log("Suggested next step: broaden the query or remove restrictive filters.");
    return;
  }

  result.hits.forEach((hit, index) => {
    if (index > 0) console.log("");
    console.log(formatHit(hit, index));
  });

  if (result.debug) {
    const debug = result.debug as SearchDebug;
    console.log("");
    console.log("## Retrieval Trace");
    console.log(`Candidates (before/after dedupe): ${debug.candidateCountBeforeDedupe}/${debug.candidateCountAfterDedupe}`);
    const weightedTokens = debug.queryTokens
      .map((item) => `${item.token}:${item.weight}${item.expanded ? "*" : ""}`)
      .join(", ");
    console.log(`Weighted tokens: ${weightedTokens}`);
    console.log("Top candidates:");
    debug.topCandidates.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.score}] ${item.path}:${item.lineNumber} (base ${item.baseScore})`);
      if (item.tokenContributions?.length) {
        const tokenStr = item.tokenContributions.map((part) => `${part.token}:${part.score}`).join(", ");
        console.log(`   token contributions: ${tokenStr}`);
      }
      if (item.rerankAdjustments?.length) {
        const adjStr = item.rerankAdjustments.map((adj) => `${adj.reason}:${adj.delta}`).join(", ");
        console.log(`   rerank adjustments: ${adjStr}`);
      }
    });
  }
}

async function getSqliteRetriever(options: RetrieverOptions) {
  const { getSqliteKbRetriever } = await import("./sqlite-index.js");
  return getSqliteKbRetriever(options);
}

function normalizeBackend(value: unknown): RetrievalBackend {
  return `${value || ""}`.trim().toLowerCase() === "sqlite" ? "sqlite" : "bm25";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
