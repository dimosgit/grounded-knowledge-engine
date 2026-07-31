import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildDecisionEvidenceChanges,
  buildDecisionSummaries,
  filterDecisionSummaries,
  parseDecisionDetail,
} from "../domain/decisions";
import { DecisionLedgerView } from "../views/DecisionLedgerView";
import { DecisionReplayView } from "../views/DecisionReplayView";

const rawDecision = `---
schema_version: 1
record_type: decision
workspace_id: demo
decision_id: pilot-location
title: Select the First Pilot Location
status: active
owner: demo-workspace
decided_at: 2026-05-15
evidence_checked_at: 2026-06-01
review_after: 2026-07-15
confidence: medium
updated: 2026-06-01
tags: demo, decision-replay
---

# Select the First Pilot Location

## Decision question

Which location should host the pilot?

## Recommendation

Use Valencia with a scheduling buffer.

## Alternatives considered

- Málaga
- Lisbon

## Rationale

Valencia has the best balance of readiness and cost.

## Assumptions

- The partner preserves a scheduling buffer.

## Risks and caveats

- A narrower launch window weakens the plan.

## Evidence snapshot

- demo-kb/sources/pilot-location-evidence.md:13 — Initial comparison

## Review history

### Review 2026-06-01

- Reviewer: demo-workspace
- Recommendation supported: yes
- Evidence changes:
  - weakened: demo-kb/sources/pilot-location-evidence.md:21 — Launch window narrowed.

## Supersession

- None recorded.
`;

const docs = [
  {
    path: "demo-kb/decisions/pilot-location.md",
    title: "Select the First Pilot Location",
    frontmatter: {
      record_type: "decision",
      decision_id: "pilot-location",
      title: "Select the First Pilot Location",
      status: "active",
      owner: "demo-workspace",
      confidence: "medium",
      evidence_checked_at: "2026-06-01",
      review_after: "2026-07-15",
      tags: "demo, decision-replay",
    },
  },
];

