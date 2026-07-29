// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertBundleBudget, INITIAL_JS_RAW_BUDGET } from "../../scripts/bundle-budget";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("initial bundle budget", () => {
  test("measures static entry imports while excluding lazy chunks", async () => {
    const distRoot = await createBundleFixture({
      entry: "console.log('entry');",
      vendor: "console.log('vendor');",
      lazy: "x".repeat(500_000),
    });

    const result = await assertBundleBudget(distRoot);

    expect(result.javascript.map((asset) => asset.file)).toEqual([
      "assets/entry.js",
      "assets/vendor.js",
    ]);
    expect(result.javascript.some((asset) => asset.file.includes("lazy"))).toBe(false);
    expect(result.css.map((asset) => asset.file)).toEqual(["assets/entry.css"]);
    expect(result.lazyContent.map((asset) => asset.file)).toEqual(["assets/content.js"]);
    expect(result.lazyMarkdown.map((asset) => asset.file)).toEqual(["assets/markdown.js"]);
    expect(result.lazyGraph.map((asset) => asset.file)).toEqual(["assets/graph.js"]);
    expect(result.lazyMermaid.map((asset) => asset.file)).toEqual(["assets/mermaid.js"]);
  });

  test("fails when initial JavaScript exceeds the raw budget", async () => {
    const distRoot = await createBundleFixture({
      entry: "x".repeat(INITIAL_JS_RAW_BUDGET + 1),
      vendor: "",
      lazy: "",
    });

    await expect(assertBundleBudget(distRoot)).rejects.toThrow("Initial JavaScript exceeds budget");
  });
});

async function createBundleFixture(files: {
  entry: string;
  vendor: string;
  lazy: string;
}): Promise<string> {
  const distRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-bundle-budget-"));
  temporaryDirectories.push(distRoot);
  await fs.mkdir(path.join(distRoot, ".vite"), { recursive: true });
  await fs.mkdir(path.join(distRoot, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(distRoot, ".vite", "manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "assets/entry.js",
        isEntry: true,
        imports: ["vendor"],
        dynamicImports: ["lazy"],
        css: ["assets/entry.css"],
      },
      vendor: { file: "assets/vendor.js" },
      lazy: { file: "assets/lazy.js", isDynamicEntry: true },
      "content/kb/topics/example.md?raw": {
        file: "assets/content.js",
        isDynamicEntry: true,
      },
      "src/components/MarkdownArticle.tsx": {
        file: "assets/markdown.js",
        isDynamicEntry: true,
      },
      "src/views/ContextGraphView.tsx": {
        file: "assets/graph.js",
        isDynamicEntry: true,
      },
      "node_modules/mermaid/dist/mermaid.core.mjs": {
        file: "assets/mermaid.js",
        isDynamicEntry: true,
      },
    }),
  );
  await Promise.all([
    fs.writeFile(path.join(distRoot, "assets", "entry.js"), files.entry),
    fs.writeFile(path.join(distRoot, "assets", "vendor.js"), files.vendor),
    fs.writeFile(path.join(distRoot, "assets", "lazy.js"), files.lazy),
    fs.writeFile(path.join(distRoot, "assets", "content.js"), "content"),
    fs.writeFile(path.join(distRoot, "assets", "markdown.js"), "markdown"),
    fs.writeFile(path.join(distRoot, "assets", "graph.js"), "graph"),
    fs.writeFile(path.join(distRoot, "assets", "mermaid.js"), "mermaid"),
    fs.writeFile(path.join(distRoot, "assets", "entry.css"), "body { color: white; }"),
  ]);
  return distRoot;
}
