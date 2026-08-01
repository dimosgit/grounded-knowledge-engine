import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OperatorActions } from "../components/OperatorActions";
import type { OperatorAttention } from "../hooks/useOperatorAttention";
import { AttentionBadgeProbe, AttentionHarness } from "./support/attention-harness";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shared operator attention state", () => {
  test("serves every consumer from one proposal-list request", async () => {
    const calls = trackFetch({ proposals: [summary("capture-1"), summary("capture-2")] });

    render(
      <AttentionHarness>
        <OperatorActions />
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );

    await waitFor(() => expect(screen.getByTestId("probe-proposal-ids")).toHaveTextContent(""));
    await waitFor(() =>
      expect(screen.getByTestId("probe-proposal-ids")).toHaveTextContent("capture-1,capture-2"),
    );
    // The header queue badge and the probe read the same array.
    expect(
      screen.getByRole("button", { name: "Open capture review queue", hidden: true }),
    ).toHaveTextContent("2");
    expect(calls.proposals).toBe(1);
  });

  test("refreshes once per return to the tab and never polls while idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = trackFetch({ proposals: [] });
    let attention: OperatorAttention | undefined;

    render(<AttentionHarness onAttention={(value) => (attention = value)} />);
    await waitFor(() => expect(calls.proposals).toBe(1));

    // Nothing is scheduled: sitting idle must not add a request.
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(calls.proposals).toBe(1);

    // A focus event with no preceding away transition is not a return.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls.proposals).toBe(1);

    // A real return fires visibilitychange and focus together; both belong to
    // the same transition, so they cost exactly one refresh.
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(calls.proposals).toBe(2));

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(calls.proposals).toBe(3));

    expect(attention?.proposalStatus).toBe("ready");
    vi.useRealTimers();
  });

  test("selects the newly created proposal and reselects deterministically after review", async () => {
    let listed = [summary("capture-1"), summary("capture-2")];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/proposals")) return jsonResponse({ proposals: listed });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    let attention: OperatorAttention | undefined;

    render(
      <AttentionHarness onAttention={(value) => (attention = value)}>
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe-selected")).toHaveTextContent("capture-1"),
    );

    // Ask reports a created proposal through the shared refresh with a preference.
    listed = [summary("capture-1"), summary("capture-2"), summary("capture-3")];
    await act(async () => {
      await attention?.refreshProposals("capture-3");
    });
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("capture-3");
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("3");

    // Applying or rejecting refreshes once with a cleared preference.
    listed = [summary("capture-1"), summary("capture-2")];
    await act(async () => {
      await attention?.refreshProposals(null);
    });
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("capture-1");

    // An unrelated refresh preserves a selection that still exists.
    await act(async () => {
      await attention?.selectProposal("capture-2");
    });
    await act(async () => {
      await attention?.refreshProposals();
    });
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("capture-2");

    listed = [];
    await act(async () => {
      await attention?.refreshProposals();
    });
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("");
  });

  test("ignores a slower earlier response that resolves after a newer one", async () => {
    const pending: Array<(proposals: ReturnType<typeof summary>[]) => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).endsWith("/proposals")) throw new Error("Unexpected request");
      return new Promise<Response>((resolve) => {
        pending.push((proposals) => resolve(jsonResponse({ proposals })));
      });
    });
    let attention: OperatorAttention | undefined;

    render(
      <AttentionHarness onAttention={(value) => (attention = value)}>
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    await act(async () => {
      void attention?.refreshProposals();
    });
    await waitFor(() => expect(pending).toHaveLength(2));

    // Newest request wins first…
    await act(async () => {
      pending[1]([summary("newest")]);
    });
    expect(screen.getByTestId("probe-proposal-ids")).toHaveTextContent("newest");

    // …and the stale first response can no longer replace it.
    await act(async () => {
      pending[0]([summary("stale-1"), summary("stale-2")]);
    });
    expect(screen.getByTestId("probe-proposal-ids")).toHaveTextContent("newest");
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("1");
  });

  test("keeps proposal and change failures independent and separately retryable", async () => {
    let proposalsFail = true;
    let reviewFail = true;
    const calls = { proposals: 0, review: 0 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/proposals")) {
        calls.proposals += 1;
        return proposalsFail
          ? jsonResponse({ error: "Cannot read /Users/operator/private-captures" }, 500)
          : jsonResponse({ proposals: [summary("capture-1")] });
      }
      if (url.startsWith("/__gke/review")) {
        calls.review += 1;
        return reviewFail
          ? jsonResponse({ error: "Cannot read /Users/operator/private-review" }, 500)
          : jsonResponse({ review: reviewReport() });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    let attention: OperatorAttention | undefined;

    render(
      <AttentionHarness
        changesActive
        projects={[catalogProject()]}
        onAttention={(value) => (attention = value)}
      >
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );

    await waitFor(() => expect(attention?.proposalStatus).toBe("error"));
    await waitFor(() => expect(attention?.changeStatus).toBe("error"));
    expect(attention?.proposalError).toBe("Could not load pending captures.");
    expect(attention?.changeError).toBe("Could not load changed evidence.");
    expect(`${attention?.proposalError} ${attention?.changeError}`).not.toContain("/Users/");
    // Catalog-backed signals survive both local failures.
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("1");

    proposalsFail = false;
    await act(async () => {
      attention?.retryFailed();
    });
    await waitFor(() => expect(attention?.proposalStatus).toBe("ready"));
    expect(attention?.changeStatus).toBe("error");
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("2");

    reviewFail = false;
    await act(async () => {
      attention?.retryFailed();
    });
    await waitFor(() => expect(attention?.changeStatus).toBe("ready"));
    // The retry only re-ran the failed source.
    expect(calls.proposals).toBe(2);
    expect(calls.review).toBe(3);
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("3");
  });

  test("loads changed evidence only where it is shown", async () => {
    const calls = trackFetch({ proposals: [] });
    const { rerender } = render(<AttentionHarness changesActive={false} />);
    await waitFor(() => expect(calls.proposals).toBe(1));
    expect(calls.review).toBe(0);

    rerender(<AttentionHarness changesActive />);
    await waitFor(() => expect(calls.review).toBe(1));
    expect(calls.proposals).toBe(1);
  });

  test("refreshes changed evidence on demand without reloading proposals", async () => {
    const calls = trackFetch({ proposals: [summary("capture-1")] });
    let attention: OperatorAttention | undefined;

    render(<AttentionHarness changesActive onAttention={(value) => (attention = value)} />);
    await waitFor(() => expect(calls.proposals).toBe(1));
    await waitFor(() => expect(calls.review).toBe(1));

    await act(async () => {
      await attention?.refreshChanges();
    });

    expect(calls.review).toBe(2);
    expect(calls.proposals).toBe(1);
  });

  test("drops a response that arrives after unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveList: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          resolveList = resolve;
        }),
    );

    const { unmount } = render(<AttentionHarness />);
    await waitFor(() => expect(resolveList).toBeDefined());
    unmount();

    await act(async () => {
      resolveList?.(jsonResponse({ proposals: [summary("capture-1")] }));
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("makes no local request outside development", async () => {
    vi.stubEnv("DEV", false);
    const calls = trackFetch({ proposals: [summary("capture-1")] });
    let attention: OperatorAttention | undefined;

    render(
      <AttentionHarness
        changesActive
        projects={[catalogProject()]}
        onAttention={(value) => (attention = value)}
      >
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );

    await act(async () => {
      await attention?.refreshProposals();
      await attention?.refreshChanges();
    });

    expect(calls.proposals).toBe(0);
    expect(calls.review).toBe(0);
    expect(attention?.proposalStatus).toBe("idle");
    expect(attention?.changeStatus).toBe("idle");
    // Catalog-backed Attention signals still render in the static preview.
    expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("1");
  });
});

