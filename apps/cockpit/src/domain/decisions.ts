import {
  calculateDecisionReviewState,
  parseDecision,
} from "../../../../tools/decisions/decision-parser";
import type {
  DecisionRecord,
  DecisionReviewState,
  DecisionStatus,
} from "../../../../tools/decisions/types";

export type DecisionLedgerFilter = "all" | DecisionReviewState | DecisionStatus;

export interface DecisionSummary {
  decisionId: string;
  title: string;
  projectId?: string;
  status: DecisionStatus;
  owner: string;
  confidence: string;
  evidenceCheckedAt: string;
  reviewAfter: string;
  reviewState: DecisionReviewState;
  path: string;
  tags: string[];
}

export const DECISION_LEDGER_FILTERS: Array<{ key: DecisionLedgerFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due", label: "Due today" },
  { key: "current", label: "Current" },
  { key: "active", label: "Active" },
  { key: "proposed", label: "Proposed" },
  { key: "superseded", label: "Superseded" },
];

export function buildDecisionSummaries(
  docs: Array<{ path: string; title: string; frontmatter?: Record<string, unknown> }>,
  asOf = todayIso(),
): DecisionSummary[] {
  return docs
    .filter(isDecisionDoc)
    .map((doc) => {
      const frontmatter = doc.frontmatter || {};
      const reviewAfter = scalar(frontmatter.review_after);
      return {
        decisionId: scalar(frontmatter.decision_id) || decisionIdFromPath(doc.path),
        title: scalar(frontmatter.title) || doc.title,
        projectId: scalar(frontmatter.project_id) || undefined,
        status: (scalar(frontmatter.status) || "proposed") as DecisionStatus,
        owner: scalar(frontmatter.owner),
        confidence: scalar(frontmatter.confidence),
        evidenceCheckedAt: scalar(frontmatter.evidence_checked_at),
        reviewAfter,
        reviewState: calculateDecisionReviewState(reviewAfter, asOf),
        path: doc.path,
        tags: list(frontmatter.tags),
      };
    })
    .filter((decision) => decision.decisionId && decision.reviewAfter)
    .sort(
      (a, b) =>
        reviewOrder(a.reviewState) - reviewOrder(b.reviewState) ||
        a.reviewAfter.localeCompare(b.reviewAfter) ||
        a.title.localeCompare(b.title),
    );
}

export function filterDecisionSummaries(
  decisions: DecisionSummary[],
  filter: DecisionLedgerFilter,
  query = "",
): DecisionSummary[] {
  const normalizedQuery = query.trim().toLowerCase();
  return decisions.filter((decision) => {
    if (filter !== "all" && decision.reviewState !== filter && decision.status !== filter) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [
      decision.decisionId,
      decision.title,
      decision.projectId,
      decision.owner,
      decision.status,
      decision.confidence,
      ...decision.tags,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
  });
}

export function countDecisionStates(decisions: DecisionSummary[]) {
  return decisions.reduce(
    (counts, decision) => {
      counts[decision.reviewState] += 1;
      counts[decision.status] += 1;
      return counts;
    },
    {
      current: 0,
      due: 0,
      overdue: 0,
      proposed: 0,
      active: 0,
      superseded: 0,
      rejected: 0,
    },
  );
}

export function getDecisionSummary(
  decisions: DecisionSummary[],
  decisionId: string,
): DecisionSummary | null {
  return decisions.find((decision) => decision.decisionId === decisionId) || null;
}

export function parseDecisionDetail(
  raw: string,
  path: string,
  asOf = todayIso(),
  frontmatter?: Record<string, unknown>,
): DecisionRecord {
  const decisionRaw = raw.startsWith("---\n")
    ? raw
    : `---\n${Object.entries(frontmatter || {})
        .map(([key, value]) => `${key}: ${scalar(value).replace(/[\r\n]+/g, " ")}`)
        .join("\n")}\n---\n${raw}`;
  return parseDecision(decisionRaw, path, asOf);
}

export function buildDecisionEvidenceChanges(decision: DecisionRecord) {
  return decision.reviewHistory
    .map((line) => {
      const match = line.match(
        /^(unchanged|strengthened|weakened|contradicted|missing|new):\s+(.+)$/i,
      );
      return match ? { classification: match[1].toLowerCase(), evidence: match[2] } : null;
    })
    .filter((change): change is { classification: string; evidence: string } => change !== null);
}

function isDecisionDoc(doc: { path: string; frontmatter?: Record<string, unknown> }): boolean {
  return (
    scalar(doc.frontmatter?.record_type) === "decision" ||
    /^(?:demo-kb|kb)\/decisions\/[^/]+\.md$/.test(doc.path)
  );
}

function decisionIdFromPath(path: string): string {
  return path.match(/\/decisions\/([^/]+)\.md$/)?.[1] || "";
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return scalar(value[0]);
  return `${value ?? ""}`.trim();
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean);
  return scalar(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function reviewOrder(state: DecisionReviewState): number {
  if (state === "overdue") return 0;
  if (state === "due") return 1;
  return 2;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
