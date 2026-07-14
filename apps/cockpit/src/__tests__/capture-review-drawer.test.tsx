import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureReviewDrawer } from "../components/CaptureReviewDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("capture review drawer", () => {
  test("loads a proposal and requires an explicit action before applying", async () => {
    const proposalId = "capture-20260713090000-abcdef123456";
    let listCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/proposals") && (!init?.method || init.method === "GET")) {
        listCount += 1;
        return jsonResponse({
          proposals:
            listCount === 1
              ? [
                  {
                    proposalId,
                    createdAt: "2026-07-13T09:00:00.000Z",
                    sourceOperation: "answer",
                    proposedAction: "replace",
                    kind: "topic",
                    title: "Capture routing",
                    path: "kb/topics/capture-routing.md",
                    requiresReview: true,
                    reviewReasons: ["existing-target"],
                    duplicateCandidateCount: 0,
                  },
                ]
              : [],
        });
      }
      if (url.endsWith(`/proposals/${proposalId}`)) {
        return jsonResponse({
          proposal: {
            proposalId,
            createdAt: "2026-07-13T09:00:00.000Z",
            proposedAction: "replace",
            proposedNote: {
              kind: "topic",
              title: "Capture routing",
              path: "kb/topics/capture-routing.md",
              track: "platform",
              module: "capture",
              projectId: null,
              body: "New body",
            },
            duplicateCandidates: [],
            evidenceCitations: [{ path: "kb/topics/source.md", line: 12 }],
            groundedConfidence: { label: "high" },
            requiresReview: true,
            reviewReasons: ["existing-target"],
          },
          preview: {
            targetExists: true,
            currentContent: "Old body",
            proposedContent: "New body",
            currentContentHash: "abc",
            stale: false,
          },
        });
      }
      if (url.endsWith(`/proposals/${proposalId}/apply`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ action: "replace" });
        return jsonResponse({ result: { proposalId, action: "replaced" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const user = userEvent.setup();
    render(<CaptureReviewDrawer />);
    await user.click(screen.getByRole("button", { name: "Open capture review queue" }));

    expect(await screen.findByText("Old body")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply and refresh" });
    expect(apply).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Apply action"), "replace");
    expect(apply).toBeEnabled();
    await user.click(apply);

    await waitFor(() =>
      expect(screen.getByText("No pending capture proposals.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/proposals/${proposalId}/apply`),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
