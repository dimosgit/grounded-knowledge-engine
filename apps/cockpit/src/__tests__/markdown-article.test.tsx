import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MarkdownArticle from "../components/MarkdownArticle";
import { resolveMarkdownAssetPath, resolveMarkdownDocPath } from "../App";

afterEach(() => {
  cleanup();
});

describe("MarkdownArticle path handling", () => {
  test("internal markdown doc links open in-app", async () => {
    const onOpenDoc = vi.fn();
    const docs = [{ path: "kb/topics/target.md", title: "Target" }];

    render(
      <MarkdownArticle
        activePath="kb/topics/source.md"
        content="[Jump](./target.md)"
        docs={docs}
        onOpenDoc={onOpenDoc}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const link = screen.getByRole("link", { name: "Jump" });
    expect(link).toHaveAttribute("href", "#/doc/kb%2Ftopics%2Ftarget.md");

    fireEvent.click(link);
    expect(onOpenDoc).toHaveBeenCalledWith("kb/topics/target.md", {
      sourcePath: "kb/topics/source.md",
    });
  });

  test("renders markdown images with relative paths", () => {
    render(
      <MarkdownArticle
        activePath="kb/topics/rap-architecture-overview-easy-two-pager.md"
        content="![Architecture](../assets/rap-architecture-overview.svg)"
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const image = screen.getByRole("img", { name: "Architecture" });
    expect(image).toHaveAttribute("src", "/content/kb/assets/rap-architecture-overview.svg");
    expect(screen.getByText("Architecture")).toBeInTheDocument();
  });

  test("renders markdown images with root-style kb asset paths", () => {
    render(
      <MarkdownArticle
        activePath="kb/topics/example.md"
        content="![Root Asset](/assets/rap-architecture-overview.svg)"
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const image = screen.getByRole("img", { name: "Root Asset" });
    expect(image).toHaveAttribute("src", "/content/kb/assets/rap-architecture-overview.svg");
  });

  test("falls back gracefully when an asset cannot be resolved", () => {
    render(
      <MarkdownArticle
        activePath="kb/topics/example.md"
        content="![Broken image](./missing.svg)"
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const image = screen.getByRole("img", { name: "Broken image" });
    fireEvent.error(image);

    expect(screen.getByRole("img", { name: "Broken image" })).toBeInTheDocument();
    expect(screen.getAllByText("Broken image").length).toBeGreaterThanOrEqual(1);
  });

  test("shows an on-page table of contents for long documents", () => {
    const longBody = "Context ".repeat(430);
    const content = `# Long Guide

${longBody}

## Setup
Details.

## Data Model
Details.

### Service Layer
Details.

## Deployment
Details.`;

    render(
      <MarkdownArticle
        activePath="kb/topics/long-guide.md"
        content={content}
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    expect(screen.getByRole("navigation", { name: "On this page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute("href", "#setup");
    expect(screen.getByRole("link", { name: "Data Model" })).toHaveAttribute("href", "#data-model");
    expect(screen.getByRole("link", { name: "Service Layer" })).toHaveAttribute(
      "href",
      "#service-layer",
    );
    expect(screen.getByRole("link", { name: "Deployment" })).toHaveAttribute("href", "#deployment");
  });

  test("clicking a table-of-contents item scrolls the article container", () => {
    const longBody = "Context ".repeat(430);
    const content = `# Long Guide

${longBody}

## Setup
Details.

## Data Model
Details.

### Service Layer
Details.

## Deployment
Details.`;

    const { container } = render(
      <article className="markdown">
        <MarkdownArticle
          activePath="kb/topics/long-guide.md"
          content={content}
          docs={[]}
          onOpenDoc={() => {}}
          resolveMarkdownDocPath={resolveMarkdownDocPath}
          resolveMarkdownAssetPath={resolveMarkdownAssetPath}
        />
      </article>,
    );

    const markdownRoot = container.querySelector(".markdown");
    expect(markdownRoot).toBeTruthy();

    Object.defineProperty(markdownRoot, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(markdownRoot, "scrollHeight", { value: 2200, configurable: true });
    Object.defineProperty(markdownRoot, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    markdownRoot.scrollTo = vi.fn();

    fireEvent.click(screen.getByRole("link", { name: "Deployment" }));
    expect(markdownRoot.scrollTo).toHaveBeenCalled();
  });

  test("does not show table of contents for shorter documents", () => {
    render(
      <MarkdownArticle
        activePath="kb/topics/short-note.md"
        content={
          "# Short Note\n\n## First\nA short paragraph.\n\n## Second\nAnother short paragraph."
        }
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    expect(screen.queryByRole("navigation", { name: "On this page" })).not.toBeInTheDocument();
  });

  test("in-page anchor links scroll without changing route hash", () => {
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <MarkdownArticle
          activePath="kb/topics/anchors.md"
          content={"# Anchors\n\n[Jump](#target-section)\n\n## Target section\nBody text."}
          docs={[]}
          onOpenDoc={() => {}}
          resolveMarkdownDocPath={resolveMarkdownDocPath}
          resolveMarkdownAssetPath={resolveMarkdownAssetPath}
        />,
      );

      fireEvent.click(screen.getByRole("link", { name: "Jump" }));
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("running notes toc links point to real rendered heading ids", () => {
    const intro = "Running notes intro paragraph. ".repeat(60);
    const sections = Array.from({ length: 24 }, (_, index) => {
      const n = index + 1;
      return `## Section ${n}: Topic ${n}\n\nBody text for section ${n}.`;
    }).join("\n\n");
    const runningNotes = `# Running Notes\n\n${intro}\n\n${sections}`;

    const { container } = render(
      <MarkdownArticle
        activePath="kb/topics/running-notes.md"
        content={runningNotes}
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const tocLinks = container.querySelectorAll(".markdown-toc-link");
    expect(tocLinks.length).toBeGreaterThan(20);

    for (const tocLink of tocLinks) {
      const href = tocLink.getAttribute("href") || "";
      const id = href.replace(/^#/, "");
      const heading = container.querySelector(`[id="${id}"]`);
      expect(heading).toBeTruthy();
    }
  });

  test("adds a copy action for fenced code blocks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      render(
        <MarkdownArticle
          activePath="prompts.md"
          content={"```text\nLine 1\nLine 2\n```"}
          docs={[]}
          onOpenDoc={() => {}}
          resolveMarkdownDocPath={resolveMarkdownDocPath}
          resolveMarkdownAssetPath={resolveMarkdownAssetPath}
        />,
      );

      const copyButton = screen.getByRole("button", { name: "Copy code block" });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("Line 1\nLine 2");
      });
      expect(copyButton).toHaveTextContent("Copied");
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  test("wraps text fenced blocks to keep prompt width inside article", () => {
    const { container } = render(
      <MarkdownArticle
        activePath="prompts.md"
        content={
          "```text\nThis is a very long prompt line that should wrap inside the viewport instead of forcing horizontal overflow.\n```"
        }
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const wrappedBlock = container.querySelector(".markdown-code-block.is-wrapped");
    expect(wrappedBlock).toBeTruthy();
  });

  test("wraps shell fenced blocks in prompts library to prevent horizontal overflow", () => {
    const { container } = render(
      <MarkdownArticle
        activePath="prompts.md"
        content={
          '```bash\ncd "/path/to/grounded-knowledge-engine" && npx tsx "$(pwd)/tools/kb-mcp-server/server.ts"\n```'
        }
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const wrappedBlock = container.querySelector(".markdown-code-block.is-wrapped");
    expect(wrappedBlock).toBeTruthy();
  });

  test("does not force-wrap shell fenced blocks outside prompts library", () => {
    const { container } = render(
      <MarkdownArticle
        activePath="kb/topics/commands.md"
        content={"```bash\necho hello\n```"}
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const wrappedBlock = container.querySelector(".markdown-code-block.is-wrapped");
    expect(wrappedBlock).toBeFalsy();
  });
});
