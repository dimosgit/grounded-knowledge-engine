import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  CaptureConflictError,
  applyCaptureProposal,
  listCaptureProposals,
  previewCaptureProposal,
  rejectCaptureProposal,
} from "../../../tools/capture/capture-service.js";
import { applyCaptureProposalAndRefresh } from "../../../tools/capture/capture-application-service.js";
import type { CaptureAction, CaptureProposal } from "../../../tools/capture/types.js";
import {
  assertLocalRequest,
  assertOnlyKeys,
  getLocalRequestIdentity,
  LocalApiRequestError,
  methodNotAllowed,
  readJsonObject,
  sendJson,
} from "./local-dev-api.js";

export { assertLocalRequest } from "./local-dev-api.js";

const API_ROOT = "/__gke/capture";
const PROPOSALS_PATH = `${API_ROOT}/proposals`;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const CAPTURE_ACTIONS = new Set<CaptureAction>(["create", "append", "replace", "open_question"]);

export interface CaptureReviewPluginOptions {
  repoRoot: string;
  refreshIndex?: () => Promise<void>;
}

export function createCaptureReviewPlugin(options: CaptureReviewPluginOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);

  return {
    name: "capture-review-local-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void handleCaptureReviewRequest(req, res, {
          repoRoot,
          ...(options.refreshIndex ? { refreshIndex: options.refreshIndex } : {}),
        })
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `Capture review middleware failed: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: "Capture review request failed.",
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

export async function handleCaptureReviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CaptureReviewPluginOptions,
): Promise<boolean> {
  const rawUrl = req.url || "/";
  if (!rawUrl.startsWith(API_ROOT)) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl, "http://localhost");
  } catch {
    sendJson(res, 400, { error: "Capture review URL is invalid.", code: "invalid_url" });
    return true;
  }

  try {
    const method = (req.method || "GET").toUpperCase();
    assertLocalRequest(getLocalRequestIdentity(req), method !== "GET" && method !== "HEAD");

    if (requestUrl.pathname === PROPOSALS_PATH) {
      if (method !== "GET") throw methodNotAllowed("GET");
      const proposals = await listCaptureProposals(options.repoRoot);
      sendJson(res, 200, { proposals: proposals.map(toProposalSummary) });
      return true;
    }

    const route = parseProposalRoute(requestUrl.pathname);
    if (!route) {
      sendJson(res, 404, { error: "Capture review route not found.", code: "not_found" });
      return true;
    }

    if (!route.operation) {
      if (method !== "GET") throw methodNotAllowed("GET");
      const review = await previewCaptureProposal(options.repoRoot, route.proposalId);
      sendJson(res, 200, {
        proposal: review.proposal,
        preview: {
          targetExists: review.targetExists,
          currentContent: review.currentContent,
          proposedContent: review.proposedContent,
          currentContentHash: review.currentContentHash,
          stale: review.stale,
        },
      });
      return true;
    }

    if (method !== "POST") throw methodNotAllowed("POST");
    const body = await readJsonObject(req, {
      maxBytes: MAX_REQUEST_BODY_BYTES,
      resourceLabel: "Capture review",
    });

    if (route.operation === "apply") {
      assertOnlyKeys(body, ["action"]);
      const action = body.action;
      if (typeof action !== "string" || !CAPTURE_ACTIONS.has(action as CaptureAction)) {
        throw new LocalApiRequestError(
          400,
          "invalid_action",
          "An explicit valid action is required.",
        );
      }
      const applyOptions = {
        repoRoot: options.repoRoot,
        proposalId: route.proposalId,
        action: action as CaptureAction,
      };
      const result = options.refreshIndex
        ? await applyCaptureProposal({ ...applyOptions, refresh: options.refreshIndex })
        : await applyCaptureProposalAndRefresh(applyOptions);
      sendJson(res, 200, { result });
      return true;
    }

    assertOnlyKeys(body, []);
    const result = await rejectCaptureProposal(options.repoRoot, route.proposalId);
    sendJson(res, 200, { result });
    return true;
  } catch (error) {
    sendCaptureError(res, error);
    return true;
  }
}

function parseProposalRoute(
  pathname: string,
): { proposalId: string; operation: "apply" | "reject" | null } | null {
  const suffix = pathname.slice(`${PROPOSALS_PATH}/`.length);
  if (!pathname.startsWith(`${PROPOSALS_PATH}/`) || !suffix) return null;
  const parts = suffix.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  let proposalId: string;
  try {
    proposalId = decodeURIComponent(parts[0]);
  } catch {
    throw new LocalApiRequestError(400, "invalid_proposal_id", "Capture proposal ID is invalid.");
  }
  if (parts.length === 1) return { proposalId, operation: null };
  if (parts[1] === "apply" || parts[1] === "reject") {
    return { proposalId, operation: parts[1] };
  }
  return null;
}

function toProposalSummary(proposal: CaptureProposal) {
  return {
    proposalId: proposal.proposalId,
    createdAt: proposal.createdAt,
    sourceOperation: proposal.sourceOperation,
    proposedAction: proposal.proposedAction,
    kind: proposal.proposedNote.kind,
    title: proposal.proposedNote.title,
    path: proposal.proposedNote.path,
    requiresReview: proposal.requiresReview,
    reviewReasons: proposal.reviewReasons,
    duplicateCandidateCount: proposal.duplicateCandidates.length,
  };
}

function sendCaptureError(res: ServerResponse, error: unknown): void {
  if (error instanceof LocalApiRequestError) {
    sendJson(res, error.statusCode, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof CaptureConflictError) {
    sendJson(res, 409, { error: error.message, code: "capture_conflict" });
    return;
  }
  if (error instanceof Error && /capture proposal not found/i.test(error.message)) {
    sendJson(res, 404, { error: error.message, code: "not_found" });
    return;
  }
  if (
    error instanceof Error &&
    /invalid capture proposal id|unsupported capture action|must target|must be written/i.test(
      error.message,
    )
  ) {
    sendJson(res, 400, { error: error.message, code: "invalid_request" });
    return;
  }
  sendJson(res, 500, { error: "Capture review request failed.", code: "internal_error" });
}
