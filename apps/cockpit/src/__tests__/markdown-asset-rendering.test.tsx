import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MarkdownArticle from "../components/MarkdownArticle";
import { resolveMarkdownAssetPath } from "../App";

describe("markdown asset path resolution", () => {
  test("resolves relative markdown image paths to /content", () => {
    expect(resolveMarkdownAssetPath("kb/topics/sample.md", "../assets/arch.svg")).toBe(
      "/content/kb/assets/arch.svg",
    );
  });

  test("resolves root-style /assets paths into kb/assets", () => {
    expect(resolveMarkdownAssetPath("kb/topics/sample.md", "/assets/arch.svg")).toBe(
      "/content/kb/assets/arch.svg",
    );
  });
});

describe("MarkdownArticle image fallback", () => {
  test("renders caption for markdown images and graceful fallback when unresolved", () => {
    render(
      <MarkdownArticle
        activePath="kb/topics/sample.md"
        content="![Architecture Diagram](../assets/arch.svg)"
        docs={[]}
        onOpenDoc={() => {}}
        resolveMarkdownDocPath={() => null}
        resolveMarkdownAssetPath={() => "/content/kb/assets/arch.svg"}
      />,
    );

    const img = screen.getByRole("img", { name: "Architecture Diagram" });
    expect(img).toHaveAttribute("src", "/content/kb/assets/arch.svg");
    expect(screen.getByText("Architecture Diagram")).toBeInTheDocument();

    fireEvent.error(img);

    expect(screen.getByRole("note")).toHaveTextContent("Image unavailable: Architecture Diagram");
    expect(screen.getByText("Architecture Diagram")).toBeInTheDocument();
  });
});
