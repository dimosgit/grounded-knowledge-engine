import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("cockpit major flows", () => {
  async function openLearningLibrary(user) {
    await user.click(screen.getByRole("button", { name: /Open learning library/i }));
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

  test("quick search command bar finds notes globally", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Quick Search/i }));
    const commandSearch = await screen.findByPlaceholderText("Search notes, terms, commands...");
    await user.type(commandSearch, "sampling");

    expect(
      await screen.findByRole("button", { name: /MCP Source Notes: Sampling/i }),
    ).toBeInTheDocument();
  });

  test("project board surfaces the demo project", async () => {
    window.location.hash = "#/projects";
    render(<App />);

    const matches = await screen.findAllByText(/Router Project Board/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  test("project detail keeps the first screen compact and progress evidence-based", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/project/router-rollout";
    render(<App />);

    expect(await screen.findByRole("heading", { name: /Router Rollout/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "At a glance" })).toBeInTheDocument();
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
