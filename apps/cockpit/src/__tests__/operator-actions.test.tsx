import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OperatorActions } from "../components/OperatorActions";
import { PublicOperatorActions } from "../components/PublicOperatorActions";
import type { OperatorAttention } from "../hooks/useOperatorAttention";
import { AttentionBadgeProbe, AttentionHarness } from "./support/attention-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("local operator actions", () => {
  test("refreshes the badge after capture and opens the exact proposal from Review now", async () => {
    const proposalId = "capture-20260714123000-abcdef123456";
    let listCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/proposals") && (!init?.method || init.method === "GET")) {
        listCount += 1;
        return jsonResponse({ proposals: listCount === 1 ? [] : [proposalSummary(proposalId)] });
      }
      if (url === "/__gke/ask") {
        expect(JSON.parse(String(init?.body))).toEqual({
          question: "How should this be routed?",
          strict: true,
          projectId: "project-a",
        });
        return jsonResponse({ answer: groundedAnswer() });
      }
      if (url === "/__gke/ask/capture") {
        expect(JSON.parse(String(init?.body))).toEqual({
          question: "How should this be routed?",
          title: "How should this be routed",
          kind: "topic",
          projectId: "project-a",
        });
        return jsonResponse({
          capture: {
            action: "proposed",
            path: "kb/topics/how-should-this-be-routed.md",
            proposal: { proposalId },
          },
        });
      }
      if (url.endsWith(`/proposals/${proposalId}`)) {
        return jsonResponse(proposalPreview(proposalId));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const user = userEvent.setup();
    render(
      <AttentionHarness>
        <OperatorActions projectId="project-a" projectTitle="Project A" />
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );
    await waitFor(() => expect(listCount).toBe(1));
    expect(screen.queryByText("Capture review queue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    expect(screen.getByText("Scope: Project A (project-a)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Question"), "How should this be routed?");
    await user.click(screen.getByRole("button", { name: "Ask local knowledge" }));
    await screen.findByText("Grounded project answer.");
    await user.click(screen.getByRole("button", { name: "Capture answer" }));

    expect(await screen.findByRole("button", { name: "Review now" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open capture review queue" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open capture review queue", hidden: true }),
      ).toHaveTextContent("1"),
    );
    // Queue badge and Attention badge are the same state, refreshed exactly once.
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("1");
    expect(screen.getByTestId("probe-selected")).toHaveTextContent(proposalId);
    expect(listCount).toBe(2);
    expect(screen.queryByText("Capture review queue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review now" }));
    expect(await screen.findByRole("heading", { name: "Exact proposed note" })).toBeInTheDocument();
    expect(screen.getByText("Proposed body for the selected proposal")).toBeInTheDocument();
  });

  test("resets Ask state when scope changes from one project to another and then workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ proposals: [] }));
    const user = userEvent.setup();
    const { rerender } = render(
      <AttentionHarness>
        <OperatorActions projectId="project-a" projectTitle="Project A" />
      </AttentionHarness>,
    );

    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    await user.type(screen.getByLabelText("Question"), "Project A draft question");
    expect(screen.getByText("Scope: Project A (project-a)")).toBeInTheDocument();

    rerender(
      <AttentionHarness>
        <OperatorActions projectId="project-b" projectTitle="Project B" />
      </AttentionHarness>,
    );
    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    expect(screen.getByText("Scope: Project B (project-b)")).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("");

    rerender(
      <AttentionHarness>
        <OperatorActions />
      </AttentionHarness>,
    );
    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    expect(screen.getByText("Scope: Workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("");
  });

  test("opens the exact capture requested from the Attention inbox", async () => {
    const proposalId = "capture-20260730123000-attention";
    const otherId = "capture-20260730123000-other";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/proposals")) {
        return jsonResponse({
          proposals: [proposalSummary(otherId), proposalSummary(proposalId)],
        });
      }
      if (url.endsWith(`/proposals/${proposalId}`)) {
        return jsonResponse(proposalPreview(proposalId));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    let attention: OperatorAttention | undefined;

    render(
      <AttentionHarness onAttention={(value) => (attention = value)}>
        <OperatorActions />
      </AttentionHarness>,
    );
    await waitFor(() => expect(attention?.proposalStatus).toBe("ready"));

    // The inbox row and the command palette both go through this one entry point.
    await act(async () => {
      attention?.requestCaptureReview(proposalId);
    });

    expect(await screen.findByRole("heading", { name: "Exact proposed note" })).toBeInTheDocument();
    expect(screen.getByText("Proposed body for the selected proposal")).toBeInTheDocument();
  });
});

describe("hosted preview operator actions", () => {
  test("opens both read-only review destinations without making a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const { rerender } = render(
      <PublicOperatorActions request={{ action: "ask", requestId: 1 }} />,
    );

    expect(
      await screen.findByRole("dialog", { name: "Ask grounded knowledge" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hosted preview · read-only")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close Ask grounded knowledge" }));
    expect(
      screen.queryByRole("dialog", { name: "Ask grounded knowledge" }),
    ).not.toBeInTheDocument();

    rerender(<PublicOperatorActions request={{ action: "capture-review", requestId: 2 }} />);
    expect(await screen.findByRole("dialog", { name: "Capture review queue" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function proposalSummary(proposalId: string) {
  return {
    proposalId,
    createdAt: "2026-07-14T12:30:00.000Z",
    sourceOperation: "answer",
    proposedAction: "replace",
    kind: "topic",
    title: "Exact proposed note",
    path: "kb/topics/how-should-this-be-routed.md",
    requiresReview: true,
    reviewReasons: ["existing-target"],
    duplicateCandidateCount: 0,
  };
}

function proposalPreview(proposalId: string) {
  return {
    proposal: {
      proposalId,
      createdAt: "2026-07-14T12:30:00.000Z",
      proposedAction: "replace",
      proposedNote: {
        kind: "topic",
        title: "Exact proposed note",
        path: "kb/topics/how-should-this-be-routed.md",
        track: "platform",
        module: "capture",
        projectId: "project-a",
        body: "Proposed body for the selected proposal",
      },
      duplicateCandidates: [],
      evidenceCitations: [],
      groundedConfidence: { label: "high" },
      requiresReview: true,
      reviewReasons: ["existing-target"],
    },
    preview: {
      targetExists: true,
      currentContent: "Current body",
      proposedContent: "Proposed body for the selected proposal",
      currentContentHash: "abc",
      stale: false,
    },
  };
}

function groundedAnswer() {
  return {
    answer: "Grounded project answer.",
    abstained: false,
    confidence: { label: "high", score: 0.9, rationale: "Project evidence" },
    gate: { pass: true, reasons: [] },
    citations: [],
    evidence: [],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