describe("attention badge presentation", () => {
  test("caps the visible count at 99+ while the accessible name stays exact", async () => {
    trackFetch({
      proposals: Array.from({ length: 128 }, (_, index) => summary(`capture-${index}`)),
    });

    render(
      <AttentionHarness>
        <AttentionBadgeProbe />
      </AttentionHarness>,
    );

    await waitFor(() => expect(screen.getByTestId("probe-badge-text")).toHaveTextContent("99+"));
    expect(screen.getByTestId("probe-badge-label")).toHaveTextContent(
      "Attention Inbox, 128 signals",
    );
  });
});

function trackFetch(payload: { proposals: ReturnType<typeof summary>[] }) {
  const calls = { proposals: 0, review: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/proposals")) {
      calls.proposals += 1;
      return jsonResponse(payload);
    }
    if (url.startsWith("/__gke/review")) {
      calls.review += 1;
      return jsonResponse({ review: reviewReport() });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return calls;
}

function summary(proposalId: string) {
  return {
    proposalId,
    createdAt: "2026-07-30T12:30:00.000Z",
    sourceOperation: "answer",
    proposedAction: "append",
    kind: "topic",
    title: `Proposal ${proposalId}`,
    path: `kb/topics/${proposalId}.md`,
    requiresReview: true,
    reviewReasons: ["existing-target"],
    duplicateCandidateCount: 0,
  };
}

function catalogProject() {
  return {
    id: "router-rollout",
    title: "Router Rollout",
    reviewState: "overdue",
    reviewAfter: "2026-07-06",
    needsAttention: true,
    attentionReasons: ["Review overdue"],
  };
}

function reviewReport() {
  return {
    asOf: "2026-07-31",
    since: "2026-07-24",
    projects: [
      {
        projectId: "router-rollout",
        title: "Router Rollout",
        changedDocuments: [
          {
            path: "kb/topics/router-rollout-notes.md",
            title: "Router rollout notes",
            changedAt: "2026-07-30",
            source: "git",
          },
        ],
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
