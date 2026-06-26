#!/usr/bin/env node
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildToolCatalog, normalizeMcpProfile } from "./catalog.js";
import { negotiateProtocolVersion } from "./protocol.js";
import { MCP_RESOURCES, MCP_RESOURCE_TEMPLATES, readMcpResource } from "./resources.js";
import { startJsonRpcStdioTransport } from "./transport.js";
import {
  gatherCandidateFiles as gatherKnowledgeFiles,
  getDocumentTitle,
  inferSourceKind,
  inferTrack,
  normalizeScalar,
  normalizeScanRoots,
  parseFrontmatter,
  parsePositiveInt,
} from "../grounding/document-core.js";
import {
  DEFAULT_SCAN_ROOTS as RETRIEVER_DEFAULT_SCAN_ROOTS,
  getKbRetriever,
} from "../grounding/retriever.js";
import { resumeProject } from "../projects/index.js";
import type {
  IndexedDocument,
  KbRetriever,
  SearchArgs,
  SearchHit,
  SearchResult,
} from "../grounding/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(process.env.KB_MCP_REPO_ROOT || path.join(__dirname, "..", ".."));

const SERVER_INFO = {
  name: "kb-mcp-server",
  version: "0.1.0",
};

type JsonObject = Record<string, any>;

interface OwnershipData {
  owners?: Record<string, string>;
  moduleTracks?: Record<string, string>;
}
type ToolHandler = (args: JsonObject) => Promise<ToolPayload>;

interface ToolPayload {
  contentText: string;
  structured: any;
}

interface LocalDocument extends IndexedDocument {
  absPath: string;
  body: string;
  lines: string[];
}

type LogLevel = "off" | "error" | "warn" | "info" | "debug";
type ResponseFormat = "compact" | "full";

const DEFAULT_CACHE_TTL_MS = parsePositiveInt(
  process.env.KB_MCP_CACHE_TTL_MS,
  15000,
  1000,
  10 * 60 * 1000,
);
const DEFAULT_SLO_MS = parsePositiveInt(process.env.KB_MCP_SLO_MS, 3000, 50, 120 * 1000);
const DEFAULT_REQUIRE_CAPTURE = parseBooleanEnv(process.env.KB_MCP_REQUIRE_CAPTURE, true);
const DEFAULT_ENABLE_WRITES = parseBooleanEnv(process.env.KB_MCP_ENABLE_WRITES, false);
const DEFAULT_MCP_PROFILE = normalizeMcpProfile(process.env.KB_MCP_PROFILE);
const DEFAULT_RETRIEVAL_BACKEND = normalizeRetrievalBackend(
  process.env.KB_MCP_RETRIEVAL_BACKEND || "bm25",
);
const DEFAULT_RESPONSE_FORMAT = normalizeResponseFormatValue(
  process.env.KB_MCP_RESPONSE_FORMAT || "compact",
);
const WRITE_REFRESH_DEBOUNCE_MS = parsePositiveInt(
  process.env.KB_MCP_WRITE_REFRESH_DEBOUNCE_MS,
  75,
  0,
  2000,
);
const DEFAULT_SCAN_ROOTS = RETRIEVER_DEFAULT_SCAN_ROOTS;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
const MAX_CONTEXT = 3;

const logOrder = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };
const logLevel = normalizeLogLevel(process.env.KB_MCP_LOG_LEVEL || "error");
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

let docCache = {
  loadedAt: 0,
  docs: [] as LocalDocument[],
};
let writeQueue = Promise.resolve();
let pendingDocRefresh: Promise<void> | null = null;

async function getRetriever(forceRefresh = false): Promise<KbRetriever> {
  return getKbRetriever({
    repoRoot,
    scanRoots: parseScanRoots(process.env.KB_MCP_SCAN_ROOTS, DEFAULT_SCAN_ROOTS),
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    forceRefresh,
  });
}

async function getSqliteRetriever(forceRefresh = false): Promise<KbRetriever> {
  const { getSqliteKbRetriever } = await import("../grounding/sqlite-index.js");
  return getSqliteKbRetriever({
    repoRoot,
    scanRoots: parseScanRoots(process.env.KB_MCP_SCAN_ROOTS, DEFAULT_SCAN_ROOTS),
    forceRefresh,
  });
}

const tools = buildToolCatalog({
  profile: DEFAULT_MCP_PROFILE,
  writesEnabled: DEFAULT_ENABLE_WRITES,
  defaultLimit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
  maxContext: MAX_CONTEXT,
  defaultSloMs: DEFAULT_SLO_MS,
});
const advertisedToolNames = new Set(tools.map((tool) => tool.name));

const toolHandlers: Record<string, ToolHandler> = {
  "kb.search": handleKbSearch,
  "kb.get_record": handleKbGetRecord,
  "kb.get_topic": handleKbGetTopic,
  "kb.get_term": handleKbGetTerm,
  "kb.list_modules": handleKbListModules,
  "kb.answer_grounded": handleKbAnswerGrounded,
  "kb.upsert_note": handleKbUpsertNote,
  "kb.add_open_question": handleKbAddOpenQuestion,
  "kb.answer_and_capture": handleKbAnswerAndCapture,
  "kb.refresh": handleKbRefresh,
  "kb.resume_project": handleKbResumeProject,
};

async function handleKbResumeProject(args: JsonObject): Promise<ToolPayload> {
  const projectId = typeof args?.projectId === "string" ? args.projectId : "";
  if (!projectId) {
    throw new Error("Missing required argument: projectId");
  }
  const scanRoots = parseScanRoots(process.env.KB_MCP_SCAN_ROOTS, DEFAULT_SCAN_ROOTS);
  const result = await resumeProject({ projectId }, repoRoot, scanRoots);
  return result;
}

async function main() {
  startJsonRpcStdioTransport({
    input: process.stdin,
    output: process.stdout,
    handleRequest: (method, params) => handleRequest(method, params as JsonObject),
    handleNotification: (method, params) => handleNotification(method, params as JsonObject),
    errorCode: toJsonRpcErrorCode,
    errorMessage: safeErrorMessage,
    log: (message) => log("debug", message),
    onEnd: () => process.exit(0),
  });
}

async function handleNotification(method: string, _params: JsonObject = {}): Promise<void> {
  if (method === "notifications/initialized") return;
  if (method === "notifications/cancelled") return;
  log("debug", `ignored notification: ${method}`);
}

async function handleRequest(method: string, params: JsonObject): Promise<any> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
        instructions: `GKE local knowledge server (${DEFAULT_MCP_PROFILE} profile). Use kb.search for evidence, kb.get_record for direct reads, and kb.answer_and_capture for grounded Q&A. Writes are ${DEFAULT_ENABLE_WRITES ? "enabled" : "disabled; automatic capture is skipped"}.`,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return await handleToolCall(params);
    case "resources/list":
      return { resources: MCP_RESOURCES };
    case "resources/templates/list":
      return { resourceTemplates: MCP_RESOURCE_TEMPLATES };
    case "resources/read":
      return await readMcpResource(params, {
        repoRoot,
        workspaceId: normalizeScalar(process.env.KB_MCP_WORKSPACE_ID) || "default",
        profile: DEFAULT_MCP_PROFILE,
        writesEnabled: DEFAULT_ENABLE_WRITES,
        scanRoots: parseScanRoots(process.env.KB_MCP_SCAN_ROOTS, DEFAULT_SCAN_ROOTS),
        getDocuments: () => getDocuments(false),
      });
    case "prompts/list":
      return { prompts: [] };
    default:
      throw createJsonRpcError(-32601, `Method not found: ${method}`);
  }
}

async function handleToolCall(params: JsonObject): Promise<any> {
  const toolName = typeof params?.name === "string" ? params.name : "";
  const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
  const handler = toolHandlers[toolName];
  if (!handler || !advertisedToolNames.has(toolName)) {
    return jsonRpcToolError(`Unknown tool '${toolName}'.`);
  }

  try {
    const payload = await handler(args);
    return {
      content: [{ type: "text", text: payload.contentText }],
      structuredContent: payload.structured,
    };
  } catch (error) {
    return jsonRpcToolError(`Tool '${toolName}' failed: ${safeErrorMessage(error)}`);
  }
}

