import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  answerGrounded,
  type GroundedAnswerInput,
  type GroundedAnswerResult,
} from "../../../tools/grounding/answer-service.js";
import { getKbRetriever } from "../../../tools/grounding/retriever.js";
import { getSqliteKbRetriever } from "../../../tools/grounding/sqlite-index.js";
import type { IndexedDocument, SearchHit, SearchResult } from "../../../tools/grounding/types.js";
import {
  captureGroundedAnswer,
  type CaptureGroundedAnswerOptions,
  type CaptureGroundedAnswerResult,
} from "../../../tools/capture/grounded-capture-service.js";
import { CaptureConflictError } from "../../../tools/capture/capture-service.js";
import { getProject, type LoadedProject } from "../../../tools/projects/project-service.js";
import { isDocumentInProject } from "../../../tools/projects/project-scope.js";
import { loadWorkspaceContext } from "../../../tools/workspaces/config.js";
import type { WorkspaceContext } from "../../../tools/workspaces/types.js";
import {
  assertLocalRequest,
  assertOnlyKeys,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  readJsonObject,
  sendJson,
} from "./local-dev-api.js";

const ASK_PATH = "/__gke/ask";
const CAPTURE_PATH = `${ASK_PATH}/capture`;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ASK_KEYS = ["question", "strict", "mode", "track", "module", "projectId"];
const CAPTURE_KEYS = [...ASK_KEYS, "title", "kind", "requestedPath"];

export interface GroundedAskPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
  answer?: (input: GroundedAnswerInput) => Promise<GroundedAnswerResult>;
  capture?: (options: CaptureGroundedAnswerOptions) => Promise<CaptureGroundedAnswerResult>;
}

type GroundedAskRequestOptions = Omit<GroundedAskPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

export function createGroundedAskPlugin(options: GroundedAskPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));
  return {
    name: "grounded-ask-local-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) =>
            handleGroundedAskRequest(req, res, { ...options, repoRoot, workspace }),
          )
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Grounded Ask middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, { error: "Grounded Ask request failed.", code: "internal_error" });
            } else {
              res.end();
            }
          });
      });
    },
  };
}

export async function handleGroundedAskRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: GroundedAskRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== ASK_PATH && requestUrl.pathname !== CAPTURE_PATH) return false;

  try {
    const method = (req.method || "GET").toUpperCase();
    assertLocalRequest(getLocalRequestIdentity(req), true);
    if (method !== "POST") throw methodNotAllowed("POST");
    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Grounded Ask",
    });
    const isCapture = requestUrl.pathname === CAPTURE_PATH;
    assertOnlyKeys(body, isCapture ? CAPTURE_KEYS : ASK_KEYS);
    const question = requiredString(body.question, "question", 3, 2_000);
    const strict = optionalBoolean(body.strict, "strict") ?? true;
    const requestedProjectId = optionalString(body.projectId, "projectId", 120);
    const project = requestedProjectId
      ? await getProject(requestedProjectId, {
          repoRoot: options.repoRoot,
          scanRoots: [...options.workspace.scanRoots],
          workspace: options.workspace,
        })
      : null;
    const projectId = project?.parsed.manifest.projectId;
    const answerInput: GroundedAnswerInput = {
      question,
      strict,
      responseMode: "curate",
      mode: optionalString(body.mode, "mode", 40),
      track: optionalString(body.track, "track", 120),
      module: optionalString(body.module, "module", 120),
      projectId,
    };
    const grounded = options.answer
      ? await options.answer(answerInput)
      : await runGroundedAnswer(options.repoRoot, answerInput, options.workspace, project);

    if (!isCapture) {
      sendJson(res, 200, { answer: shapeGroundedAnswer(grounded) });
      return true;
    }

    const title = requiredString(body.title, "title", 2, 160);
    const kind = optionalEnum(body.kind, "kind", ["topic", "term"] as const) || "topic";
    const captureOptions: CaptureGroundedAnswerOptions = {
      repoRoot: options.repoRoot,
      workspace: options.workspace,
      grounded,
      title,
      kind,
      requestedPath: optionalString(body.requestedPath, "requestedPath", 300),
      track: optionalString(body.track, "track", 120),
      module: optionalString(body.module, "module", 120),
      projectId,
      owner: "cockpit-local",
    };
    const capture = options.capture
      ? await options.capture(captureOptions)
      : await captureGroundedAnswer(captureOptions);
    sendJson(res, capture.action === "created" ? 201 : 202, { capture });
    return true;
  } catch (error) {
    sendGroundedAskError(res, error);
    return true;
  }
}

