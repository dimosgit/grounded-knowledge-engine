import { describe, expect, test } from "vitest";
import {
  composeOperatorInbox,
  countOperatorInbox,
  filterOperatorInbox,
  isOperatorInboxKind,
  isOperatorInboxPriority,
  sanitizeOperatorProjectFilter,
} from "../domain/operator-inbox";

describe("operator inbox domain", () => {
  const items = composeOperatorInbox({
    projects: [
      {
        id: "router-rollout",
        title: "Router Rollout",
        reviewState: "overdue",
        reviewAfter: "2026-07-06",
        needsAttention: true,
        attentionReasons: ["Review overdue"],
        blockers: ["Access pending"],
      },
      {
        id: "quiet-project",
        title: "Quiet Project",
        reviewState: "current",
        needsAttention: false,
      },
    ],
    captures: [
      {
        proposalId: "capture-1",
        title: "Retry policy",
        createdAt: "2026-07-29T12:00:00Z",
        proposedAction: "append",
        path: "kb/topics/retry-policy.md",
        reviewReasons: ["Possible duplicate"],
      },
    ],
    decisions: [
      {
        decisionId: "pilot-location",
        title: "Pilot location",
        projectId: "router-rollout",
        reviewState: "due",
        reviewAfter: "2026-07-30",
        path: "kb/decisions/pilot-location.md",
      },
      {
        decisionId: "current-decision",
        title: "Current decision",
        reviewState: "current",
        reviewAfter: "2026-09-01",
        path: "kb/decisions/current-decision.md",
      },
    ],
    questions: [
      {
        id: "open-question-0",
        label: "Which rollout window is safest?",
        path: "kb/open_questions.md",
      },
    ],
    changes: [
      {
        path: "kb/sources/router-evidence.md",
        title: "Router evidence",
        changedAt: "2026-07-28T08:00:00Z",
        source: "git",
        projectId: "router-rollout",
        projectTitle: "Router Rollout",
      },
    ],
  });

  test("composes all five signals with stable urgency ordering", () => {
    expect(items.map((item) => item.id)).toEqual([
      "project:router-rollout",
      "decision:pilot-location",
      "capture:capture-1",
      "question:kb/open_questions.md:which-rollout-window-is-safest",
      "change:router-rollout:kb/sources/router-evidence.md",
    ]);
    expect(countOperatorInbox(items)).toMatchObject({
      total: 5,
      project: 1,
      capture: 1,
      decision: 1,
      question: 1,
      change: 1,
    });
  });

  test("filters by kind, urgency, and explicit project", () => {
    expect(
      filterOperatorInbox(items, {
        kind: "all",
        priority: "overdue",
        projectId: "router-rollout",
      }).map((item) => item.id),
    ).toEqual(["project:router-rollout"]);
    expect(
      filterOperatorInbox(items, {
        kind: "change",
        priority: "all",
        projectId: "",
      }).map((item) => item.id),
    ).toEqual(["change:router-rollout:kb/sources/router-evidence.md"]);
  });

  test("fails malformed route filters closed", () => {
    expect(isOperatorInboxKind("capture")).toBe(true);
    expect(isOperatorInboxKind("write")).toBe(false);
    expect(isOperatorInboxPriority("blocked")).toBe(true);
    expect(isOperatorInboxPriority("critical")).toBe(false);
    expect(sanitizeOperatorProjectFilter("router-rollout")).toBe("router-rollout");
    expect(sanitizeOperatorProjectFilter("../../private")).toBe("");
    expect(sanitizeOperatorProjectFilter("project id")).toBe("");
  });
});
