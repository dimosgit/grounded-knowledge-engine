import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../App";
import { CommandBar } from "../components/CommandBar";
import { composeCommandPaletteEntries, type CommandPaletteEntry } from "../domain/command-palette";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.location.hash = "";
});

const entries = composeCommandPaletteEntries({
  documents: [
    {
      path: "kb/sources/pilot-location.md",
      title: "Pilot Location",
      searchIndex: "pilot location",
      searchIndexNormalized: "pilot location",
      searchIndexCompact: "pilotlocation",
    },
  ],
  projects: [{ id: "pilot-location", title: "Pilot Location", statusBucket: "active" }],
  decisions: [{ decisionId: "pilot-location", title: "Pilot Location", reviewState: "overdue" }],
  includeReviewActions: true,
});

function PaletteHarness({
  onSelect,
  recentIds = [],
  paletteEntries = entries,
}: {
  onSelect: (entry: CommandPaletteEntry) => void;
  recentIds?: string[];
  paletteEntries?: CommandPaletteEntry[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open command palette
      </button>
      <CommandBar
        entries={paletteEntries}
        recentIds={recentIds}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onSelect={onSelect}
      />
    </div>
  );
}

describe("command palette surface", () => {
  test("groups results by type and keeps duplicate titles individually addressable", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    const combobox = screen.getByRole("combobox");
    await user.type(combobox, "pilot location");

    expect(screen.getByRole("group", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Decisions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Documents" })).toBeInTheDocument();

    // Three entries share one title; the subtitles disambiguate them and every
    // option keeps a unique, rendered id for aria-activedescendant.
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    const ids = options.map((option) => option.id);
    expect(new Set(ids).size).toBe(3);
    const activeId = combobox.getAttribute("aria-activedescendant");
    expect(ids).toContain(activeId);
    expect(document.getElementById(activeId!)).toBeInTheDocument();
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0].textContent).toContain("active");
    expect(options[1].textContent).toContain("overdue");
    expect(options[2].textContent).toContain("kb/sources/pilot-location.md");
  });

  test("wraps arrow navigation, announces the active group, and selects with Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PaletteHarness onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    const combobox = screen.getByRole("combobox");
    await user.type(combobox, "pilot location");
    const options = screen.getAllByRole("option");

    expect(screen.getByRole("status")).toHaveTextContent(
      "3 results available. Active group: Projects.",
    );

    // Up from the first option wraps to the last one.
    await user.keyboard("{ArrowUp}");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[2].id);
    expect(screen.getByRole("status")).toHaveTextContent("Active group: Documents.");

    // Down from the last option wraps back to the first.
    await user.keyboard("{ArrowDown}");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[0].id);

    await user.keyboard("{ArrowDown}");
    // Dispatched directly: once Enter closes the palette, focus returns to the
    // opener, and a synthesized keypress there would reopen it mid-assertion.
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      kind: "decision",
      destination: { kind: "decision", decisionId: "pilot-location" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument(),
    );
  });

  test("restores focus on Escape and reopens without the previous query", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PaletteHarness onSelect={onSelect} />);
    const opener = screen.getByRole("button", { name: "Open command palette" });

    await user.click(opener);
    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveFocus();
    await user.type(combobox, "pilot");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(opener);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  test("offers quick actions and recent destinations before anything is typed", async () => {
    const user = userEvent.setup();
    render(
      <PaletteHarness
        onSelect={vi.fn()}
        recentIds={["decision:pilot-location", "view:attention", "document:kb/gone.md"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    const quickActions = screen.getByRole("group", { name: "Quick actions" });
    expect(
      Array.from(quickActions.querySelectorAll("[role='option']")).map(
        (option) => option.querySelector("div.font-bold")?.textContent,
      ),
    ).toEqual(["Attention Inbox", "Ask grounded knowledge", "Capture Review"]);

    const recent = screen.getByRole("group", { name: "Recent destinations" });
    const recentOptions = recent.querySelectorAll("[role='option']");
    // The unknown id is dropped and the quick action is not repeated.
    expect(recentOptions).toHaveLength(1);
    expect(recentOptions[0].textContent).toContain("pilot-location");
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 suggestions available. Active group: Quick actions.",
    );
  });

  test("separates the quick-action empty state from a no-match empty state", async () => {
    const user = userEvent.setup();
    render(<PaletteHarness onSelect={vi.fn()} paletteEntries={[]} />);
    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    expect(screen.getByText(/Start with a quick action/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Start typing to search.");

    await user.type(screen.getByRole("combobox"), "nowhere");
    expect(screen.getByText('No matches for "nowhere"')).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No results for nowhere.");
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-activedescendant");
  });

  test("renders metadata only and never touches a Markdown body", async () => {
    const user = userEvent.setup();
    // Reading the body throws, so any Markdown access fails the test loudly.
    const trapDocument = {
      path: "kb/sources/trap.md",
      title: "Trap Note",
      searchIndex: "trap note",
      searchIndexNormalized: "trap note",
      searchIndexCompact: "trapnote",
      get content(): string {
        throw new Error("The command palette must not read Markdown bodies.");
      },
    };
    const trapped = composeCommandPaletteEntries({ documents: [trapDocument] });
    render(<PaletteHarness onSelect={vi.fn()} paletteEntries={trapped} />);
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("combobox"), "trap");

    const option = screen.getByRole("option");
    expect(option.textContent).toContain("Trap Note");
    expect(Object.keys(trapped[0])).not.toContain("content");
  });
});

describe("command palette review destinations", () => {
  function stubReadOnlyFetch() {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: `${url}`, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ proposals: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  async function openPalette(user: ReturnType<typeof userEvent.setup>, query: string) {
    await user.click(await screen.findByRole("button", { name: /Command palette/i }));
    const combobox = await screen.findByPlaceholderText(
      "Search documents, projects, decisions, views...",
    );
    await user.type(combobox, query);
    return combobox;
  }

  test("opens the grounded Ask drawer without capturing anything", async () => {
    const calls = stubReadOnlyFetch();
    const user = userEvent.setup();
    render(<App />);

    await openPalette(user, "ask grounded");
    expect(await screen.findByRole("group", { name: "Review actions" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Ask grounded knowledge/i }));

    expect(await screen.findByRole("dialog", { name: "Ask local knowledge" })).toBeInTheDocument();
    // Opening a review surface reads; it must never post a canonical change.
    expect(calls.every((call) => (call.init?.method || "GET").toUpperCase() === "GET")).toBe(true);
  });

  test("opens the capture review queue without applying a proposal", async () => {
    const calls = stubReadOnlyFetch();
    const user = userEvent.setup();
    render(<App />);

    await openPalette(user, "capture review");
    await user.click(await screen.findByRole("option", { name: /Capture Review/i }));

    expect(
      await screen.findByRole("dialog", { name: /Capture review queue/i }),
    ).toBeInTheDocument();
    expect(calls.every((call) => (call.init?.method || "GET").toUpperCase() === "GET")).toBe(true);
    expect(calls.some((call) => call.url.includes("/apply") || call.url.includes("/reject"))).toBe(
      false,
    );
  });

  test("searches document metadata without loading a Markdown body", async () => {
    stubReadOnlyFetch();
    const user = userEvent.setup();
    render(<App />);

    await openPalette(user, "architecture");
    expect(
      await screen.findByRole("option", { name: /MCP Source Notes: Architecture/i }),
    ).toBeInTheDocument();
    // The body only ever renders once a document route actually opens.
    expect(screen.queryByText(/MCP follows a client-server architecture/)).not.toBeInTheDocument();
  });
});
