import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentBacklinks } from "../components/DocumentBacklinks";
import { OpenInObsidianLink } from "../components/OpenInObsidianLink";
import { buildBacklinks } from "../domain/graph";
import { buildObsidianOpenUrl, normalizeObsidianConfig } from "../domain/obsidian";

afterEach(() => {
  cleanup();
});

const docs = [
  {
    path: "kb/notes/Change window.md",
    title: "Change window",
    links: [],
  },
  {
    path: "kb/projects/router-rollout/project.md",
    title: "Router rollout",
    links: [{ label: "Change window", href: "/kb/notes/Change window.md" }],
  },
  {
    path: "kb/runbooks/cutover.md",
    title: "Cutover runbook",
    links: [{ label: "window", href: "../notes/Change window.md" }],
  },
  { path: "kb/notes/unrelated.md", title: "Unrelated", links: [] },
];

describe("document backlinks", () => {
  test("lists notes whose Markdown or wiki-links resolve to the active note", () => {
    expect(buildBacklinks("kb/notes/Change window.md", docs).map((doc) => doc.path)).toEqual([
      "kb/runbooks/cutover.md",
      "kb/projects/router-rollout/project.md",
    ]);
    expect(buildBacklinks("kb/notes/unrelated.md", docs)).toEqual([]);
  });

  test("renders a Linked from panel that opens the linking note", () => {
    const onOpenDoc = vi.fn();
    render(
      <DocumentBacklinks
        activePath="kb/notes/Change window.md"
        docs={docs}
        onOpenDoc={onOpenDoc}
      />,
    );
    expect(screen.getByRole("heading", { name: "Linked from" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Router rollout/ }));
    expect(onOpenDoc).toHaveBeenCalledWith("kb/projects/router-rollout/project.md", {
      sourcePath: "kb/notes/Change window.md",
    });
  });

  test("renders nothing when no note links here", () => {
    const { container } = render(
      <DocumentBacklinks activePath="kb/notes/unrelated.md" docs={docs} onOpenDoc={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Open in Obsidian", () => {
  test("normalizes the workspace setting and rejects unsafe values", () => {
    expect(normalizeObsidianConfig({ vault: " Team notes ", pathPrefix: "/kb" })).toEqual({
      vault: "Team notes",
      pathPrefix: "kb/",
    });
    expect(normalizeObsidianConfig({ vault: "Notes" })).toEqual({ vault: "Notes", pathPrefix: "" });
    expect(normalizeObsidianConfig({ vault: "" })).toBeNull();
    expect(normalizeObsidianConfig({ vault: "Notes", pathPrefix: "../outside" })).toBeNull();
    expect(normalizeObsidianConfig({ vault: "bad\nname" })).toBeNull();
    expect(normalizeObsidianConfig(null)).toBeNull();
  });

  test("builds a vault-relative obsidian:// link", () => {
    const config = normalizeObsidianConfig({ vault: "Team notes", pathPrefix: "kb/" });
    expect(buildObsidianOpenUrl(config, "kb/notes/Change window.md")).toBe(
      "obsidian://open?vault=Team%20notes&file=notes%2FChange%20window.md",
    );
    expect(buildObsidianOpenUrl(config, "readme.md")).toBeNull();
    expect(buildObsidianOpenUrl(null, "kb/notes/Change window.md")).toBeNull();
  });

  test("shows the action only when a vault is configured", () => {
    const config = normalizeObsidianConfig({ vault: "Team notes", pathPrefix: "kb/" });
    const { rerender } = render(
      <OpenInObsidianLink docPath="kb/notes/Change window.md" config={config} />,
    );
    expect(screen.getByRole("link", { name: "Open in Obsidian" })).toHaveAttribute(
      "href",
      "obsidian://open?vault=Team%20notes&file=notes%2FChange%20window.md",
    );
    rerender(<OpenInObsidianLink docPath="kb/notes/Change window.md" config={null} />);
    expect(screen.queryByRole("link", { name: "Open in Obsidian" })).toBeNull();
  });
});
