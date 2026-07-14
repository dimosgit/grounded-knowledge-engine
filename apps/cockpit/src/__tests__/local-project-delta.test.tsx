import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocalProjectDelta } from "../components/LocalProjectDelta";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("local project delta", () => {
  test("loads changes on demand and opens workspace-relative citations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          review: {
            asOf: "2026-07-14T00:00:00.000Z",
            since: "2026-07-10T00:00:00.000Z",
            projectCount: 1,
            attentionCount: 1,
            projects: [
              {
                projectId: "alpha",
                title: "Alpha",
                changedDocuments: [
                  {
                    path: "kb/sources/alpha/evidence.md",
                    title: "Alpha evidence",
                    changedAt: "2026-07-12T12:00:00.000Z",
                    source: "git",
                    citation: { path: "kb/sources/alpha/evidence.md", line: 4 },
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const onOpenDoc = vi.fn();
    const user = userEvent.setup();
    render(<LocalProjectDelta onOpenDoc={onOpenDoc} />);

    expect(fetchMock).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Changed since");
    await user.clear(input);
    await user.type(input, "2026-07-10");
    await user.click(screen.getByRole("button", { name: "Load changes" }));

    expect(await screen.findByText("Alpha evidence")).toBeInTheDocument();
    expect(screen.getByText("git")).toBeInTheDocument();
    expect(screen.getByText(/kb\/sources\/alpha\/evidence\.md:4/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("since=2026-07-10"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await user.click(screen.getByRole("button", { name: /Alpha evidence/i }));
    expect(onOpenDoc).toHaveBeenCalledWith("kb/sources/alpha/evidence.md");
  });
});