const commonViewProps = {
  palette: {
    entries: [],
    recentIds: [],
    isOpen: false,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  },
  onCommand: vi.fn(),
  onHub: vi.fn(),
  onLibrary: vi.fn(),
  onProjects: vi.fn(),
  onGraph: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Decision Replay", () => {
  test("derives an overdue ledger and filters it deterministically", () => {
    const decisions = buildDecisionSummaries(docs, "2026-07-29");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decisionId: "pilot-location",
      reviewState: "overdue",
      evidenceCheckedAt: "2026-06-01",
    });
    expect(filterDecisionSummaries(decisions, "overdue")).toHaveLength(1);
    expect(filterDecisionSummaries(decisions, "current")).toHaveLength(0);
    expect(filterDecisionSummaries(decisions, "all", "pilot")).toHaveLength(1);
  });

  test("uses the shared parser and preserves the original snapshot beside classified changes", () => {
    const decision = parseDecisionDetail(
      rawDecision,
      "demo-kb/decisions/pilot-location.md",
      "2026-07-29",
    );
    expect(decision.reviewState).toBe("overdue");
    expect(decision.evidence).toEqual([
      {
        path: "demo-kb/sources/pilot-location-evidence.md",
        line: 13,
        section: "Initial comparison",
      },
    ]);
    expect(buildDecisionEvidenceChanges(decision)).toEqual([
      {
        classification: "weakened",
        evidence: "demo-kb/sources/pilot-location-evidence.md:21 — Launch window narrowed.",
      },
    ]);
  });

  test("rejoins catalog frontmatter with a lazily loaded Markdown body", () => {
    const body = rawDecision.slice(rawDecision.indexOf("\n---\n", 4) + 5);
    const decision = parseDecisionDetail(
      body,
      "demo-kb/decisions/pilot-location.md",
      "2026-07-29",
      {
        schema_version: "1",
        record_type: "decision",
        workspace_id: "demo",
        decision_id: "pilot-location",
        title: "Select the First Pilot Location",
        status: "active",
        owner: "demo-workspace",
        decided_at: "2026-05-15",
        evidence_checked_at: "2026-06-01",
        review_after: "2026-07-15",
        confidence: "medium",
        updated: "2026-06-01",
        tags: "demo, decision-replay",
      },
    );

    expect(decision.decisionId).toBe("pilot-location");
    expect(decision.recommendation).toBe("Use Valencia with a scheduling buffer.");
  });

  test("opens a decision from the ledger", async () => {
    const user = userEvent.setup();
    const decisions = buildDecisionSummaries(docs, "2026-07-29");
    const onOpenDecision = vi.fn();
    render(
      <DecisionLedgerView
        {...commonViewProps}
        decisions={decisions}
        counts={{
          overdue: 1,
          due: 0,
          current: 0,
          active: 1,
          proposed: 0,
          superseded: 0,
        }}
        filter="all"
        onFilterChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onOpenDecision={onOpenDecision}
      />,
    );
    expect(screen.getByText("Decision Ledger")).toBeInTheDocument();
    expect(screen.getByText(/1 overdue and 0 due today/i)).toBeInTheDocument();
    await user.click(screen.getByText("Select the First Pilot Location"));
    expect(onOpenDecision).toHaveBeenCalledWith("pilot-location");
  });

  test("surfaces stale evidence and the local review workflow", async () => {
    const user = userEvent.setup();
    const onReviewApplied = vi.fn();
    const decisionRequests: RequestInit[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (`${url}` === "/__gke/capture/proposals") {
        return jsonResponse({ proposals: [] });
      }
      if (`${url}` !== "/__gke/decisions/review") {
        throw new Error(`Unexpected request: ${url}`);
      }
      decisionRequests.push(init || {});
      const request = JSON.parse(`${init?.body}`) as { dryRun: boolean };
      return jsonResponse({
        result: {
          decisionId: "pilot-location",
          path: "demo-kb/decisions/pilot-location.md",
          reviewedAt: "2026-07-29",
          reviewAfter: "2026-08-28",
          recommendationSupported: "uncertain",
          assumptionsNeedingValidation: [],
          changes: request.dryRun
            ? [
                {
                  classification: "unchanged",
                  current: {
                    path: "demo-kb/sources/pilot-location-evidence.md",
                    line: 13,
                    section: "Initial comparison",
                  },
                },
              ]
            : [],
          dryRun: request.dryRun,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const summary = buildDecisionSummaries(docs, "2026-07-29")[0];
    const decision = parseDecisionDetail(
      rawDecision,
      "demo-kb/decisions/pilot-location.md",
      "2026-07-29",
    );
    render(
      <DecisionReplayView
        {...commonViewProps}
        summary={summary}
        decision={decision}
        bodyStatus="ready"
        bodyError=""
        onRetryBody={vi.fn()}
        onReviewApplied={onReviewApplied}
        onBack={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.getByText(/Stale decision/i)).toBeInTheDocument();
    expect(screen.getByText("Original snapshot")).toBeInTheDocument();
    expect(screen.getByText("What changed")).toBeInTheDocument();
    expect(screen.getByText("weakened")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /review what changed/i }));
    expect(screen.getByRole("button", { name: /apply reviewed change/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /preview review/i }));
    expect(await screen.findByText("Validated preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply reviewed change/i })).toBeEnabled();
    expect(JSON.parse(`${decisionRequests[0].body}`)).toMatchObject({
      decisionId: "pilot-location",
      dryRun: true,
    });
    await user.click(screen.getByRole("button", { name: /apply reviewed change/i }));
    expect(await screen.findByText(/Review appended to canonical Markdown/i)).toBeInTheDocument();
    expect(JSON.parse(`${decisionRequests[1].body}`)).toMatchObject({
      decisionId: "pilot-location",
      dryRun: false,
    });
    expect(onReviewApplied).toHaveBeenCalledOnce();
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
