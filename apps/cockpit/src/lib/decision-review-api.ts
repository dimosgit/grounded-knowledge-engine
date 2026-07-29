import type {
  DecisionEvidenceChangeRecord,
  DecisionEvidenceReviewInput,
} from "../../../../tools/decisions/types";

const DECISION_REVIEW_PATH = "/__gke/decisions/review";

export interface DecisionReviewRequest {
  decisionId: string;
  reviewedAt: string;
  reviewAfter: string;
  reviewer: string;
  recommendationSupported: boolean | "uncertain";
  assumptionsNeedingValidation: string[];
  evidence: DecisionEvidenceReviewInput[];
  notes?: string;
  dryRun: boolean;
}

export interface DecisionReviewResponse {
  result: {
    decisionId: string;
    path: string;
    reviewedAt: string;
    reviewAfter: string;
    recommendationSupported: boolean | "uncertain";
    assumptionsNeedingValidation: string[];
    changes: DecisionEvidenceChangeRecord[];
    dryRun: boolean;
  };
}

export class DecisionReviewApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "DecisionReviewApiError";
  }
}

export async function submitDecisionReview(
  input: DecisionReviewRequest,
): Promise<DecisionReviewResponse["result"]> {
  const response = await fetch(DECISION_REVIEW_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<DecisionReviewResponse> & {
    error?: string;
    code?: string;
  };
  if (!response.ok || !payload.result) {
    throw new DecisionReviewApiError(
      payload.error || `Decision review request failed (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload.result;
}
