export const OPERATOR_INBOX_KINDS = [
  "all",
  "project",
  "capture",
  "decision",
  "question",
  "change",
] as const;

export const OPERATOR_INBOX_PRIORITIES = ["all", "overdue", "due", "blocked", "review"] as const;

export type OperatorInboxKind = Exclude<(typeof OPERATOR_INBOX_KINDS)[number], "all">;
export type OperatorInboxKindFilter = (typeof OPERATOR_INBOX_KINDS)[number];
export type OperatorInboxPriority = "overdue" | "due" | "blocked" | "review" | "info";
export type OperatorInboxPriorityFilter = (typeof OPERATOR_INBOX_PRIORITIES)[number];

/**
 * Primary Cockpit screens the operator can be routed to. Kept here (rather than
 * in the palette module) so the inbox and the command palette share one
 * navigation contract instead of two incompatible ones.
 */
export const OPERATOR_VIEW_KEYS = [
  "hub",
  "attention",
  "library",
  "projects",
  "decisions",
  "graph",
] as const;

export type OperatorViewKey = (typeof OPERATOR_VIEW_KEYS)[number];

/** Authoritative review surfaces the operator can open. Neither one writes. */
export const OPERATOR_REVIEW_ACTIONS = ["ask", "capture-review"] as const;

export type OperatorReviewAction = (typeof OPERATOR_REVIEW_ACTIONS)[number];

/**
 * A request to open one of the authoritative review drawers. `requestId` makes
 * repeat requests for the same action observable to the drawer.
 */
export interface OperatorActionRequest {
  action: OperatorReviewAction;
  proposalId?: string;
  requestId: number;
}

export type OperatorDestination =
  | { kind: "project"; projectId: string }
  | { kind: "capture"; proposalId: string }
  | { kind: "decision"; decisionId: string }
  | { kind: "document"; path: string }
  | { kind: "view"; view: OperatorViewKey }
  | { kind: "review"; action: OperatorReviewAction };

export interface OperatorInboxItem {
  id: string;
  kind: OperatorInboxKind;
  priority: OperatorInboxPriority;
  title: string;
  summary: string;
  projectId: string | null;
  occurredAt: string | null;
  destination: OperatorDestination;
  sourcePath: string | null;
}

export interface OperatorInboxFilters {
  kind: OperatorInboxKindFilter;
  priority: OperatorInboxPriorityFilter;
  projectId: string;
}

export interface ProjectInboxInput {
  id: string;
  title: string;
  reviewState: string;
  reviewAfter?: string;
  needsAttention: boolean;
  attentionReasons?: string[];
  blockers?: string[];
  openQuestions?: string[];
}

export interface DecisionInboxInput {
  decisionId: string;
  title: string;
  projectId?: string;
  reviewState: string;
  reviewAfter?: string;
  path: string;
}

export interface QuestionInboxInput {
  id: string;
  label: string;
  path: string;
  projectId?: string;
}

export interface CaptureInboxInput {
  proposalId: string;
  title: string;
  createdAt: string;
  proposedAction: string;
  path: string;
  reviewReasons?: string[];
}

export interface ChangeInboxInput {
  path: string;
  title: string;
  changedAt: string;
  source: string;
  projectId: string;
  projectTitle: string;
}

export interface ComposeOperatorInboxInput {
  projects: ProjectInboxInput[];
  decisions: DecisionInboxInput[];
  questions: QuestionInboxInput[];
  captures?: CaptureInboxInput[];
  changes?: ChangeInboxInput[];
}

const PRIORITY_ORDER: Record<OperatorInboxPriority, number> = {
  overdue: 0,
  due: 1,
  blocked: 2,
  review: 3,
  info: 4,
};

const KIND_ORDER: Record<OperatorInboxKind, number> = {
  project: 0,
  capture: 1,
  decision: 2,
  question: 3,
  change: 4,
};

export function composeOperatorInbox({
  projects,
  decisions,
  questions,
  captures = [],
  changes = [],
}: ComposeOperatorInboxInput): OperatorInboxItem[] {
  return [
    ...projects.filter((project) => project.needsAttention).map(projectInboxItem),
    ...captures.map(captureInboxItem),
    ...decisions
      .filter((decision) => decision.reviewState === "overdue" || decision.reviewState === "due")
      .map(decisionInboxItem),
    ...questions.map(questionInboxItem),
    ...changes.map(changeInboxItem),
  ].sort(compareInboxItems);
}

export function filterOperatorInbox(
  items: OperatorInboxItem[],
  filters: OperatorInboxFilters,
): OperatorInboxItem[] {
  return items.filter((item) => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (filters.projectId && item.projectId !== filters.projectId) return false;
    return true;
  });
}

