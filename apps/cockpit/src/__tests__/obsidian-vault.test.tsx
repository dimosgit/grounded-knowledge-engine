import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MarkdownArticle from "../components/MarkdownArticle";
import { resolveMarkdownAssetPath, resolveMarkdownDocPath } from "../App";
import { buildCatalogEntries } from "../../scripts/catalog-generator";
import { buildContextGraph } from "../domain/graph";
import { buildProjectLinkedDocs, buildProjectSummaries } from "../domain/projects";

afterEach(() => {
  cleanup();
});

const projectContent = `---
record_type: project
project_id: router-rollout
lifecycle: active
tags:
  - network
  - rollout
---

# Router rollout

## Current focus

Follow [[Change window]] and [[runbooks/Rollback plan|the rollback]]. #ops

## Next actions

1. Confirm the window.
`;

const sources = [
  { path: "kb/projects/router-rollout/project.md", content: projectContent },
  {
    path: "kb/notes/Change window.md",
    content: "# Change window\n\nFreeze dates live here. #ops\n",
  },
  { path: "kb/runbooks/Rollback plan.md", content: "# Rollback plan\n\nSteps.\n" },
  { path: "kb/notes/Unrelated.md", content: "# Unrelated\n\nNothing linked.\n" },
];

function catalogDocs() {
  return buildCatalogEntries(sources).map((entry) => ({
    ...entry,
    content: sources.find((source) => source.path === entry.path)?.content || "",
  }));
}

describe("Obsidian vault compatibility", () => {
  test("the catalog resolves wiki-links, reads block-list tags and inline tags", () => {
    const docs = catalogDocs();
    const project = docs.find((doc) => doc.path === "kb/projects/router-rollout/project.md");
    expect(project.frontmatter.tags).toBe("network, rollout");
    expect(project.inlineTags).toEqual(["ops"]);
    expect(project.links).toEqual(
      expect.arrayContaining([
        { label: "Change window", href: "/kb/notes/Change window.md" },
        { label: "the rollback", href: "/kb/runbooks/Rollback plan.md" },
      ]),
    );
  });

  test("wiki-linked notes join the project and the context graph", () => {
    const docs = catalogDocs();
    const [project] = buildProjectSummaries(docs);
    const linked = buildProjectLinkedDocs(project, null, docs).map((doc: any) => doc.path);
    expect(linked).toEqual(
      expect.arrayContaining(["kb/notes/Change window.md", "kb/runbooks/Rollback plan.md"]),
    );
    expect(linked).not.toContain("kb/notes/Unrelated.md");

    const focus = docs.find((doc) => doc.path === "kb/projects/router-rollout/project.md");
    const graph = buildContextGraph(focus, docs);
    const reasonsFor = (path: string) =>
      graph.relationships.find((item: any) => item.doc.path === path)?.reasons || [];
    expect(reasonsFor("kb/notes/Change window.md")).toContain("explicit link from focus");
    expect(reasonsFor("kb/runbooks/Rollback plan.md")).toContain("explicit link from focus");
    expect(reasonsFor("kb/notes/Unrelated.md")).not.toContain("explicit link from focus");
  });

  test("the reader renders wiki-links as in-app links and image embeds as images", () => {
    const onOpenDoc = vi.fn();
    render(
      <MarkdownArticle
        activePath="kb/projects/router-rollout/project.md"
        content={
          "See [[Change window|the window]], [[Missing note]] and `[[code]]`.\n\n![[topology.png]]"
        }
        docs={[{ path: "kb/notes/Change window.md", title: "Change window" }]}
        onOpenDoc={onOpenDoc}
        resolveMarkdownDocPath={resolveMarkdownDocPath}
        resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      />,
    );

    const link = screen.getByRole("link", { name: "the window" });
    expect(link).toHaveAttribute("href", "#/doc/kb%2Fnotes%2FChange%20window.md");
    fireEvent.click(link);
    expect(onOpenDoc).toHaveBeenCalledWith("kb/notes/Change window.md", {
      sourcePath: "kb/projects/router-rollout/project.md",
    });
    expect(screen.queryByRole("link", { name: "Missing note" })).toBeNull();
    expect(screen.getByText(/Missing note/)).toBeInTheDocument();
    expect(screen.getByText("[[code]]")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "/content/kb/projects/router-rollout/topology.png",
    );
  });
});
