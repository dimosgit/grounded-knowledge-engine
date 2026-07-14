import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AskDrawer } from "../components/AskDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("grounded Ask drawer", () => {
  test("shows grounding details and captures only after an explicit action", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/__gke/ask") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              question: "How does capture routing work?",
              strict: true,
              projectId: "gke-roadmap",
            }),
          }),
        );
        return jsonResponse({
          answer: {
            question: "How does capture routing work?",
            answer: "Routing prefers explicit context and then grounded evidence.",
            abstained: false,
            confidence: { label: "high", score: 0.87, rationale: "Strong local evidence" },
            gate: { pass: true, reasons: [] },
            citations: [{ path: "kb/topics/capture-routing.md", line: 12, score: 18.4 }],
            evidence: [
              {
                path: "kb/topics/capture-routing.md",
                lineNumber: 12,
                score: 18.4,
                title: "Capture routing",
                snippet: "Explicit route fields take precedence.",
              },
            ],
            tokenUsage: {
              kind: "estimate",
              scope: "gke-visible-text",
              requestTokens: 8,
              evidenceTokens: 22,
              answerTokens: 14,
              totalTokens: 44,
            },
          },
        });
      }
      if (url === "/__gke/ask/capture") {
        expect(JSON.parse(String(init?.body))).toEqual({
          question: "How does capture routing work?",
          title: "How does capture routing work",
          kind: "topic",
          projectId: "gke-roadmap",
        });
        return jsonResponse({
          capture: {
            action: "proposed",
            path: "kb/topics/how-does-capture-routing-work.md",
            proposal: { proposalId: "capture-20260713-abcdef123456" },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const onCapture = vi.fn();
    const onReviewProposal = vi.fn();
    const user = userEvent.setup();
    render(
      <AskDrawer
        projectId="gke-roadmap"
        projectTitle="GKE Roadmap"
        onCapture={onCapture}
        onReviewProposal={onReviewProposal}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    expect(screen.getByText("Scope: GKE Roadmap (gke-roadmap)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Question"), "How does capture routing work?");
    await user.click(screen.getByRole("button", { name: "Ask local knowledge" }));

    expect(await screen.findByText(/Routing prefers explicit context/)).toBeInTheDocument();
    expect(screen.getByText("Confidence: high (0.87)")).toBeInTheDocument();
    expect(screen.getByText("Evidence gate passed")).toBeInTheDocument();
    expect(screen.getAllByText(/capture-routing\.md:12 · score 18\.4/)).toHaveLength(2);
    expect(screen.getByText("Explicit route fields take precedence.")).toBeInTheDocument();
    expect(screen.getByText(/Token usage: ~44 visible tokens/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByLabelText("Question"));
    await user.type(screen.getByLabelText("Question"), "A different unsent question");
    await user.click(screen.getByRole("button", { name: "Capture answer" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Queued for review at kb/topics/how-does-capture-routing-work.md.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(onCapture).toHaveBeenCalledWith(
        expect.objectContaining({ action: "proposed", path: expect.stringContaining("topics/") }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Review now" }));
    expect(onReviewProposal).toHaveBeenCalledWith("capture-20260713-abcdef123456");
  });

  test("shows gate reasons and never offers capture for an abstained answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        answer: {
          answer: "Grounded answer withheld.",
          abstained: true,
          confidence: { label: "low", score: 0.15, rationale: "No evidence hits" },
          gate: { pass: false, reasons: ["no evidence hits"] },
          citations: [],
          evidence: [],
        },
      }),
    );

    const user = userEvent.setup();
    render(<AskDrawer />);
    await user.click(screen.getByRole("button", { name: "Ask grounded knowledge" }));
    expect(screen.getByText("Scope: Workspace")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Question"), "What is not documented?");
    await user.click(screen.getByRole("button", { name: "Ask local knowledge" }));

    expect(await screen.findByText("Answer withheld")).toBeInTheDocument();
    expect(screen.getByText("no evidence hits")).toBeInTheDocument();
    expect(screen.getByText("No citations returned.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Capture answer" })).not.toBeInTheDocument();
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
