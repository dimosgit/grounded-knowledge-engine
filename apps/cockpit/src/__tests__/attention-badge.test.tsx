import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OperatorFrame } from "../components/OperatorFrame";
import { AttentionHarness } from "./support/attention-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("navigation attention badge", () => {
  test("shows the same accurate count expanded, collapsed, and on mobile", async () => {
    mockProposals(3);
    const user = userEvent.setup();
    renderShell();

    const desktopNav = screen.getByRole("navigation", { name: "Operator views" });
    const expanded = await within(desktopNav).findByRole("button", {
      name: "Attention Inbox, 3 signals",
    });
    expect(expanded).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: "Collapse side menu" }));
    const collapsed = within(desktopNav).getByRole("button", {
      name: "Attention Inbox, 3 signals",
    });
    // Collapsed keeps the label exact and still shows the counter next to the icon.
    expect(collapsed).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: "Open side menu" }));
    const mobileNav = await screen.findByRole("navigation", { name: "Mobile operator views" });
    expect(
      within(mobileNav).getByRole("button", { name: "Attention Inbox, 3 signals" }),
    ).toHaveTextContent("3");
  });

  test("caps the visible count at 99+ while keeping the exact count accessible", async () => {
    mockProposals(128);
    const user = userEvent.setup();
    renderShell();

    const desktopNav = screen.getByRole("navigation", { name: "Operator views" });
    const expanded = await within(desktopNav).findByRole("button", {
      name: "Attention Inbox, 128 signals",
    });
    expect(expanded).toHaveTextContent("99+");
    expect(expanded).not.toHaveTextContent("128");

    await user.click(screen.getByRole("button", { name: "Collapse side menu" }));
    expect(
      within(desktopNav).getByRole("button", { name: "Attention Inbox, 128 signals" }),
    ).toHaveTextContent("99+");

    await user.click(screen.getByRole("button", { name: "Open side menu" }));
    const mobileNav = await screen.findByRole("navigation", { name: "Mobile operator views" });
    expect(
      within(mobileNav).getByRole("button", { name: "Attention Inbox, 128 signals" }),
    ).toHaveTextContent("99+");
  });

  test("leaves the badge off and the label plain when nothing needs attention", async () => {
    mockProposals(0);
    renderShell();

    const desktopNav = screen.getByRole("navigation", { name: "Operator views" });
    const item = await within(desktopNav).findByRole("button", {
      name: "Attention Inbox, no signals",
    });
    await waitFor(() => expect(item).toHaveTextContent(/^Attention Inbox$/));
  });
});

function renderShell() {
  return render(
    <AttentionHarness>
      <OperatorFrame
        activeView="hub"
        title="Mission Control"
        commandBar={null}
        onCommand={() => {}}
        onHub={() => {}}
        onLibrary={() => {}}
        onProjects={() => {}}
        onGraph={() => {}}
      >
        <div>Shell body</div>
      </OperatorFrame>
    </AttentionHarness>,
  );
}

function mockProposals(count: number) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/proposals")) {
      return jsonResponse({
        proposals: Array.from({ length: count }, (_, index) => ({
          proposalId: `capture-${index}`,
          createdAt: "2026-07-30T12:30:00.000Z",
          sourceOperation: "answer",
          proposedAction: "append",
          kind: "topic",
          title: `Proposal ${index}`,
          path: `kb/topics/proposal-${index}.md`,
          requiresReview: true,
          reviewReasons: ["existing-target"],
          duplicateCandidateCount: 0,
        })),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
