import { applyUnreviewedCapture, persistCaptureProposal, planCapture } from "./capture-service.js";
import { refreshCaptureRetrievalState } from "./capture-application-service.js";
import type { CaptureCitation, CaptureProposal } from "./types.js";

export interface GroundedCaptureEvidence {
  path: string;
  lineNumber?: number;
  track?: string;
  module?: string;
  score?: number;
}

export interface GroundedAnswerForCapture {
  question: string;
  answer: string;
  abstained: boolean;
  citations: CaptureCitation[];
  evidence: GroundedCaptureEvidence[];
  confidence: Record<string, unknown> | null;
}

export interface CaptureGroundedAnswerOptions {
  repoRoot: string;
  grounded: GroundedAnswerForCapture;
  title: string;
  kind?: "topic" | "term";
  requestedPath?: string;
  track?: string;
  module?: string;
  projectId?: string;
  type?: string;
  status?: string;
  tags?: string[];
  owner?: string;
  dryRun?: boolean;
  refresh?: () => Promise<void>;
}

export interface CaptureGroundedAnswerResult {
  action: "created" | "proposed";
  path: string;
  dryRun: boolean;
  routing: CaptureProposal["routing"];
  proposal: {
    proposalId: string;
    path: string | null;
    requiresReview: true;
    reasons: string[];
    proposedAction: CaptureProposal["proposedAction"];
  } | null;
}

export async function captureGroundedAnswer(
  options: CaptureGroundedAnswerOptions,
): Promise<CaptureGroundedAnswerResult> {
  if (options.grounded.abstained) {
    throw new Error("An abstained answer cannot be captured as canonical knowledge.");
  }
  const title = options.title.trim();
  if (!title) throw new Error("A capture title is required.");
  const kind = options.kind || "topic";
  const plan = await planCapture({
    repoRoot: options.repoRoot,
    sourceOperation: "answer",
    kind,
    title,
    body: buildGroundedCaptureBody(options.grounded),
    requestedPath: options.requestedPath,
    track: options.track,
    module: options.module,
    projectId: options.projectId,
    type: options.type || (kind === "topic" ? "concept" : undefined),
    status: options.status || (kind === "topic" ? "draft" : undefined),
    tags: options.tags,
    owner: options.owner || "cockpit-local",
    evidenceCitations: options.grounded.citations,
    evidenceRoutes: options.grounded.evidence.map((item) => ({
      path: item.path,
      track: item.track,
      module: item.module,
      score: item.score,
    })),
    groundedConfidence: options.grounded.confidence,
    persist: false,
  });

  if (plan.proposal.requiresReview) {
    const proposalPath = options.dryRun
      ? null
      : await persistCaptureProposal(options.repoRoot, plan.proposal);
    return {
      action: "proposed",
      path: plan.proposal.proposedNote.path,
      dryRun: Boolean(options.dryRun),
      routing: plan.proposal.routing,
      proposal: {
        proposalId: plan.proposal.proposalId,
        path: proposalPath,
        requiresReview: true,
        reasons: plan.proposal.reviewReasons,
        proposedAction: plan.proposal.proposedAction,
      },
    };
  }

  const applied = await applyUnreviewedCapture(options.repoRoot, plan.proposal, {
    dryRun: options.dryRun,
    refresh:
      options.refresh ||
      (async () => {
        await refreshCaptureRetrievalState(options.repoRoot);
      }),
  });
  return {
    action: "created",
    path: applied.path,
    dryRun: applied.dryRun,
    routing: plan.proposal.routing,
    proposal: null,
  };
}

export function buildGroundedCaptureBody(grounded: GroundedAnswerForCapture): string {
  const lines = [
    "## Question",
    `- ${singleLine(grounded.question)}`,
    "",
    "## Grounded answer",
    grounded.answer.trim(),
    "",
    "## Confidence",
    `- ${String(grounded.confidence?.label || "unknown")} (${String(grounded.confidence?.score ?? "n/a")})`,
    "",
    "## Evidence",
  ];
  if (!grounded.citations.length) {
    lines.push("- No citations were returned.");
  } else {
    for (const citation of grounded.citations.slice(0, 8)) {
      lines.push(
        `- ${citation.path}${citation.line ? `:${citation.line}` : ""}${Number.isFinite(citation.score) ? ` (score ${citation.score})` : ""}`,
      );
    }
  }
  lines.push("", "## Last updated", new Date().toISOString().slice(0, 10));
  return lines.join("\n");
}

function singleLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
