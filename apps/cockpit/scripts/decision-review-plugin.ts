import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  createDecisionApplicationService,
  type ReviewDecisionInput,
  type ReviewedDecision,
} from "../../../tools/decisions/index.js";
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

const REVIEW_PATH = "/__gke/decisions/review";
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const ALLOWED_KEYS = [
  "decisionId",
  "reviewedAt",
  "reviewAfter",
  "reviewer",
  "recommendationSupported",
  "assumptionsNeedingValidation",
  "evidence",
  "notes",
  "dryRun",
];
const EVIDENCE_KEYS = ["path", "line", "classification", "note"];
const EVIDENCE_CLASSIFICATIONS = new Set([
  "unchanged",
  "strengthened",
  "weakened",
  "contradicted",
  "new",
]);

export interface DecisionReviewPluginOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
  review?: (input: ReviewDecisionInput) => Promise<ReviewedDecision>;
}

type DecisionReviewRequestOptions = Omit<DecisionReviewPluginOptions, "workspace"> & {
  workspace: WorkspaceContext;
};

export function createDecisionReviewPlugin(options: DecisionReviewPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  let workspacePromise: Promise<WorkspaceContext> | null = null;
  const getWorkspace = () =>
    (workspacePromise ??= options.workspace
      ? Promise.resolve(options.workspace)
      : loadWorkspaceContext({ repoRoot }));

  return {
    name: "decision-review-local-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void getWorkspace()
          .then((workspace) =>
            handleDecisionReviewRequest(req, res, {
              ...options,
              repoRoot,
              workspace,
            }),
          )
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Decision review middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Decision review request failed.",
                code: "internal_error",
              });
            } else {
              res.end();
            }
          });
      });
    },
  };
}

export async function handleDecisionReviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: DecisionReviewRequestOptions,
): Promise<boolean> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return false;
  }
  if (requestUrl.pathname !== REVIEW_PATH) return false;

  try {
    assertLocalRequest(getLocalRequestIdentity(req), true);
    if ((req.method || "GET").toUpperCase() !== "POST") throw methodNotAllowed("POST");
    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Decision review",
    });
    assertOnlyKeys(body, ALLOWED_KEYS);
    const reviewInput = parseDecisionReviewBody(body);
    const result = options.review
      ? await options.review(reviewInput)
      : await createDecisionApplicationService({
          repoRoot: options.repoRoot,
          scanRoots: [...options.workspace.scanRoots],
          workspace: options.workspace,
        }).review(reviewInput);
    sendJson(res, 200, { result: formatDecisionReviewResult(result) });
    return true;
  } catch (error) {
    sendDecisionReviewError(res, error);
    return true;
  }
}

function parseDecisionReviewBody(body: Record<string, unknown>): ReviewDecisionInput {
  const recommendationSupported =
    body.recommendationSupported === true || body.recommendationSupported === false
      ? body.recommendationSupported
      : body.recommendationSupported === "uncertain"
        ? "uncertain"
        : null;
  if (recommendationSupported === null) {
    throw new LocalApiRequestError(
      400,
      "invalid_review",
      "recommendationSupported must be true, false, or uncertain.",
    );
  }
  if (!Array.isArray(body.evidence)) {
    throw new LocalApiRequestError(400, "invalid_review", "evidence must be an array.");
  }
  if (
    body.assumptionsNeedingValidation !== undefined &&
    !Array.isArray(body.assumptionsNeedingValidation)
  ) {
    throw new LocalApiRequestError(
      400,
      "invalid_review",
      "assumptionsNeedingValidation must be an array.",
    );
  }
  if (body.dryRun !== true && body.dryRun !== false) {
    throw new LocalApiRequestError(400, "invalid_review", "dryRun must be explicit.");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new LocalApiRequestError(400, "invalid_review", "notes must be a string.");
  }
  const assumptions = Array.isArray(body.assumptionsNeedingValidation)
    ? body.assumptionsNeedingValidation
    : [];
  return {
    decisionId: requiredString(body.decisionId, "decisionId"),
    reviewedAt: requiredString(body.reviewedAt, "reviewedAt"),
    reviewAfter: requiredString(body.reviewAfter, "reviewAfter"),
    reviewer: requiredString(body.reviewer, "reviewer"),
    recommendationSupported,
    assumptionsNeedingValidation: assumptions.map((item) => requiredString(item, "assumption")),
    evidence: body.evidence.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new LocalApiRequestError(400, "invalid_review", "Evidence entries must be objects.");
      }
      const evidence = item as Record<string, unknown>;
      assertOnlyKeys(evidence, EVIDENCE_KEYS);
      const line = Number(evidence.line);
      if (!Number.isSafeInteger(line) || line < 1) {
        throw new LocalApiRequestError(
          400,
          "invalid_review",
          "Evidence line must be a positive integer.",
        );
      }
      const classification =
        evidence.classification === undefined
          ? undefined
          : requiredString(evidence.classification, "evidence classification");
      if (classification && !EVIDENCE_CLASSIFICATIONS.has(classification)) {
        throw new LocalApiRequestError(
          400,
          "invalid_review",
          "Evidence classification is invalid.",
        );
      }
      return {
        path: requiredString(evidence.path, "evidence path"),
        line,
        classification: classification as ReviewDecisionInput["evidence"][number]["classification"],
        note:
          evidence.note === undefined ? undefined : requiredString(evidence.note, "evidence note"),
      };
    }),
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
    dryRun: body.dryRun,
  };
}

function formatDecisionReviewResult(result: ReviewedDecision) {
  return {
    decisionId: result.decisionId,
    path: result.path,
    reviewedAt: result.reviewedAt,
    reviewAfter: result.reviewAfter,
    recommendationSupported: result.recommendationSupported,
    assumptionsNeedingValidation: result.assumptionsNeedingValidation,
    changes: result.changes,
    dryRun: result.dryRun,
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LocalApiRequestError(400, "invalid_review", `${field} is required.`);
  }
  return value.trim();
}

function sendDecisionReviewError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : "";
  if (/workspace is read-only/i.test(message)) {
    sendJson(res, 403, { error: "Workspace is read-only.", code: "workspace_read_only" });
    return;
  }
  if (/decision not found/i.test(message)) {
    sendJson(res, 404, { error: "Decision was not found.", code: "not_found" });
    return;
  }
  if (
    /must|cannot|invalid|requires|outside|citation|evidence|review|decision|canonical/i.test(
      message,
    )
  ) {
    sendJson(res, 400, { error: message, code: "invalid_review" });
    return;
  }
  sendJson(res, 500, { error: "Decision review request failed.", code: "internal_error" });
}
