import { describe, expect, test, vi } from "vitest";
import { buildCatalogEntries } from "../../scripts/catalog-generator";
import { createMarkdownContentLoader } from "../lib/content-loader";

const LARGE_BODY_MARKER = "BODY_ONLY_SENTINEL_9f6c2d";

describe("Cockpit catalog scaling", () => {
  test("keeps full body content out of a deterministic bounded catalog", () => {
    const base = [
      "---",
      "track: demo",
      "status: canonical",
      "---",
      "# Large note",
      "",
      "A compact searchable introduction.",
      "",
    ].join("\n");
    const small = `${base}${"bounded filler ".repeat(300)}\n${LARGE_BODY_MARKER}\n`;
    const large = `${base}${"bounded filler ".repeat(3_000)}\n${LARGE_BODY_MARKER}\n`;

    const smallCatalog = buildCatalogEntries([{ path: "kb/topics/large.md", content: small }]);
    const repeatedCatalog = buildCatalogEntries([{ path: "kb/topics/large.md", content: small }]);
    const largeCatalog = buildCatalogEntries([{ path: "kb/topics/large.md", content: large }]);
    const smallJson = JSON.stringify(smallCatalog);
    const largeJson = JSON.stringify(largeCatalog);

    expect(repeatedCatalog).toEqual(smallCatalog);
    expect(smallJson).not.toContain(LARGE_BODY_MARKER);
    expect(largeJson).not.toContain(LARGE_BODY_MARKER);
    expect(largeJson.length - smallJson.length).toBeLessThan(100);
    expect(smallCatalog[0].searchIndexNormalized).toContain("compact searchable introduction");
  });

  test("loads full Markdown lazily, caches it, and deduplicates concurrent requests", async () => {
    const moduleLoader = vi.fn(async () =>
      [
        "---",
        "track: demo",
        "---",
        "# Large note",
        "",
        `Full body with ${LARGE_BODY_MARKER}.`,
      ].join("\n"),
    );
    const loader = createMarkdownContentLoader({
      "../content/kb/topics/large.md": moduleLoader,
    });

    const [first, second] = await Promise.all([
      loader.load("kb/topics/large.md"),
      loader.load("kb/topics/large.md"),
    ]);
    const cached = await loader.load("kb/topics/large.md");

    expect(first).toContain(LARGE_BODY_MARKER);
    expect(second).toBe(first);
    expect(cached).toBe(first);
    expect(first).not.toContain("track: demo");
    expect(moduleLoader).toHaveBeenCalledTimes(1);
  });

  test("fails safely when a logical Markdown path has no loader", async () => {
    const loader = createMarkdownContentLoader({});
    await expect(loader.load("kb/topics/missing.md")).rejects.toThrow(
      "requested Markdown document is unavailable",
    );
  });
});