async function handleKbSearch(args: JsonObject): Promise<ToolPayload> {
  const result = await runSearch(args);
  const responseFormat = normalizeResponseFormat(args?.responseFormat);

  const lines: string[] = [];
  lines.push(`# kb.search`);
  lines.push(`Query: ${result.query}`);
  lines.push(`Mode: ${result.mode}`);
  if (result.backend) lines.push(`Backend: ${result.backend}`);
  lines.push(`Hits: ${result.hitCount}`);
  lines.push("");
  if (!result.hits.length) {
    lines.push("No local evidence found.");
  } else {
    result.hits.forEach((hit, idx) => {
      lines.push(
        `${idx + 1}. [${hit.score}] ${hit.path}:${hit.lineNumber}` +
          (hit.title ? ` | ${hit.title}` : ""),
      );
      lines.push(`   ${truncateOneLine(hit.snippet, 220)}`);
    });
  }
  if (result.signals) {
    lines.push("");
    lines.push(
      `Signals: coverage=${result.signals.tokenCoverage}, sources=${result.signals.uniqueSources}, topScore=${result.signals.topScore}, dominance=${result.signals.dominantSourceShare}`,
    );
  }
  if (result.debug?.topCandidates?.length) {
    lines.push("");
    lines.push("Trace:");
    result.debug.topCandidates.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. [${item.score}] ${item.path}:${item.lineNumber} (base ${item.baseScore})`,
      );
    });
  }

  return {
    contentText: lines.join("\n"),
    structured: shapeSearchResult(result, responseFormat),
  };
}

async function handleKbGetRecord(args: JsonObject): Promise<ToolPayload> {
  const query = normalizeScalar(args?.query);
  if (!query) throw new Error("Missing required argument: query");
  const kind = normalizeScalar(args?.kind).toLowerCase() || "any";
  const maxChars = parsePositiveInt(args?.maxChars, 8000, 300, 50000);
  const docs = await getDocuments(false);
  const eligible = filterDocumentsByKind(docs, kind);
  const match = rankAndPickDocument(eligible, query);
  if (!match) throw new Error(`No ${kind === "any" ? "record" : kind} matched '${query}'`);

  const payload = buildDocumentPayload(match, maxChars);
  return {
    contentText: [
      "# kb.get_record",
      `Query: ${query}`,
      `Kind: ${kind}`,
      `Match: ${payload.path}`,
      payload.title ? `Title: ${payload.title}` : "",
      "",
      payload.bodyPreview,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    structured: { query, kind, match: payload },
  };
}

async function handleCompatibilityRecordRead(
  kind: "topic" | "term",
  rawQuery: unknown,
  rawMaxChars: unknown,
  toolName: string,
): Promise<ToolPayload> {
  const query = normalizeScalar(rawQuery);
  if (!query) throw new Error(`Missing required argument: ${kind}`);
  const maxChars = parsePositiveInt(
    rawMaxChars,
    kind === "topic" ? 8000 : 5000,
    kind === "topic" ? 500 : 300,
    kind === "topic" ? 50000 : 30000,
  );
  const result = await handleKbGetRecord({ query, kind, maxChars });
  return {
    contentText: result.contentText.replace("# kb.get_record", `# ${toolName}`),
    structured: result.structured,
  };
}

function filterDocumentsByKind(docs: LocalDocument[], kind: string): LocalDocument[] {
  if (kind === "any") return docs;
  const pathSegments: Record<string, string> = {
    topic: "/topics/",
    term: "/terms/",
    module: "/modules/",
    project: "/projects/",
    decision: "/decisions/",
    source: "/sources/",
  };
  const segment = pathSegments[kind];
  if (!segment) throw new Error(`Unsupported record kind '${kind}'.`);
  return docs.filter((doc) => `/${doc.relPath}`.includes(segment) && doc.relPath.endsWith(".md"));
}

async function handleKbGetTopic(args: JsonObject): Promise<ToolPayload> {
  return handleCompatibilityRecordRead("topic", args?.topic, args?.maxChars, "kb.get_topic");
}

async function handleKbGetTerm(args: JsonObject): Promise<ToolPayload> {
  return handleCompatibilityRecordRead("term", args?.term, args?.maxChars, "kb.get_term");
}

async function handleKbListModules() {
  const docs = await getDocuments(false);
  const moduleDocs = docs
    .filter((doc) => doc.relPath.startsWith("kb/modules/") && doc.relPath.endsWith(".md"))
    .filter((doc) => !doc.relPath.endsWith("/index.md"));

  const ownershipPath = path.join(repoRoot, "kb", "modules", "topic-ownership.json");
  const ownership = await tryReadJson<OwnershipData>(ownershipPath, {});
  const ownerMap =
    ownership?.owners && typeof ownership.owners === "object" ? ownership.owners : {};
  const moduleTracks =
    ownership?.moduleTracks && typeof ownership.moduleTracks === "object"
      ? ownership.moduleTracks
      : {};

  const topicCounts = new Map<string, number>();
  Object.values(ownerMap).forEach((moduleKey) => {
    if (typeof moduleKey !== "string" || !moduleKey.trim()) return;
    topicCounts.set(moduleKey, (topicCounts.get(moduleKey) || 0) + 1);
  });

  const modules = moduleDocs
    .map((doc) => {
      const moduleKey = path.basename(doc.relPath, ".md");
      return {
        module: moduleKey,
        title: doc.title,
        path: doc.relPath,
        track: moduleTracks[moduleKey] || doc.track || "",
        topicCount: topicCounts.get(moduleKey) || 0,
      };
    })
    .sort((a, b) => a.module.localeCompare(b.module));

  const lines: string[] = [];
  lines.push(`# kb.list_modules`);
  lines.push(`Modules: ${modules.length}`);
  lines.push("");
  modules.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.module} (${item.topicCount} topics)` +
        (item.track ? ` [track=${item.track}]` : ""),
    );
    lines.push(`   ${item.path}`);
  });

  return {
    contentText: lines.join("\n"),
    structured: { moduleCount: modules.length, modules },
  };
}

async function handleKbAnswerGrounded(args: JsonObject): Promise<ToolPayload> {
  const allowDirect = args?.allowDirect === true;
  if (DEFAULT_REQUIRE_CAPTURE && !allowDirect) {
    throw new Error(
      "Direct kb.answer_grounded calls are disabled (KB_MCP_REQUIRE_CAPTURE=true). Use kb.answer_and_capture, or pass allowDirect=true for explicit debug usage.",
    );
  }
  const payload = await buildGroundedAnswerPayload(args);
  return payload;
}

async function handleKbUpsertNote(args: JsonObject): Promise<ToolPayload> {
  const dryRun = Boolean(args?.dryRun);
  const result = await upsertKbNote({
    kind: normalizeScalar(args?.kind).toLowerCase(),
    title: normalizeScalar(args?.title),
    body: typeof args?.body === "string" ? args.body : "",
    path: normalizeScalar(args?.path),
    module: normalizeScalar(args?.module),
    track: normalizeScalar(args?.track),
    type: normalizeScalar(args?.type),
    status: normalizeScalar(args?.status),
    tags: normalizeTags(args?.tags),
    owner: normalizeScalar(args?.owner),
    updated: normalizeDateString(args?.updated),
    append: Boolean(args?.append),
    dryRun,
  });

  const lines: string[] = [];
  lines.push(`# kb.upsert_note`);
  lines.push(`Kind: ${result.kind}`);
  lines.push(`Path: ${result.path}`);
  lines.push(`Action: ${result.action}${dryRun ? " (dry-run)" : ""}`);
  if (result.module) lines.push(`Module: ${result.module}`);
  if (result.track) lines.push(`Track: ${result.track}`);
  if (result.status) lines.push(`Status: ${result.status}`);
  if (result.type) lines.push(`Type: ${result.type}`);
  if (result.dedupe?.matched) {
    lines.push(
      `Dedupe: reused existing note (${result.dedupe.reason}, score=${result.dedupe.score})`,
    );
  }

  return {
    contentText: lines.join("\n"),
    structured: result,
  };
}