export function countOperatorInbox(items: OperatorInboxItem[]) {
  return items.reduce(
    (counts, item) => {
      counts.total += 1;
      counts[item.kind] += 1;
      counts[item.priority] += 1;
      return counts;
    },
    {
      total: 0,
      project: 0,
      capture: 0,
      decision: 0,
      question: 0,
      change: 0,
      overdue: 0,
      due: 0,
      blocked: 0,
      review: 0,
      info: 0,
    },
  );
}

export type OperatorInboxCounts = ReturnType<typeof countOperatorInbox>;

/**
 * Largest number the navigation badge draws. Higher counts collapse to `99+`
 * so the badge geometry stays fixed; the exact number stays in the accessible
 * name, which is never capped.
 */
export const ATTENTION_BADGE_CAP = 99;

export interface OperatorAttentionBadge {
  /** Exact, uncapped signal count. */
  count: number;
  /** Capped visual text; empty when nothing needs attention. */
  text: string;
  /** Accessible name carrying the exact count for the navigation control. */
  label: string;
}

export function describeAttentionBadge(
  count: number,
  label = "Attention Inbox",
): OperatorAttentionBadge {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return {
    count: total,
    text:
      total === 0 ? "" : total > ATTENTION_BADGE_CAP ? `${ATTENTION_BADGE_CAP}+` : String(total),
    label:
      total === 0 ? `${label}, no signals` : `${label}, ${total} signal${total === 1 ? "" : "s"}`,
  };
}

export function isOperatorInboxKind(value: string): value is OperatorInboxKindFilter {
  return OPERATOR_INBOX_KINDS.includes(value as OperatorInboxKindFilter);
}

export function isOperatorInboxPriority(value: string): value is OperatorInboxPriorityFilter {
  return OPERATOR_INBOX_PRIORITIES.includes(value as OperatorInboxPriorityFilter);
}

export function sanitizeOperatorProjectFilter(value: string): string {
  const normalized = value.trim();
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized) ? normalized : "";
}

function projectInboxItem(project: ProjectInboxInput): OperatorInboxItem {
  const priority =
    project.reviewState === "overdue"
      ? "overdue"
      : project.reviewState === "due"
        ? "due"
        : project.blockers?.length
          ? "blocked"
          : "review";
  return {
    id: `project:${project.id}`,
    kind: "project",
    priority,
    title: project.title,
    summary:
      project.attentionReasons?.filter(Boolean).join(" · ") ||
      "Project context needs operator review.",
    projectId: project.id,
    occurredAt: project.reviewAfter || null,
    destination: { kind: "project", projectId: project.id },
    sourcePath: null,
  };
}

function captureInboxItem(capture: CaptureInboxInput): OperatorInboxItem {
  return {
    id: `capture:${capture.proposalId}`,
    kind: "capture",
    priority: "review",
    title: capture.title,
    summary:
      capture.reviewReasons?.filter(Boolean).join(" · ") ||
      `${humanize(capture.proposedAction)} proposal is waiting for review.`,
    projectId: null,
    occurredAt: capture.createdAt || null,
    destination: { kind: "capture", proposalId: capture.proposalId },
    sourcePath: capture.path || null,
  };
}

function decisionInboxItem(decision: DecisionInboxInput): OperatorInboxItem {
  return {
    id: `decision:${decision.decisionId}`,
    kind: "decision",
    priority: decision.reviewState === "overdue" ? "overdue" : "due",
    title: decision.title,
    summary:
      decision.reviewState === "overdue"
        ? "Evidence review is overdue; confirm the recommendation before reuse."
        : "Evidence review is due today.",
    projectId: decision.projectId || null,
    occurredAt: decision.reviewAfter || null,
    destination: { kind: "decision", decisionId: decision.decisionId },
    sourcePath: decision.path,
  };
}

function questionInboxItem(question: QuestionInboxInput): OperatorInboxItem {
  return {
    id: `question:${question.path}:${stableTextId(question.label || question.id)}`,
    kind: "question",
    priority: "review",
    title: question.label,
    summary: "Open question is waiting for evidence or an explicit decision.",
    projectId: question.projectId || null,
    occurredAt: null,
    destination: { kind: "document", path: question.path },
    sourcePath: question.path,
  };
}

function changeInboxItem(change: ChangeInboxInput): OperatorInboxItem {
  return {
    id: `change:${change.projectId}:${change.path}`,
    kind: "change",
    priority: "info",
    title: change.title,
    summary: `${change.projectTitle} · detected from ${humanize(change.source)}`,
    projectId: change.projectId,
    occurredAt: change.changedAt || null,
    destination: { kind: "document", path: change.path },
    sourcePath: change.path,
  };
}

function compareInboxItems(a: OperatorInboxItem, b: OperatorInboxItem): number {
  return (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    compareDatesDescending(a.occurredAt, b.occurredAt) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.id.localeCompare(b.id)
  );
}

function compareDatesDescending(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

function stableTextId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function humanize(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Pending";
}
