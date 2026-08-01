import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("cockpit major flows", () => {
  async function openLearningLibrary(user) {
    await user.click(await screen.findByRole("button", { name: /Open learning library/i }));
    await screen.findByPlaceholderText("Search all docs (modules, topics, terms, digests)...");
  }

  test("search surfaces topic docs by title", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openLearningLibrary(user);

    const search = screen.getAllByPlaceholderText(
      "Search all docs (modules, topics, terms, digests)...",
    )[0];
    await user.type(search, "architecture");

    expect(
      await screen.findByRole("button", { name: /MCP Source Notes: Architecture/i }),
    ).toBeInTheDocument();
  });

  test("library search matches terms in document bodies", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openLearningLibrary(user);

    const search = screen.getAllByPlaceholderText(
      "Search all docs (modules, topics, terms, digests)...",
    )[0];
    await user.type(search, "json-rpc");

    expect(
      await screen.findByRole("button", { name: /MCP Source Notes: Architecture/i }),
    ).toBeInTheDocument();
  });

  test("direct document links load the full Markdown body on demand", async () => {
    window.location.hash = "#/doc/kb%2Ftopics%2Fmcp-source-architecture.md";
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "MCP Source Notes: Architecture" }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/MCP follows a client-server architecture/)).length,
    ).toBeGreaterThan(0);
  });

  test("command palette finds notes globally", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Command palette/i }));
    const commandSearch = await screen.findByPlaceholderText(
      "Search documents, projects, decisions, views...",
    );
    await user.type(commandSearch, "sampling");

    expect(
      await screen.findByRole("option", { name: /MCP Source Notes: Sampling/i }),
    ).toBeInTheDocument();
  });

  test("command palette reaches projects, decisions, and views, then navigates", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Command palette/i }));
    const commandSearch = await screen.findByPlaceholderText(
      "Search documents, projects, decisions, views...",
    );

    await user.type(commandSearch, "decision replay");
    expect(await screen.findByRole("group", { name: "Views" })).toBeInTheDocument();
    const viewOption = await screen.findByRole("option", { name: /Decision Replay/i });
    await user.click(viewOption);

    expect(window.location.hash).toBe("#/decisions");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument(),
    );

    // Reopening shows the destination we just used, without retaining the query.
    await user.click(screen.getByRole("button", { name: /Command palette/i }));
    expect(await screen.findByRole("group", { name: "Recent destinations" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search documents, projects, decisions, views..."),
    ).toHaveValue("");
  });

  test("project board surfaces the demo project", async () => {
    window.location.hash = "#/projects";
    render(<App />);

    const matches = await screen.findAllByText(/Router Project Board/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  test("daily attention links to a composed board filter", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Review what needs attention" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open questions: \d+ project contexts/i }));

    expect(await screen.findByRole("heading", { name: "Project Board" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/projects?attention=open-questions");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Open questions/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  test("opens one filterable attention inbox across catalog-backed signals", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Review attention" }));

    expect(
      await screen.findByRole("heading", { name: "What needs your attention now?" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#/attention");
    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Decision").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Question").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Decisions" }));
    expect(window.location.hash).toBe("#/attention?kind=decision");
    expect(screen.getByText(/signals shown/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Router Project Board/i })).not.toBeInTheDocument();
  });

  test("shares one live attention state across the shell badge, inbox, and capture review", async () => {
    const proposalId = "capture-20260731090000-shared00001";
    const calls = { proposals: 0, review: 0 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/proposals")) {
        calls.proposals += 1;
        return jsonResponse({
          proposals: [
            {
              proposalId,
              createdAt: "2026-07-31T09:00:00.000Z",
              sourceOperation: "answer",
              proposedAction: "append",
              kind: "topic",
              title: "Shared attention capture",
              path: "kb/topics/shared-attention-capture.md",
              requiresReview: true,
              reviewReasons: ["existing-target"],
              duplicateCandidateCount: 0,
            },
          ],
        });
      }
      if (url.startsWith("/__gke/review")) {
        calls.review += 1;
        return jsonResponse({ review: { asOf: "2026-07-31", since: "2026-07-24", projects: [] } });
      }
      if (url.startsWith("/__gke/workspace/context")) {
        return jsonResponse({
          workspace: {
            id: "local-operator",
            label: "Local Operator",
            readOnly: false,
            sensitivity: "personal",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    window.location.hash = "#/attention";
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "What needs your attention now?" }),
    ).toBeInTheDocument();
    const pendingCapture = await screen.findByText("Shared attention capture");
    expect(pendingCapture).toBeInTheDocument();

    // The inbox total and the navigation badge come from the same composed list.
    const shown = await screen.findByText(/of \d+ signals shown/);
    const total = Number(/of (\d+) signals shown/.exec(shown.textContent || "")?.[1]);
    expect(total).toBeGreaterThan(1);
    const desktopNav = screen.getByRole("navigation", { name: "Operator views" });
    expect(
      within(desktopNav).getByRole("button", { name: `Attention Inbox, ${total} signals` }),
    ).toBeInTheDocument();
    // The header queue badge is the same proposal array, fetched exactly once.
    expect(
      screen.getByRole("button", { name: "Open capture review queue", hidden: true }),
    ).toHaveTextContent("1");
    expect(calls.proposals).toBe(1);
    expect(calls.review).toBe(1);
  });

  test("refreshes changed evidence on demand without duplicating the proposal list", async () => {
    const calls = { proposals: 0, review: 0 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/proposals")) {
        calls.proposals += 1;
        return jsonResponse({ proposals: [] });
      }
      if (url.startsWith("/__gke/review")) {
        calls.review += 1;
        return jsonResponse({ review: { asOf: "2026-07-31", since: "2026-07-24", projects: [] } });
      }
      if (url.startsWith("/__gke/workspace/context")) {
        return jsonResponse({
          workspace: {
            id: "local-operator",
            label: "Local Operator",
            readOnly: false,
            sensitivity: "personal",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    window.location.hash = "#/attention";
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "What needs your attention now?" });
    await waitFor(() => expect(calls.review).toBe(1));
    expect(calls.proposals).toBe(1);

    await user.click(screen.getByRole("button", { name: "Refresh changes" }));
    await waitFor(() => expect(calls.review).toBe(2));
    expect(calls.proposals).toBe(1);
  });

  test("falls back safely when attention route filters are malformed", async () => {
    window.location.hash = "#/attention?kind=write&priority=critical&project=../../private";
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "What needs your attention now?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All signals" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Any urgency" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("");
  });

  test("positions the Cockpit as an optional review layer without dead controls", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Keep your agent grounded/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cockpit is optional")).toBeInTheDocument();
    expect(screen.getByText("Primary workflow")).toBeInTheDocument();
    expect(screen.getByText("Local workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Support" })).not.toBeInTheDocument();
  });

  test("project detail starts with the next action and keeps progress evidence-based", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/project/router-rollout";
    render(<App />);

    expect(await screen.findByRole("heading", { name: /Router Rollout/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Continue here" })).toBeInTheDocument();
    expect(screen.getByText("Open the project in the Operator Cockpit.")).toBeInTheDocument();
    expect(screen.getByText("What changed")).toBeInTheDocument();
    expect(screen.getByText("What is blocked")).toBeInTheDocument();
    expect(screen.getByText("What was decided")).toBeInTheDocument();
    expect(screen.getByText("Open question")).toBeInTheDocument();
    expect(screen.getByText(/58% complete/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Not measured — add a weighted task checklist/i),
    ).not.toBeInTheDocument();

    const contextToggle = screen.getByText("Project context").closest("summary");
    expect(contextToggle).toBeInTheDocument();
    await user.click(contextToggle!);
    expect(screen.getByText("Last meaningful change")).toBeInTheDocument();
  });

  test("context graph supports zoom reset and node repositioning", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getGraphRect() {
        if (this.matches?.("[data-graph-world]")) {
          return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 1000,
            bottom: 800,
            width: 1000,
            height: 800,
            toJSON: () => {},
          };
        }
        return originalRect.call(this);
      },
    );

    window.location.hash = "#/graph";
    render(<App />);

    expect(await screen.findByRole("heading", { name: /Context Graph/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Major Context Links/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Collapse major context links/i }));
    expect(screen.getByRole("button", { name: /Expand major context links/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Major Context Links/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Expand major context links/i }));
    expect(screen.getByRole("heading", { name: /Major Context Links/i })).toBeInTheDocument();

    const graphWorld = document.querySelector("[data-graph-world]");
    expect(graphWorld).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });

    await userEvent.click(screen.getByRole("button", { name: /Zoom in graph/i }));
    expect(screen.getByText("115%")).toBeInTheDocument();
    expect(graphWorld).toHaveStyle({ transform: "translate(0px, 0px) scale(1.15)" });

    await userEvent.click(screen.getByRole("button", { name: /Zoom out graph/i }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    const node = document.querySelector("[data-graph-node]") as HTMLElement;
    const viewport = document.querySelector("[data-graph-viewport]") as HTMLElement;
    const initialLeft = node.style.left;
    const initialTop = node.style.top;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 220, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 220, clientY: 180, pointerId: 1 });

    await waitFor(() => {
      expect(node.style.left).not.toBe(initialLeft);
      expect(node.style.top).not.toBe(initialTop);
    });

    await userEvent.click(screen.getByRole("button", { name: /Re-adjust graph layout/i }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    await waitFor(() => {
      expect(node.style.left).toBe(initialLeft);
      expect(node.style.top).toBe(initialTop);
      expect(graphWorld).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