async function handleKbAddOpenQuestion(args: JsonObject): Promise<ToolPayload> {
  const question = normalizeScalar(args?.question);
  const whyOpen = normalizeScalar(args?.whyOpen);
  const whatWouldResolve = normalizeScalar(args?.whatWouldResolve);
  if (!question) throw new Error("Missing required argument: question");
  if (!whyOpen) throw new Error("Missing required argument: whyOpen");
  if (!whatWouldResolve) throw new Error("Missing required argument: whatWouldResolve");

  const result = await addOpenQuestion({
    question,
    whyOpen,
    whatWouldResolve,
    status: normalizeScalar(args?.status) || "open",
    resolvedBy: normalizeScalar(args?.resolvedBy),
    relatedPath: normalizeScalar(args?.relatedPath),
    dryRun: Boolean(args?.dryRun),
  });

  const lines: string[] = [];
  lines.push(`# kb.add_open_question`);
  lines.push(`Action: ${result.action}${result.dryRun ? " (dry-run)" : ""}`);
  lines.push(`File: ${result.path}`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Question: ${result.question}`);

  return {
    contentText: lines.join("\n"),
    structured: result,
  };
}

async function handleKbAnswerAndCapture(args: JsonObject): Promise<ToolPayload> {
  const startedAt = performance.now();
  const dryRun = Boolean(args?.dryRun);
  const sloThresholdMs = resolveSloThreshold(args?.sloMs);
  const answerStartedAt = performance.now();
  const answerPayload = await buildGroundedAnswerPayload(args);
  const answerStageMs = roundMs(performance.now() - answerStartedAt);
  const answer = answerPayload.structured || {};

  const captureStrategyRaw = normalizeScalar(args?.captureStrategy).toLowerCase() || "auto";
  const responseMode = normalizeResponseMode(args?.responseMode);
  let strategy = captureStrategyRaw;
  const fastPathSkipEligible = Boolean(answer?.fastPath?.used && answer?.fastPath?.alreadyCaptured);
  if (captureStrategyRaw === "auto") {
    if (!DEFAULT_ENABLE_WRITES) {
      strategy = "none";
    } else if (fastPathSkipEligible) {
      strategy = "none";
    } else {
      strategy = answer.abstained ? "open_question" : "note";
    }
  }

  let capture: any;
  let captureMs = 0;
  if (strategy === "note") {
    const captureStartedAt = performance.now();
    const noteKind = normalizeScalar(args?.noteKind).toLowerCase() || "topic";
    const inferredModule =
      normalizeScalar(args?.module) || inferPrimaryModule(args?.question, args?.mode);
    const defaultTitle = inferNoteTitle(args?.question, noteKind);
    const noteTitle = normalizeScalar(args?.noteTitle) || defaultTitle;
    const noteBody =
      typeof args?.noteBody === "string" && args.noteBody.trim()
        ? args.noteBody
        : buildCapturedNoteBody({
            question: normalizeScalar(args?.question),
            grounded: answer,
          });
    capture = await upsertKbNote({
      kind: noteKind,
      title: noteTitle,
      body: noteBody,
      path: normalizeScalar(args?.notePath),
      module: inferredModule,
      track: normalizeScalar(args?.track),
      type: normalizeScalar(args?.noteType) || "concept",
      status: normalizeScalar(args?.noteStatus) || "draft",
      tags: normalizeTags(args?.noteTags) || inferDefaultTags(args?.mode, inferredModule),
      owner: normalizeScalar(args?.noteOwner) || "kb-mcp-server",
      updated: normalizeDateString(""),
      append: Boolean(args?.append),
      dryRun,
    });
    captureMs = roundMs(performance.now() - captureStartedAt);
  } else if (strategy === "open_question") {
    const captureStartedAt = performance.now();
    const gateReasons = Array.isArray(answer?.gate?.reasons) ? answer.gate.reasons : [];
    const whyOpen = gateReasons.length
      ? `Grounded answer abstained due to evidence gate: ${gateReasons.join("; ")}.`
      : "Grounded evidence was insufficient for a reliable answer.";
    capture = await addOpenQuestion({
      question: normalizeScalar(args?.question),
      whyOpen,
      whatWouldResolve:
        "Provide system/version context and concrete Domain object names (transaction code, class, CDS view, or workflow step) to improve grounding.",
      status: "open",
      resolvedBy: "",
      relatedPath: "",
      dryRun,
    });
    captureMs = roundMs(performance.now() - captureStartedAt);
  } else if (strategy === "none") {
    capture = {
      action: "skipped",
      dryRun,
      path: "(none)",
      reason: fastPathSkipEligible
        ? "Existing curated term note was reused via fast path."
        : !DEFAULT_ENABLE_WRITES && captureStrategyRaw === "auto"
          ? "Automatic capture skipped because writes are disabled."
          : "Capture disabled by caller (captureStrategy=none).",
    };
    captureMs = 0;
  } else {
    throw new Error(
      `Unsupported captureStrategy '${captureStrategyRaw}'. Use auto, note, open_question, or none.`,
    );
  }

  const lines: string[] = [];
  lines.push(`# kb.answer_and_capture`);
  lines.push(`Question: ${normalizeScalar(args?.question)}`);
  lines.push(`Answer abstained: ${Boolean(answer.abstained)}`);
  lines.push(`Response mode: ${responseMode}`);
  lines.push(`Capture strategy: ${strategy}`);
  lines.push(`Capture action: ${capture.action}${dryRun ? " (dry-run)" : ""}`);
  lines.push(`Capture file: ${capture.path}`);
  if (capture.reason) lines.push(`Capture reason: ${capture.reason}`);
  const answerTimings = answer?.timings || {};
  const timings = {
    retrievalMs: Number.isFinite(answerTimings?.retrievalMs) ? answerTimings.retrievalMs : null,
    synthesisMs: Number.isFinite(answerTimings?.synthesisMs) ? answerTimings.synthesisMs : null,
    answerMs: answerStageMs,
    captureMs,
    totalMs: roundMs(performance.now() - startedAt),
  };
  const slo = buildSloGuard(timings.totalMs, sloThresholdMs);
  lines.push(
    `Timings (ms): retrieval=${timings.retrievalMs ?? "n/a"}, synthesis=${timings.synthesisMs ?? "n/a"}, capture=${timings.captureMs}, total=${timings.totalMs}`,
  );
  lines.push(
    `SLO guard: ${slo.status.toUpperCase()} (threshold=${slo.thresholdMs} ms, total=${slo.totalMs} ms${slo.breached ? `, over=${slo.overByMs} ms` : ""})`,
  );
  lines.push("");
  lines.push(answer.answer || "");

  const warnings: string[] = [];
  if (slo.breached) {
    warnings.push(
      `SLO breach: total ${slo.totalMs} ms exceeds threshold ${slo.thresholdMs} ms by ${slo.overByMs} ms.`,
    );
  }

  return {
    contentText: lines.join("\n"),
    structured: {
      question: normalizeScalar(args?.question),
      strategy,
      responseMode,
      answer,
      capture,
      timings,
      slo,
      warnings,
      dryRun,
    },
  };
}

async function buildGroundedAnswerPayload(args: JsonObject): Promise<ToolPayload> {
  const startedAt = performance.now();
  const question = normalizeScalar(args?.question);
  if (!question) throw new Error("Missing required argument: question");
  const strict = args?.strict !== false;
  const sloThresholdMs = resolveSloThreshold(args?.sloMs);
  const responseMode = normalizeResponseMode(args?.responseMode);

  const fastAnswer = await tryBuildFastAnswer({
    question,
    mode: normalizeScalar(args?.mode).toLowerCase(),
    responseMode,
    strict,
  });
  if (fastAnswer) {
    const existing: any = fastAnswer.structured?.timings || {};
    fastAnswer.structured.timings = {
      retrievalMs: Number.isFinite(existing.retrievalMs) ? existing.retrievalMs : null,
      synthesisMs: Number.isFinite(existing.synthesisMs) ? existing.synthesisMs : null,
      captureMs: null as number | null,
      totalMs: roundMs(performance.now() - startedAt),
    };
    return shapeGroundedPayload(attachSloGuardToPayload(fastAnswer, sloThresholdMs), args);
  }

  const retrievalStartedAt = performance.now();
  const searchResult = await runSearch({
    query: question,
    limit: parsePositiveInt(args?.limit, 8, 3, MAX_LIMIT),
    context: 1,
    mode: args?.mode,
    track: args?.track,
    module: args?.module,
    includeArchive: Boolean(args?.includeArchive),
    backend: args?.backend,
    debug: Boolean(args?.debug),
    debugTopN: parsePositiveInt(args?.debugTopN, 5, 1, 25),
  });
  const retrievalMs = Number.isFinite(searchResult?.metrics?.latencyMs)
    ? roundMs(searchResult.metrics.latencyMs)
    : roundMs(performance.now() - retrievalStartedAt);
  const synthesisStartedAt = performance.now();

  if (!searchResult.hits.length) {
    const thresholds = buildGateThresholds();
    const gate = {
      pass: false,
      reasons: ["no evidence hits"],
      thresholds,
      measured: {
        hitCount: 0,
        uniqueSources: 0,
        tokenCoverage: 0,
        topScore: 0,
        dominantSourceShare: 1,
      },
    };
    const payload = {
      contentText:
        "No grounded evidence found in local KB sources for that question. Try broader wording or remove filters.",
      structured: {
        question,
        answer:
          "No grounded answer available from local KB evidence for this query. Broaden the query or remove filters.",
        strict,
        responseMode,
        sourceTier: "no-local-evidence",
        abstained: true,
        confidence: { label: "low", score: 0.15, rationale: "No evidence hits" },
        gate,
        citations: [] as any[],
        evidence: [] as SearchHit[],
        search: {
          signals: searchResult.signals || null,
          debug: searchResult.debug || null,
          metrics: searchResult.metrics || null,
        },
        timings: {
          retrievalMs,
          synthesisMs: roundMs(performance.now() - synthesisStartedAt),
          captureMs: null as number | null,
          totalMs: roundMs(performance.now() - startedAt),
        },
      },
    };
    return shapeGroundedPayload(attachSloGuardToPayload(payload, sloThresholdMs), args);
  }

  const bestEvidence = searchResult.hits.slice(0, Math.min(6, searchResult.hits.length));
  const citations = bestEvidence.map((hit) => ({
    path: hit.path,
    line: hit.lineNumber,
    score: hit.score,
  }));

  const assessment = assessGrounding(searchResult);
  const confidence = assessment.confidence;
  const gate = assessment.gate;
  const evidenceBullets = bestEvidence.slice(0, 4).map((hit) => {
    return `${trimSentence(hit.snippet)} (${hit.path}:${hit.lineNumber})`;
  });

  let answerText;
  const shouldAbstain = strict && !gate.pass;
  if (shouldAbstain) {
    const reasonText = gate.reasons.length
      ? gate.reasons.join("; ")
      : "evidence thresholds not met";
    answerText =
      "Grounded answer withheld (strict evidence gate):\n" +
      `- Reason: ${reasonText}.\n` +
      "- Please refine your question with specific Domain object names, transaction codes, or implementation context.\n" +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: Strict mode avoids weakly-grounded synthesis.";
  } else if (confidence.label === "low") {
    answerText =
      "Grounded answer (retrieval-based, low confidence):\n" +
      "- The current evidence is partial or weak for a reliable direct answer.\n" +
      "- Please refine with more specific Domain object names, transaction codes, or module context.\n" +
      "\nBest matching local evidence:\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: This output is extractive and intentionally conservative.";
  } else {
    answerText =
      "Grounded answer (retrieval-based):\n" +
      evidenceBullets.map((line) => `- ${line}`).join("\n") +
      "\n\nNote: This synthesis is extractive from local KB evidence.";
  }

  const lines: any[] = [];
  lines.push(`# kb.answer_grounded`);
  lines.push(`Question: ${question}`);
  lines.push(`Confidence: ${confidence.label} (${confidence.score})`);
  lines.push(`Strict gate: ${gate.pass ? "pass" : "fail"}`);
  lines.push("");
  lines.push(answerText);

  const payload = {
    contentText: lines.join("\n"),
    structured: {
      question,
      answer: answerText,
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
      fastPath: {
        used: false,
        alreadyCaptured: false,
      },
      timings: {
        retrievalMs,
        synthesisMs: roundMs(performance.now() - synthesisStartedAt),
        captureMs: null as number | null,
        totalMs: roundMs(performance.now() - startedAt),
      },
    },
  };
  return shapeGroundedPayload(attachSloGuardToPayload(payload, sloThresholdMs), args);
}

async function handleKbRefresh() {
  await getDocuments(true);
  const retriever = await getRetriever(true);
  const stats = retriever.getStats();
  let sqliteStats: any = null;
  if (DEFAULT_RETRIEVAL_BACKEND === "sqlite") {
    sqliteStats = (await getSqliteRetriever(true)).getStats();
  }
  return {
    contentText: `Refreshed KB index. Documents: ${stats.documents}, chunks: ${stats.chunks}, tracks: ${Object.keys(stats.byTrack).length}, sources: ${Object.keys(stats.bySourceKind).length}${sqliteStats ? `, sqliteChunks: ${sqliteStats.chunks}` : ""}`,
    structured: { refreshed: true, stats, sqliteStats },
  };
}

async function runSearch(args: JsonObject): Promise<SearchResult> {
  const backend = normalizeRetrievalBackend(args?.backend);
  const retriever =
    backend === "sqlite" ? await getSqliteRetriever(false) : await getRetriever(false);
  return retriever.search(args as SearchArgs);
}

async function tryBuildFastAnswer({
  question,
  mode,
  responseMode,
  strict,
}: {
  question: string;
  mode: string;
  responseMode: string;
  strict: boolean;
}): Promise<ToolPayload | null> {
  const startedAt = performance.now();
  if (responseMode === "curate") return null;
  if (mode === "project") return null;

  const extractedTerm = extractSimpleTerm(question);
  if (!extractedTerm) return null;

  const retrievalStartedAt = performance.now();
  const termDoc = await findFastTermDocument(extractedTerm);
  const retrievalMs = roundMs(performance.now() - retrievalStartedAt);
  if (!termDoc) {
    return await tryBuildFastTopicAnswer({
      question,
      responseMode,
      strict,
      startedAt,
      retrievalStartedAt,
    });
  }

  const synthesisStartedAt = performance.now();
  const citationLine =
    findHeadingLine(termDoc.lines, /^##\s+Definition\b/i) ||
    findHeadingLine(termDoc.lines, /^##\s+1-minute explanation\b/i) ||
    1;
  const shortAnswer =
    extractFastTermSummary(termDoc) || `${termDoc.title} is a curated Domain term in the local KB.`;

  const answerText = [
    "Fast grounded answer (term cache hit):",
    `- ${trimSentence(shortAnswer)}`,
    `- Source: ${termDoc.relPath}:${citationLine}`,
    "",
    "Note: Fast mode reused an existing curated term note.",
  ].join("\n");

  const thresholds = {
    ...buildGateThresholds(),
    minHits: 1,
    minUniqueSources: 1,
    minTokenCoverage: 0,
    minTopScore: 0,
    maxDominantSourceShare: 1,
  };
  const modeLabel = responseMode === "fast" ? "forced-fast" : "auto-fast";
  return {
    contentText: answerText,
    structured: {
      question,
      answer: answerText,
      strict: strict !== false,
      responseMode,
      sourceTier: "exact-term",
      abstained: false,
      confidence: {
        label: "high",
        score: 0.94,
        rationale: "Direct match to an existing curated term note",
      },
      gate: {
        pass: true,
        reasons: [] as string[],
        thresholds,
        measured: {
          hitCount: 1,
          uniqueSources: 1,
          tokenCoverage: 1,
          topScore: 99,
          dominantSourceShare: 1,
        },
      },
      citations: [
        {
          path: termDoc.relPath,
          line: citationLine,
          score: 99,
        },
      ],
      evidence: [
        {
          path: termDoc.relPath,
          score: 99,
          lineNumber: citationLine,
          endLine: Math.min(termDoc.lines.length, citationLine + 1),
          title: termDoc.title,
          sourceKind: termDoc.sourceKind,
          track: termDoc.track,
          module: termDoc.module,
          snippet: shortAnswer,
          matchedTokens: [normalizeScalar(extractedTerm).toLowerCase()],
          context: [] as any[],
        },
      ],
      search: {
        signals: null as any,
        debug: null as any,
      },
      fastPath: {
        used: true,
        mode: modeLabel,
        strategy: "term-note",
        term: extractedTerm,
        path: termDoc.relPath,
        alreadyCaptured: true,
      },
      timings: {
        retrievalMs,
        synthesisMs: roundMs(performance.now() - synthesisStartedAt),
        captureMs: null as number | null,
        totalMs: roundMs(performance.now() - startedAt),
      },
    },
  };
}

async function tryBuildFastTopicAnswer({
  question,
  responseMode,
  strict,
  startedAt,
  retrievalStartedAt,
}: {
  question: string;
  responseMode: string;
  strict: boolean;
  startedAt: number;
  retrievalStartedAt: number;
}): Promise<ToolPayload | null> {
  const topicQuery = extractLikelyTopicQuery(question);
  if (!topicQuery) return null;

  const topicDoc = await findFastTopicDocument(topicQuery);
  const retrievalMs = roundMs(performance.now() - retrievalStartedAt);
  if (!topicDoc) return null;

  const synthesisStartedAt = performance.now();
  const citationLine = findHeadingLine(topicDoc.lines, /^#\s+/) || 1;
  const shortAnswer =
    extractFastTopicSummary(topicDoc) || `${topicDoc.title} is a curated local KB topic.`;
  const answerText = [
    "Fast grounded answer (topic cache hit):",
    `- ${trimSentence(shortAnswer)}`,
    `- Source: ${topicDoc.relPath}:${citationLine}`,
    "",
    "Note: Fast mode reused an existing curated topic note.",
  ].join("\n");
  const modeLabel = responseMode === "fast" ? "forced-fast" : "auto-fast";

  return {
    contentText: answerText,
    structured: {
      question,
      answer: answerText,
      strict: strict !== false,
      responseMode,
      sourceTier: "exact-topic",
      abstained: false,
      confidence: {
        label: "high",
        score: 0.91,
        rationale: "Direct match to an existing curated topic note",
      },
      gate: {
        pass: true,
        reasons: [] as string[],
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
          topScore: 95,
          dominantSourceShare: 1,
        },
      },
      citations: [{ path: topicDoc.relPath, line: citationLine, score: 95 }],
      evidence: [
        {
          path: topicDoc.relPath,
          score: 95,
          lineNumber: citationLine,
          endLine: Math.min(topicDoc.lines.length, citationLine + 3),
          title: topicDoc.title,
          sourceKind: topicDoc.sourceKind,
          track: topicDoc.track,
          module: topicDoc.module,
          snippet: shortAnswer,
          matchedTokens: tokenizeForSimilarity(topicQuery).slice(0, 12),
          context: [] as any[],
        },
      ],
      search: {
        signals: null as any,
        debug: null as any,
      },
      fastPath: {
        used: true,
        mode: modeLabel,
        strategy: "topic-note",
        topic: topicQuery,
        path: topicDoc.relPath,
        alreadyCaptured: true,
      },
      timings: {
        retrievalMs,
        synthesisMs: roundMs(performance.now() - synthesisStartedAt),
        captureMs: null as number | null,
        totalMs: roundMs(performance.now() - startedAt),
      },
    },
  };
}

async function findFastTermDocument(term: string): Promise<LocalDocument | null> {
  const docs = await getDocuments(false);
  const termDocs = docs.filter(
    (doc) => doc.relPath.startsWith("kb/terms/") && doc.relPath.endsWith(".md"),
  );
  if (!termDocs.length) return null;

  const target = normalizeTermKey(term);
  if (!target) return null;

  const exact = termDocs.find((doc) => {
    const docBase = path.basename(doc.relPath, ".md");
    return normalizeTermKey(docBase) === target || normalizeTermKey(doc.title) === target;
  });
  if (exact) return exact;

  const normalizedQuery = normalizeForMatch(term);
  const ranked = termDocs
    .map((doc) => ({ doc, score: scoreDocumentMatch(doc, normalizedQuery) }))
    .sort((a, b) => b.score - a.score || a.doc.relPath.localeCompare(b.doc.relPath));

  const best = ranked[0];
  if (best && best.score >= 95) return best.doc;
  return null;
}

async function findFastTopicDocument(topicQuery: string): Promise<LocalDocument | null> {
  const docs = await getDocuments(false);
  const topicDocs = docs.filter(
    (doc) => doc.relPath.startsWith("kb/topics/") && doc.relPath.endsWith(".md"),
  );
  if (!topicDocs.length) return null;

  const normalizedQuery = normalizeForMatch(topicQuery);
  const ranked = topicDocs
    .map((doc) => ({ doc, score: scoreDocumentMatch(doc, normalizedQuery) }))
    .sort((a, b) => b.score - a.score || a.doc.relPath.localeCompare(b.doc.relPath));

  const best = ranked[0];
  if (best && best.score >= 95) return best.doc;
  return null;
}

function extractSimpleTerm(question: string): string {
  const q = singleLine(question);
  if (!q) return "";

  const patterns = [
    /^\s*what(?:'s|\s+is)\s+([A-Za-z0-9/_-]{2,24})\s+in\s+domain\s*\??\s*$/i,
    /^\s*define\s+([A-Za-z0-9/_-]{2,24})\s+(?:in\s+domain)?\s*\??\s*$/i,
    /^\s*meaning\s+of\s+([A-Za-z0-9/_-]{2,24})\s+in\s+domain\s*\??\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (!match?.[1]) continue;
    const candidate = normalizeScalar(match[1]).replace(/[^A-Za-z0-9/_-]+/g, "");
    if (!candidate) continue;
    if (normalizeTermKey(candidate) === "Domain") continue;
    return candidate;
  }
  return "";
}

function extractLikelyTopicQuery(question: string): string {
  const q = singleLine(question).replace(/\?+$/, "");
  if (!q) return "";
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

function extractFastTermSummary(doc: LocalDocument): string {
  const lines = Array.isArray(doc?.lines) ? doc.lines : [];
  if (!lines.length) return "";

  const minuteHeading = findHeadingLine(lines, /^##\s+1-minute explanation\b/i);
  if (minuteHeading) {
    const bullets: string[] = [];
    for (let i = minuteHeading; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^##\s+/.test(line)) break;
      const bulletMatch = line.match(/^\s*-\s+(.*)$/);
      if (!bulletMatch) continue;
      const bullet = singleLine(bulletMatch[1]);
      if (bullet) bullets.push(bullet);
      if (bullets.length >= 2) break;
    }
    if (bullets.length) return bullets.join(" ");
  }

  const definitionHeading = findHeadingLine(lines, /^##\s+Definition\b/i);
  if (definitionHeading) {
    for (let i = definitionHeading; i < lines.length; i += 1) {
      const line = singleLine(lines[i]);
      if (!line) continue;
      if (/^##\s+/.test(line)) break;
      return line;
    }
  }

  for (const raw of lines) {
    const line = singleLine(raw);
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("- ")) return line.slice(2).trim();
    return line;
  }
  return "";
}

function extractFastTopicSummary(doc: LocalDocument): string {
  const lines = Array.isArray(doc?.lines) ? doc.lines : [];
  if (!lines.length) return "";

  const preferredHeading = lines.findIndex((line) =>
    /^##\s+(Decision|Definition|Goal|Purpose|1-minute explanation|Current status|Summary)\b/i.test(
      line,
    ),
  );
  const start = preferredHeading >= 0 ? preferredHeading + 1 : 0;
  const bullets: string[] = [];
  const paragraphs: string[] = [];

  for (let i = start; i < lines.length; i += 1) {
    const raw = lines[i];
    if (i > start && /^##\s+/.test(raw)) break;
    const line = singleLine(raw);
    if (!line || line.startsWith("#")) continue;
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet?.[1]) {
      bullets.push(singleLine(bullet[1]));
      if (bullets.length >= 2) break;
      continue;
    }
    paragraphs.push(line);
    if (paragraphs.join(" ").length >= 180) break;
  }

  if (bullets.length) return bullets.join(" ");
  if (paragraphs.length) return paragraphs.join(" ");
  return "";
}

function findHeadingLine(lines: string[], pattern: RegExp): number {
  if (!Array.isArray(lines) || !(pattern instanceof RegExp)) return 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 0;
}

function buildDocumentPayload(doc: LocalDocument, maxChars: number) {
  const bodyPreview = doc.body.trim().slice(0, maxChars);
  return {
    path: doc.relPath,
    title: doc.title,
    track: doc.track || "",
    module: doc.module || "",
    sourceKind: doc.sourceKind,
    frontmatter: doc.frontmatter,
    bodyPreview,
    truncated: doc.body.length > bodyPreview.length,
  };
}

function rankAndPickDocument(docs: LocalDocument[], query: string): LocalDocument | null {
  const q = normalizeForMatch(query);
  const scored = docs
    .map((doc) => ({ doc, score: scoreDocumentMatch(doc, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.relPath.localeCompare(b.doc.relPath));
  return scored[0]?.doc || null;
}

function scoreDocumentMatch(doc: LocalDocument, normalizedQuery: string): number {
  const rel = normalizeForMatch(doc.relPath);
  const base = normalizeForMatch(path.basename(doc.relPath, path.extname(doc.relPath)));
  const title = normalizeForMatch(doc.title || "");

  let score = 0;
  if (rel === normalizedQuery) score += 120;
  if (rel.endsWith(`/${normalizedQuery}`)) score += 100;
  if (base === normalizedQuery) score += 95;
  if (base.includes(normalizedQuery)) score += 60;
  if (title && title.includes(normalizedQuery)) score += 40;
  if (normalizedQuery.includes(base)) score += 25;
  return score;
}

function assessGrounding(searchResult: SearchResult) {
  const hits = Array.isArray(searchResult?.hits) ? searchResult.hits : [];
  const queryTokens = Array.isArray(searchResult?.queryTokens) ? searchResult.queryTokens : [];
  if (!hits.length) {
    return {
      confidence: { label: "low", score: 0.15, rationale: "No evidence hits" },
      gate: {
        pass: false,
        reasons: ["no evidence hits"],
        thresholds: buildGateThresholds(),
        measured: {
          hitCount: 0,
          uniqueSources: 0,
          tokenCoverage: 0,
          topScore: 0,
        },
      },
    };
  }

  const topHits = hits.slice(0, 5);
  const signals = searchResult?.signals as any;
  const topScore = Number.isFinite(signals.topScore) ? signals.topScore : topHits[0]?.score || 0;
  const hitCount = Number.isFinite(signals.hitCount) ? signals.hitCount : hits.length;
  const uniqueSources = Number.isFinite(signals.uniqueSources)
    ? signals.uniqueSources
    : new Set(topHits.map((hit) => hit.path)).size;
  const tokenCoverage = Number.isFinite(signals.tokenCoverage)
    ? signals.tokenCoverage
    : estimateTokenCoverage(topHits, queryTokens);
  const dominantSourceShare = Number.isFinite(signals.dominantSourceShare)
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
  if (dominantSourceShare > thresholds.maxDominantSourceShare) {
    reasons.push(`source dominance ${dominantSourceShare} > ${thresholds.maxDominantSourceShare}`);
  }
  const gatePass = reasons.length === 0;

  const relevanceSignal = Math.min(1, topScore / 18);
  const diversitySignal = Math.min(1, uniqueSources / 3);
  const coverageSignal = queryTokens.length ? Math.min(1, tokenCoverage) : 0.5;

  const score = Number(
    (0.45 * relevanceSignal + 0.3 * coverageSignal + 0.25 * diversitySignal).toFixed(2),
  );
  let confidence;
  if (score >= 0.75) {
    confidence = {
      label: "high",
      score,
      rationale: "High-scoring evidence with strong query coverage and source diversity",
    };
  } else if (score >= 0.5) {
    confidence = {
      label: "medium",
      score,
      rationale: "Moderate evidence quality; answer is grounded but may require verification",
    };
  } else {
    confidence = {
      label: "low",
      score,
      rationale: "Weak or partial evidence coverage; refine query for a reliable answer",
    };
  }

  return {
    confidence,
    gate: {
      pass: gatePass,
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
  const topEvidence = Array.isArray(evidence) ? evidence : [];
  if (topEvidence.some((hit) => hit?.sourceKind === "reference-source")) return "local-book";
  if (searchResult?.backend === "sqlite") return "sqlite";
  return "bm25";
}

function estimateTokenCoverage(hits: SearchHit[], queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const covered = new Set<string>();
  for (const hit of hits) {
    const matched = Array.isArray(hit.matchedTokens) ? hit.matchedTokens : [];
    for (const token of matched) covered.add(token);
  }
  return covered.size / queryTokens.length;
}

function estimateDominantSourceShare(hits: SearchHit[]): number {
  if (!hits.length) return 1;
  const counts = new Map<string, number>();
  for (const hit of hits) {
    counts.set(hit.path, (counts.get(hit.path) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount / hits.length;
}

function enqueueWrite(work: () => Promise<void>): Promise<void> {
  const run = async () => await work();
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

function scheduleDocumentRefresh(): Promise<void> {
  if (pendingDocRefresh) return pendingDocRefresh;
  pendingDocRefresh = new Promise<void>((resolve, reject) => {
    setTimeout(async () => {
      try {
        await getDocuments(true);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        pendingDocRefresh = null;
      }
    }, WRITE_REFRESH_DEBOUNCE_MS);
  });
  return pendingDocRefresh;
}

async function findDuplicateNoteCandidate({
  kind,
  title,
  body,
  plannedPath,
}: {
  kind: string;
  title: string;
  body: string;
  plannedPath: string;
}): Promise<any> {
  const docs = await getDocuments(false);
  const prefix = kind === "term" ? "kb/terms/" : "kb/topics/";
  const candidates = docs.filter(
    (doc) => doc.relPath.startsWith(prefix) && doc.relPath.endsWith(".md"),
  );
  if (!candidates.length) return null;

  const titleTokens = tokenizeForSimilarity(title);
  const bodyTokens = tokenizeForSimilarity(body).slice(0, 140);
  const normalizedPlanned = normalizeForMatch(plannedPath);
  const normalizedTitle = normalizeForSimilarity(title);

  let best: any = null;
  for (const doc of candidates) {
    if (normalizeForMatch(doc.relPath) === normalizedPlanned) continue;
    const docBase = path.basename(doc.relPath, ".md");
    const docTitle = doc.title || docBase;
    const titleScore = tokenOverlapScore(titleTokens, tokenizeForSimilarity(docTitle));
    const bodyScore = tokenOverlapScore(bodyTokens, tokenizeForSimilarity(doc.body).slice(0, 140));
    const sameSlug =
      slugify(docBase) === slugify(title) || normalizeForSimilarity(docBase) === normalizedTitle;
    const score = sameSlug ? 1 : Number((0.72 * titleScore + 0.28 * bodyScore).toFixed(3));
    if (!best || score > best.score) {
      best = {
        path: doc.relPath,
        title: docTitle,
        sameSlug,
        score,
        titleScore: Number(titleScore.toFixed(3)),
        bodyScore: Number(bodyScore.toFixed(3)),
      };
    }
  }

  if (!best) return null;
  const threshold = kind === "term" ? 0.74 : 0.7;
  if (!best.sameSlug && best.score < threshold) return null;
  return {
    matched: true,
    reason: best.sameSlug ? "slug-or-title-match" : "title-body-overlap",
    score: best.score,
    titleScore: best.titleScore,
    bodyScore: best.bodyScore,
    path: best.path,
    title: best.title,
  };
}

async function upsertKbNote(options: JsonObject): Promise<any> {
  const kind = normalizeScalar(options?.kind).toLowerCase();
  if (kind !== "topic" && kind !== "term") {
    throw new Error("Invalid note kind. Expected 'topic' or 'term'.");
  }

  const title = normalizeScalar(options?.title);
  const body = typeof options?.body === "string" ? options.body.trim() : "";
  if (!title) throw new Error("Missing title for note upsert.");
  if (!body) throw new Error("Missing body for note upsert.");

  const requestedPath = normalizeScalar(options?.path);
  let relPath = resolveKbNotePath({
    kind,
    title,
    requestedPath,
  });
  let dedupe: any = null;
  if (!requestedPath) {
    dedupe = await findDuplicateNoteCandidate({
      kind,
      title,
      body,
      plannedPath: relPath,
    });
    if (dedupe?.matched && dedupe.path) {
      relPath = dedupe.path;
    }
  }
  const absPath = resolveRepoPath(relPath);
  const exists = await fileExists(absPath);
  const append = Boolean(options?.append);
  const dryRun = Boolean(options?.dryRun);
  assertWriteAllowed({ dryRun, toolName: "kb.upsert_note" });

  const today = normalizeDateString(options?.updated) || getTodayIsoDate();
  const normalizedTags = normalizeTags(options?.tags);
  const moduleKey = kind === "topic" ? normalizeScalar(options?.module) || "general" : "";
  const inferredTrack =
    kind === "topic"
      ? await resolveTrackForModule(moduleKey, normalizeScalar(options?.track) || "domain")
      : normalizeScalar(options?.track) || "domain";
  const noteContent =
    kind === "topic"
      ? renderTopicNote({
          title,
          body,
          module: moduleKey,
          track: inferredTrack,
          type: normalizeScalar(options?.type) || "concept",
          status: normalizeScalar(options?.status) || "draft",
          owner: normalizeScalar(options?.owner) || "kb-mcp-server",
          updated: today,
          tags: normalizedTags || inferDefaultTags("domain", moduleKey),
        })
      : renderTermNote({
          title,
          body,
        });

  let finalContent = noteContent;
  let action = exists ? "updated" : "created";
  if (append && exists) {
    const existing = await fs.readFile(absPath, "utf8");
    finalContent = `${existing.trimEnd()}\n\n---\n\n${noteContent.trim()}\n`;
    action = "appended";
  }

  if (!dryRun) {
    await enqueueWrite(async () => {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, ensureTrailingNewline(finalContent), "utf8");
    });
    await scheduleDocumentRefresh();
  }

  return {
    kind,
    path: relPath,
    action,
    dryRun,
    existsBefore: exists,
    title,
    module: moduleKey || null,
    track: inferredTrack || null,
    type: kind === "topic" ? normalizeScalar(options?.type) || "concept" : null,
    status: kind === "topic" ? normalizeScalar(options?.status) || "draft" : null,
    tags: normalizedTags || null,
    dedupe: dedupe || { matched: false },
  };
}

async function addOpenQuestion(options: JsonObject): Promise<any> {
  const question = singleLine(options?.question);
  const whyOpen = singleLine(options?.whyOpen);
  const whatWouldResolve = singleLine(options?.whatWouldResolve);
  const status = normalizeScalar(options?.status).toLowerCase() || "open";
  if (status !== "open" && status !== "resolved") {
    throw new Error("Invalid open-question status. Expected 'open' or 'resolved'.");
  }
  if (!question || !whyOpen || !whatWouldResolve) {
    throw new Error("Open question requires question, whyOpen, and whatWouldResolve.");
  }

  const openQuestionsPath = "kb/open_questions.md";
  const absPath = resolveRepoPath(openQuestionsPath);
  const dryRun = Boolean(options?.dryRun);
  assertWriteAllowed({ dryRun, toolName: "kb.add_open_question" });
  const resolvedBy = singleLine(options?.resolvedBy);
  const relatedPath = normalizeScalar(options?.relatedPath);

  const relatedLink = relatedPath ? toOpenQuestionRelativeLink(relatedPath) : "";
  const entryLines = [
    `- question: ${question}`,
    `  why it's open: ${whyOpen}`,
    `  what would resolve it: ${whatWouldResolve}`,
    `  status: ${status}`,
  ];
  if (resolvedBy) entryLines.push(`  resolved by: ${resolvedBy}`);
  if (relatedLink) entryLines.push(`  related: ${relatedLink}`);
  entryLines.push(`  added: ${getTodayIsoDate()}`);
  const entry = entryLines.join("\n");

  let current = "# Open Questions\n";
  let exists = false;
  if (await fileExists(absPath)) {
    exists = true;
    current = await fs.readFile(absPath, "utf8");
  }

  const separator = current.trimEnd().endsWith("# Open Questions") ? "\n\n" : "\n\n";
  const next = `${current.trimEnd()}${separator}${entry}\n`;
  if (!dryRun) {
    await enqueueWrite(async () => {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, next, "utf8");
    });
    await scheduleDocumentRefresh();
  }

  return {
    action: exists ? "appended" : "created",
    dryRun,
    path: openQuestionsPath,
    status,
    question,
  };
}

function resolveKbNotePath({
  kind,
  title,
  requestedPath,
}: {
  kind: string;
  title: string;
  requestedPath: string;
}): string {
  const normalizedRequested = sanitizeRelativePath(requestedPath);
  if (normalizedRequested) {
    if (!normalizedRequested.endsWith(".md")) {
      throw new Error("Note path must end with .md");
    }
    if (kind === "topic" && !normalizedRequested.startsWith("kb/topics/")) {
      throw new Error("Topic notes must be written under kb/topics/");
    }
    if (kind === "term" && !normalizedRequested.startsWith("kb/terms/")) {
      throw new Error("Term notes must be written under kb/terms/");
    }
    return normalizedRequested;
  }

  if (kind === "topic") {
    return `kb/topics/${slugify(title)}.md`;
  }
  return `kb/terms/${toTermFileName(title)}.md`;
}

function renderTopicNote({
  title,
  body,
  module,
  track,
  type,
  status,
  owner,
  updated,
  tags,
}: {
  title: string;
  body: string;
  module: string;
  track: string;
  type: string;
  status: string;
  owner: string;
  updated: string;
  tags: string[] | string | null;
}): string {
  if (body.startsWith("---\n")) {
    return body;
  }
  const normalizedTags = Array.isArray(tags) ? tags.join(", ") : singleLine(tags);
  const frontmatter = [
    "---",
    `module: ${module || "general"}`,
    `track: ${track || "domain"}`,
    `status: ${status || "draft"}`,
    `type: ${type || "concept"}`,
    `owner: ${owner || "kb-mcp-server"}`,
    `updated: ${updated || getTodayIsoDate()}`,
    `tags: ${normalizedTags || "domain, kb-captured"}`,
    "---",
    "",
  ].join("\n");
  const titleHeading = body.startsWith("# ") ? "" : `# ${title}\n\n`;
  return `${frontmatter}${titleHeading}${body.trim()}\n`;
}

function renderTermNote({ title, body }: { title: string; body: string }): string {
  if (body.startsWith("# ")) return body;
  return `# ${title}\n\n${body.trim()}\n`;
}

function buildCapturedNoteBody({
  question,
  grounded,
}: {
  question: string;
  grounded: any;
}): string {
  const answer = typeof grounded?.answer === "string" ? grounded.answer.trim() : "";
  const confidence = grounded?.confidence || {};
  const citations = Array.isArray(grounded?.citations) ? grounded.citations : [];
  const lines: string[] = [];
  lines.push("## Question");
  lines.push(`- ${question}`);
  lines.push("");
  lines.push("## Grounded answer");
  lines.push(answer || "- No grounded answer text was produced.");
  lines.push("");
  lines.push("## Confidence");
  lines.push(`- ${confidence.label || "low"} (${confidence.score ?? "n/a"})`);
  if (confidence.rationale) lines.push(`- rationale: ${confidence.rationale}`);
  lines.push("");
  lines.push("## Evidence");
  if (!citations.length) {
    lines.push("- No citations were returned.");
  } else {
    citations.slice(0, 8).forEach((citation: any) => {
      lines.push(`- ${citation.path}:${citation.line} (score ${citation.score})`);
    });
  }
  lines.push("");
  lines.push("## Last updated");
  lines.push(getTodayIsoDate());
  return lines.join("\n");
}

function inferPrimaryModule(question: unknown, mode: unknown): string {
  const q = normalizeScalar(question).toLowerCase();
  if (mode === "project" || /\bproject\b|\btask\s*\d+\b/.test(q)) return "project-tracking";
  return "general";
}

function inferNoteTitle(question: unknown, kind: string): string {
  const clean = singleLine(question).replace(/\?+$/, "");
  if (kind === "term" && /^[A-Z0-9/_-]{2,20}$/.test(clean)) return clean;
  if (clean.length <= 140) return toTitleCase(clean);
  return toTitleCase(clean.slice(0, 137)) + "...";
}

function inferDefaultTags(mode: unknown, module: string): string[] {
  const tags = ["kb-captured"];
  if (module) tags.push(module);
  if (mode === "project") tags.push("project");
  return [...new Set(tags)];
}

function normalizeResponseMode(value: unknown): string {
  const mode = normalizeScalar(value).toLowerCase();
  if (mode === "fast" || mode === "curate") return mode;
  return "auto";
}

function normalizeTags(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => singleLine(item)).filter(Boolean);
    return normalized.length ? normalized : null;
  }
  const asString = normalizeScalar(value);
  if (!asString) return null;
  const normalized = asString
    .split(",")
    .map((item) => singleLine(item))
    .filter(Boolean);
  return normalized.length ? normalized : null;
}

function normalizeDateString(value: unknown): string {
  const raw = normalizeScalar(value);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  return raw;
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function singleLine(value: unknown): string {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function normalizeTermKey(value: unknown): string {
  return normalizeScalar(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function slugify(value: unknown): string {
  const clean = normalizeScalar(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `note-${Date.now()}`;
}

function toTermFileName(title: unknown): string {
  const cleaned = normalizeScalar(title);
  if (/^[A-Z0-9/_-]{2,24}$/.test(cleaned)) {
    return `${cleaned.replace(/[^A-Z0-9-]+/g, "-")}.md`;
  }
  const words = cleaned
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  const base = words.join("-") || `Term-${Date.now()}`;
  return `${base}.md`;
}

function sanitizeRelativePath(relPath: unknown): string {
  const raw = normalizeScalar(relPath);
  if (!raw) return "";
  const normalized = toPosix(raw.replace(/^\.\/+/, "").replace(/^\/+/, ""));
  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Path traversal is not allowed.");
  }
  return normalized;
}

function resolveRepoPath(relPath: unknown): string {
  const normalized = sanitizeRelativePath(relPath);
  if (!normalized) throw new Error("Missing relative path.");
  const absPath = path.resolve(repoRoot, normalized);
  if (absPath !== repoRoot && !absPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("Resolved path is outside repository root.");
  }
  return absPath;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

let ownershipCache = {
  loadedAt: 0,
  moduleTracks: {} as Record<string, string>,
};

async function resolveTrackForModule(module: unknown, fallbackTrack: string): Promise<string> {
  const moduleKey = normalizeScalar(module);
  if (!moduleKey) return fallbackTrack || "domain";
  const now = Date.now();
  if (!ownershipCache.loadedAt || now - ownershipCache.loadedAt > DEFAULT_CACHE_TTL_MS) {
    const ownershipPath = path.join(repoRoot, "kb", "modules", "topic-ownership.json");
    const ownership = await tryReadJson<OwnershipData>(ownershipPath, {});
    ownershipCache = {
      loadedAt: now,
      moduleTracks:
        ownership?.moduleTracks && typeof ownership.moduleTracks === "object"
          ? ownership.moduleTracks
          : {},
    };
  }
  return normalizeScalar(ownershipCache.moduleTracks[moduleKey]) || fallbackTrack || "domain";
}

function toOpenQuestionRelativeLink(relatedPath: unknown): string {
  const rel = sanitizeRelativePath(relatedPath);
  if (!rel) return "";
  if (!rel.startsWith("kb/")) return rel;
  const fromKbRoot = rel.slice(3);
  return `[${rel}](./${fromKbRoot})`;
}

function toTitleCase(text: unknown): string {
  return singleLine(text)
    .split(" ")
    .filter(Boolean)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function getDocuments(forceRefresh: boolean): Promise<LocalDocument[]> {
  const now = Date.now();
  if (!forceRefresh && docCache.docs.length && now - docCache.loadedAt < DEFAULT_CACHE_TTL_MS) {
    return docCache.docs;
  }

  const docs = await loadDocuments();
  docCache = {
    loadedAt: now,
    docs,
  };
  log("info", `indexed ${docs.length} documents`);
  return docs;
}

async function loadDocuments(): Promise<LocalDocument[]> {
  const roots = parseScanRoots(process.env.KB_MCP_SCAN_ROOTS, DEFAULT_SCAN_ROOTS);
  const candidates = await gatherKnowledgeFiles(repoRoot, roots);
  const docs: LocalDocument[] = [];

  for (const file of candidates) {
    let raw;
    try {
      raw = await fs.readFile(file.absPath, "utf8");
    } catch {
      continue;
    }

    const isMarkdown = file.relPath.endsWith(".md");
    const parsed = isMarkdown
      ? parseFrontmatter(raw)
      : { frontmatter: {} as Record<string, string>, body: raw };
    const body = parsed.body || "";
    const frontmatter = parsed.frontmatter || {};
    const lines = body.split(/\r?\n/);
    docs.push({
      id: docs.length,
      absPath: file.absPath,
      relPath: file.relPath,
      frontmatter,
      body,
      lines,
      title: getDocumentTitle(body, file.relPath),
      track: inferTrack(file.relPath, frontmatter),
      module: normalizeScalar(frontmatter.module),
      sourceKind: inferSourceKind(file.relPath),
      isArchive: file.relPath.startsWith("kb/archive/"),
    });
  }

  docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return docs;
}

function parseScanRoots(raw: string | undefined, defaults: string[]): string[] {
  return normalizeScanRoots(raw || defaults, defaults);
}

function normalizeForMatch(value: unknown): string {
  return normalizeScalar(value).toLowerCase().replace(/\\/g, "/").replace(/\.md$/i, "");
}

function normalizeForSimilarity(value: unknown): string {
  return normalizeScalar(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForSimilarity(value: unknown): string[] {
  const normalized = normalizeForSimilarity(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !SIMILARITY_STOPWORDS.has(token));
}

function tokenOverlapScore(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const minSize = Math.min(setA.size, setB.size);
  if (minSize === 0) return 0;
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap / minSize;
}

function trimSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function roundMs(value: number): number {
  return Number(Number(value || 0).toFixed(2));
}

function resolveSloThreshold(value: unknown): number {
  return parsePositiveInt(value, DEFAULT_SLO_MS, 50, 120 * 1000);
}

function buildSloGuard(totalMs: number, thresholdMs: unknown) {
  const normalizedTotalMs = roundMs(totalMs);
  const normalizedThresholdMs = resolveSloThreshold(thresholdMs);
  const breached = normalizedTotalMs > normalizedThresholdMs;
  const overByMs = breached ? roundMs(normalizedTotalMs - normalizedThresholdMs) : 0;
  return {
    thresholdMs: normalizedThresholdMs,
    totalMs: normalizedTotalMs,
    breached,
    overByMs,
    status: breached ? "breach" : "ok",
  };
}

function attachSloGuardToPayload(payload: ToolPayload, thresholdMs: unknown): ToolPayload {
  if (!payload || typeof payload !== "object") return payload;
  if (!payload.structured || typeof payload.structured !== "object") return payload;

  const timings = payload.structured?.timings || {};
  const totalMs = payload.structured?.timings?.totalMs;
  if (!Number.isFinite(totalMs)) return payload;

  const slo = buildSloGuard(totalMs, thresholdMs);
  payload.structured.slo = slo;
  if (!Array.isArray(payload.structured.warnings)) {
    payload.structured.warnings = [];
  }
  if (slo.breached) {
    payload.structured.warnings.push(
      `SLO breach: total ${slo.totalMs} ms exceeds threshold ${slo.thresholdMs} ms by ${slo.overByMs} ms.`,
    );
  }

  let text = typeof payload.contentText === "string" ? payload.contentText.trimEnd() : "";
  const timingsLine = `Timings (ms): retrieval=${formatTimingValue(timings.retrievalMs)}, synthesis=${formatTimingValue(timings.synthesisMs)}, capture=${formatTimingValue(timings.captureMs)}, total=${formatTimingValue(timings.totalMs)}`;
  const sloLine = `SLO guard: ${slo.status.toUpperCase()} (threshold=${slo.thresholdMs} ms, total=${slo.totalMs} ms${slo.breached ? `, over=${slo.overByMs} ms` : ""})`;
  const injectLines: string[] = [];
  if (!text.includes("Timings (ms):")) injectLines.push(timingsLine);
  if (!text.includes("SLO guard:")) injectLines.push(sloLine);
  if (injectLines.length) {
    text = injectGroundedMetaLines(text, injectLines);
  }
  payload.contentText = text;
  return payload;
}

function injectGroundedMetaLines(text: string, lines: string[]): string {
  const cleanText = typeof text === "string" ? text.trimEnd() : "";
  const inject = lines.filter(Boolean).join("\n");
  if (!inject) return cleanText;

  if (cleanText.startsWith("# kb.answer_grounded") && cleanText.includes("Strict gate:")) {
    return cleanText.replace(/(Strict gate:[^\n]*)(\n|$)/, `$1\n${inject}\n`);
  }
  return `${cleanText}\n\n${inject}`.trim();
}

function formatTimingValue(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${roundMs(numeric)}` : "n/a";
}

function truncateOneLine(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function parseBooleanEnv(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on")
    return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off")
    return false;
  return fallback;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeRetrievalBackend(value: unknown): "bm25" | "sqlite" {
  const backend = normalizeScalar(value).toLowerCase();
  if (backend === "sqlite") return "sqlite";
  return "bm25";
}

function normalizeResponseFormat(value: unknown): ResponseFormat {
  const format = normalizeScalar(value).toLowerCase();
  if (format === "full") return "full";
  if (format === "compact") return "compact";
  return DEFAULT_RESPONSE_FORMAT;
}

function normalizeResponseFormatValue(value: unknown): ResponseFormat {
  const format = normalizeScalar(value).toLowerCase();
  return format === "full" ? "full" : "compact";
}

function assertWriteAllowed({ dryRun, toolName }: { dryRun: boolean; toolName: string }): void {
  if (dryRun || DEFAULT_ENABLE_WRITES) return;
  throw new Error(
    `${toolName} is write-gated. Restart the MCP server with KB_MCP_ENABLE_WRITES=true to allow real KB writes, or pass dryRun=true to preview safely.`,
  );
}

function shapeSearchResult(result: SearchResult, responseFormat: ResponseFormat): any {
  if (responseFormat === "full") return result;
  const shaped = {
    ...result,
    hits: Array.isArray(result?.hits) ? result.hits.map(compactHit) : [],
  };
  if (shaped.debug) {
    shaped.debug = {
      queryTokens: shaped.debug.queryTokens,
      candidateCountBeforeDedupe: shaped.debug.candidateCountBeforeDedupe,
      candidateCountAfterDedupe: shaped.debug.candidateCountAfterDedupe,
      topCandidates: Array.isArray(shaped.debug.topCandidates)
        ? shaped.debug.topCandidates.slice(0, 5).map((item) => ({
            path: item.path,
            lineNumber: item.lineNumber,
            title: item.title,
            score: item.score,
            baseScore: item.baseScore,
            matchedTokens: item.matchedTokens,
            rerankAdjustments: item.rerankAdjustments,
          }))
        : [],
    };
  }
  return shaped;
}

function shapeGroundedPayload(payload: ToolPayload, args: JsonObject): ToolPayload {
  if (normalizeResponseFormat(args?.responseFormat) === "full") return payload;
  if (!payload?.structured || typeof payload.structured !== "object") return payload;

  if (Array.isArray(payload.structured.evidence)) {
    payload.structured.evidence = payload.structured.evidence.map(compactHit);
  }
  if (payload.structured.search?.debug && !args?.debug) {
    payload.structured.search.debug = null;
  }
  if (payload.structured.search?.debug?.topCandidates) {
    payload.structured.search.debug.topCandidates = payload.structured.search.debug.topCandidates
      .slice(0, 5)
      .map((item: any) => ({
        path: item.path,
        lineNumber: item.lineNumber,
        title: item.title,
        score: item.score,
        baseScore: item.baseScore,
        matchedTokens: item.matchedTokens,
        rerankAdjustments: item.rerankAdjustments,
      }));
  }
  return payload;
}

function compactHit(hit: SearchHit | any) {
  return {
    path: hit.path,
    lineNumber: hit.lineNumber,
    endLine: hit.endLine,
    score: hit.score,
    title: hit.title,
    sourceKind: hit.sourceKind,
    track: hit.track,
    module: hit.module,
    snippet: truncateOneLine(hit.snippet || "", 240),
    matchedTokens: Array.isArray(hit.matchedTokens) ? hit.matchedTokens.slice(0, 12) : [],
  };
}

function normalizeLogLevel(level: unknown): LogLevel {
  const candidate = `${level || ""}`.toLowerCase().trim();
  if (candidate in logOrder) return candidate as LogLevel;
  return "error";
}

function log(level: LogLevel, message: string): void {
  if (!(level in logOrder)) return;
  if (logOrder[level] > logOrder[logLevel]) return;
  process.stderr.write(`[kb-mcp:${level}] ${message}\n`);
}

async function tryReadJson<T = unknown>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function createJsonRpcError(code: number, message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: number }).code = code;
  return error;
}

function toJsonRpcErrorCode(error: unknown): number {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (Number.isInteger(code)) return code as number;
  }
  return -32603;
}

function jsonRpcToolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

// Reusable dispatch surface so alternate transports (e.g. the loopback
// Streamable HTTP bridge in server-http.ts) can drive the exact same handlers
// as the stdio server, guaranteeing transport parity.
export { handleRequest, handleNotification };

/**
 * Only auto-start the stdio transport when this module is the process entry
 * point. realpathSync normalizes symlinked paths (e.g. /tmp vs /private/tmp)
 * so the comparison holds under tsx/node and when imported as a library.
 */
function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === __filename;
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  main().catch((error) => {
    log("error", safeErrorMessage(error));
    process.exit(1);
  });
}
