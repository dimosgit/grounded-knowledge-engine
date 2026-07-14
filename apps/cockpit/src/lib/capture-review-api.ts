const CAPTURE_REVIEW_ROOT = "/__gke/capture/proposals";

export type CaptureAction = "create" | "append" | "replace" | "delete" | "open_question";

export interface CaptureProposalSummary {
  proposalId: string;
  createdAt: string;
  sourceOperation: "answer" | "ingest" | "upsert";
  proposedAction: CaptureAction;
  kind: "topic" | "term";
  title: string;
  path: string;
  requiresReview: boolean;
  reviewReasons: string[];
  duplicateCandidateCount: number;
}

interface CaptureRouteField {
  value: string | null;
  source: string | null;
  candidates: Array<{ value: string; source: string; paths: string[] }>;
}

export interface CaptureProposal {
  proposalId: string;
  createdAt: string;
  proposedAction: CaptureAction;
  proposedNote: {
    kind: "topic" | "term";
    title: string;
    path: string;
    track: string | null;
    module: string | null;
    projectId: string | null;
    body: string;
  };
  duplicateCandidates: Array<{
    path: string;
    title: string;
    matchReason: string;
    score: number;
  }>;
  evidenceCitations: Array<{ path: string; line?: number; score?: number }>;
  groundedConfidence: Record<string, unknown> | null;
  routing?: {
    status: "resolved" | "review_required";
    fields: {
      path: CaptureRouteField;
      track: CaptureRouteField;
      module: CaptureRouteField;
      projectId: CaptureRouteField;
    };
    reviewReasons: string[];
  };
  requiresReview: boolean;
  reviewReasons: string[];
}

export interface CaptureProposalPreview {
  proposal: CaptureProposal;
  preview: {
    targetExists: boolean;
    currentContent?: string;
    proposedContent: string;
    currentContentHash: string | null;
    baseContentHashMatches?: boolean;
    stale?: boolean;
  };
}

export class CaptureReviewApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "CaptureReviewApiError";
  }
}

export async function listCaptureProposals(): Promise<CaptureProposalSummary[]> {
  const payload = await request<{ proposals: CaptureProposalSummary[] }>(CAPTURE_REVIEW_ROOT);
  return payload.proposals;
}

export function getCaptureProposal(proposalId: string): Promise<CaptureProposalPreview> {
  return request(`${CAPTURE_REVIEW_ROOT}/${encodeURIComponent(proposalId)}`);
}

export async function applyCaptureProposal(
  proposalId: string,
  action: CaptureAction,
): Promise<void> {
  await request(`${CAPTURE_REVIEW_ROOT}/${encodeURIComponent(proposalId)}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function rejectCaptureProposal(proposalId: string): Promise<void> {
  await request(`${CAPTURE_REVIEW_ROOT}/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new CaptureReviewApiError(
      payload.error || `Capture review request failed (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload as T;
}
