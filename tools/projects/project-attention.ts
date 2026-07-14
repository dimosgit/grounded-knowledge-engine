import type { ProjectReviewState } from "./types.js";

const COMPLETED_STATUSES = new Set(["completed", "complete", "done", "shipped", "delivered"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProjectAttentionInput {
  reviewAfter: string;
  asOf: string;
  status: string;
  blockers?: string[];
  openQuestions?: string[];
}

export interface ProjectAttention {
  reviewState: ProjectReviewState;
  daysUntilReview: number | null;
  needsAttention: boolean;
  attentionReasons: string[];
}

/** Browser-safe daily-attention rules shared by the engine and Cockpit. */
export function calculateProjectAttention(input: ProjectAttentionInput): ProjectAttention {
  const completed = isCompletedProjectStatus(input.status);
  const { reviewState, daysUntilReview } = calculateProjectReviewState(
    input.reviewAfter,
    input.asOf,
    completed,
  );
  const attentionReasons = completed
    ? []
    : buildProjectAttentionReasons(
        reviewState,
        input.reviewAfter,
        input.blockers || [],
        input.openQuestions || [],
      );
  return {
    reviewState,
    daysUntilReview,
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
  };
}

export function isCompletedProjectStatus(status: string): boolean {
  return COMPLETED_STATUSES.has(`${status || ""}`.trim().toLowerCase());
}

export function calculateProjectReviewState(
  reviewAfter: string,
  asOf: string,
  completed = false,
): { reviewState: ProjectReviewState; daysUntilReview: number | null } {
  if (completed) return { reviewState: "not-applicable", daysUntilReview: null };
  if (!isValidIsoDate(reviewAfter)) {
    return { reviewState: "unscheduled", daysUntilReview: null };
  }
  const asOfDate = `${asOf || ""}`.slice(0, 10);
  if (!isValidIsoDate(asOfDate)) {
    throw new Error("asOf must contain a valid ISO date");
  }
  const reviewMs = Date.parse(`${reviewAfter}T00:00:00.000Z`);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const daysUntilReview = Math.round((reviewMs - asOfMs) / DAY_MS);
  return {
    reviewState: daysUntilReview < 0 ? "overdue" : daysUntilReview === 0 ? "due" : "scheduled",
    daysUntilReview,
  };
}

export function buildProjectAttentionReasons(
  reviewState: ProjectReviewState,
  reviewAfter: string,
  blockers: string[],
  openQuestions: string[],
): string[] {
  const reasons: string[] = [];
  if (reviewState === "overdue") reasons.push(`Review overdue since ${reviewAfter}`);
  if (reviewState === "due") reasons.push(`Review due ${reviewAfter}`);
  if (blockers.length) {
    reasons.push(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`);
  }
  if (openQuestions.length) {
    reasons.push(`${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"}`);
  }
  return reasons;
}

export function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