async function runGroundedAnswer(
  repoRoot: string,
  input: GroundedAnswerInput,
  workspace: WorkspaceContext,
  project: LoadedProject | null,
): Promise<GroundedAnswerResult> {
  const backend = String(input.backend || process.env.KB_MCP_RETRIEVAL_BACKEND || "bm25")
    .trim()
    .toLowerCase();
  const retriever =
    backend === "sqlite"
      ? await getSqliteKbRetriever({ repoRoot, workspace })
      : await getKbRetriever({ repoRoot, workspace });
  const allDocuments = project ? await retriever.getDocuments() : null;
  const scopedDocuments = project ? getProjectDocuments(allDocuments || [], project) : null;
  const allowedPaths = scopedDocuments
    ? new Set(scopedDocuments.map((document) => document.relPath))
    : null;
  return answerGrounded(input, {
    search: async (args) => {
      const result = await retriever.search(
        allowedPaths ? { ...args, limit: 30, disableCache: true } : args,
      );
      return allowedPaths
        ? scopeSearchResult(result, allowedPaths, Number(args.limit) || 8)
        : result;
    },
    listDocuments: async () => scopedDocuments || retriever.getDocuments(),
  });
}

function getProjectDocuments(documents: IndexedDocument[], project: LoadedProject) {
  const { manifest, explicitPaths } = project.parsed;
  return documents.filter((document) =>
    isDocumentInProject(
      document,
      manifest.projectId,
      project.path,
      manifest.sourceRoots,
      explicitPaths,
    ),
  );
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

function shapeGroundedAnswer(answer: GroundedAnswerResult) {
  return {
    question: answer.question,
    answer: answer.answer,
    abstained: answer.abstained,
    confidence: answer.confidence,
    gate: answer.gate,
    citations: answer.citations,
    evidence: answer.evidence.slice(0, 6).map((item) => ({
      path: item.path,
      lineNumber: item.lineNumber,
      endLine: item.endLine,
      title: item.title,
      snippet: item.snippet,
      score: item.score,
      track: item.track,
      module: item.module,
      sourceKind: item.sourceKind,
    })),
    tokenUsage: answer.tokenUsage,
    timings: answer.timings,
  };
}

function requiredString(value: unknown, field: string, minimum: number, maximum: number): string {
  const normalized = optionalString(value, field, maximum);
  if (!normalized || normalized.length < minimum) {
    throw new LocalApiRequestError(
      400,
      `invalid_${field}`,
      `${field} must contain between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new LocalApiRequestError(400, `invalid_${field}`, `${field} is invalid.`);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new LocalApiRequestError(400, `invalid_${field}`, `${field} must be a boolean.`);
  }
  return value;
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new LocalApiRequestError(400, `invalid_${field}`, `${field} is invalid.`);
  }
  return value as T[number];
}

function sendGroundedAskError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof Error && /abstained answer cannot be captured/i.test(error.message)) {
    sendJson(res, 422, { error: error.message, code: "answer_abstained" });
    return;
  }
  if (error instanceof CaptureConflictError) {
    sendJson(res, 409, { error: error.message, code: "capture_conflict" });
    return;
  }
  if (
    error instanceof Error &&
    /unknown project|duplicate project|invalid project/i.test(error.message)
  ) {
    sendJson(res, 400, {
      error: "Project scope is invalid or unavailable.",
      code: "invalid_project",
    });
    return;
  }
  sendJson(res, 500, { error: "Grounded Ask request failed.", code: "internal_error" });
}
