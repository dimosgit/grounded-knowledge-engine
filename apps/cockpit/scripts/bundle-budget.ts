import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const INITIAL_JS_RAW_BUDGET = 350 * 1024;
export const INITIAL_JS_GZIP_BUDGET = 120 * 1024;

interface ManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

interface AssetMeasurement {
  file: string;
  raw: number;
  gzip: number;
}

export interface BundleBudgetResult {
  javascript: AssetMeasurement[];
  css: AssetMeasurement[];
  lazyContent: AssetMeasurement[];
  lazyMarkdown: AssetMeasurement[];
  lazyGraph: AssetMeasurement[];
  lazyMermaid: AssetMeasurement[];
  javascriptRaw: number;
  javascriptGzip: number;
  cssRaw: number;
  cssGzip: number;
}

export async function assertBundleBudget(
  distRoot = path.resolve(process.cwd(), "dist"),
): Promise<BundleBudgetResult> {
  const manifestPath = path.join(distRoot, ".vite", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<
    string,
    ManifestEntry
  >;
  const entryKey =
    Object.keys(manifest).find((key) => key === "index.html") ||
    Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entryKey) throw new Error("Vite manifest has no initial entry.");

  const initialKeys = collectInitialKeys(manifest, entryKey);
  const javascriptFiles = unique(
    Array.from(initialKeys)
      .map((key) => manifest[key]?.file)
      .filter((file): file is string => Boolean(file?.endsWith(".js"))),
  );
  const cssFiles = unique(Array.from(initialKeys).flatMap((key) => manifest[key]?.css || []));
  const javascript = await measureFiles(distRoot, javascriptFiles);
  const css = await measureFiles(distRoot, cssFiles);
  const [lazyContent, lazyMarkdown, lazyGraph, lazyMermaid] = await Promise.all([
    measureManifestGroup(distRoot, manifest, (key) => /^content\/.+\.md\?raw$/.test(key)),
    measureManifestGroup(distRoot, manifest, (key) => key === "src/components/MarkdownArticle.tsx"),
    measureManifestGroup(distRoot, manifest, (key) => key === "src/views/ContextGraphView.tsx"),
    measureManifestGroup(
      distRoot,
      manifest,
      (key) =>
        key === "node_modules/mermaid/dist/mermaid.core.mjs" ||
        key.startsWith("node_modules/mermaid/dist/chunks/"),
    ),
  ]);
  const result = {
    javascript,
    css,
    lazyContent,
    lazyMarkdown,
    lazyGraph,
    lazyMermaid,
    javascriptRaw: sum(javascript, "raw"),
    javascriptGzip: sum(javascript, "gzip"),
    cssRaw: sum(css, "raw"),
    cssGzip: sum(css, "gzip"),
  };

  console.log(formatBudgetReport(result));
  if (
    result.javascriptRaw > INITIAL_JS_RAW_BUDGET ||
    result.javascriptGzip > INITIAL_JS_GZIP_BUDGET
  ) {
    throw new Error(
      `Initial JavaScript exceeds budget: ${formatBytes(result.javascriptRaw)} raw / ${formatBytes(result.javascriptGzip)} gzip (limits ${formatBytes(INITIAL_JS_RAW_BUDGET)} raw / ${formatBytes(INITIAL_JS_GZIP_BUDGET)} gzip).`,
    );
  }
  return result;
}

function collectInitialKeys(
  manifest: Record<string, ManifestEntry>,
  entryKey: string,
): Set<string> {
  const keys = new Set<string>();
  const visit = (key: string) => {
    if (keys.has(key) || !manifest[key]) return;
    keys.add(key);
    for (const importedKey of manifest[key].imports || []) visit(importedKey);
  };
  visit(entryKey);
  return keys;
}

async function measureFiles(distRoot: string, files: string[]): Promise<AssetMeasurement[]> {
  return Promise.all(
    files.sort().map(async (file) => {
      const content = await fs.readFile(path.join(distRoot, file));
      return { file, raw: content.byteLength, gzip: gzipSync(content).byteLength };
    }),
  );
}

async function measureManifestGroup(
  distRoot: string,
  manifest: Record<string, ManifestEntry>,
  matches: (key: string, entry: ManifestEntry) => boolean,
): Promise<AssetMeasurement[]> {
  return measureFiles(
    distRoot,
    unique(
      Object.entries(manifest)
        .filter(([key, entry]) => matches(key, entry))
        .map(([, entry]) => entry.file)
        .filter((file) => file.endsWith(".js")),
    ),
  );
}

function sum(items: AssetMeasurement[], key: "raw" | "gzip"): number {
  return items.reduce((total, item) => total + item[key], 0);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function formatBytes(value: number): string {
  return `${(value / 1024).toFixed(1)} KB`;
}

function formatBundleLine(label: string, items: AssetMeasurement[]): string {
  if (!items.length) return `${label}: none`;
  return `${label}: ${items.map((item) => `${item.file} (${formatBytes(item.raw)} raw, ${formatBytes(item.gzip)} gzip)`).join(", ")}`;
}

function formatLazyGroup(label: string, items: AssetMeasurement[]): string {
  if (!items.length) return `${label}: none`;
  return `${label}: ${items.length} chunk${items.length === 1 ? "" : "s"}, ${formatBytes(sum(items, "raw"))} raw / ${formatBytes(sum(items, "gzip"))} gzip`;
}

export function formatBudgetReport(result: BundleBudgetResult): string {
  return [
    formatBundleLine("Initial JavaScript", result.javascript),
    formatBundleLine("Initial CSS", result.css),
    `Initial totals: ${formatBytes(result.javascriptRaw)} JS raw, ${formatBytes(result.javascriptGzip)} JS gzip, ${formatBytes(result.cssRaw)} CSS raw, ${formatBytes(result.cssGzip)} CSS gzip`,
    formatLazyGroup("Lazy Markdown content", result.lazyContent),
    formatLazyGroup("Lazy Markdown renderer", result.lazyMarkdown),
    formatLazyGroup("Lazy graph", result.lazyGraph),
    formatLazyGroup("Lazy Mermaid", result.lazyMermaid),
  ].join("\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  assertBundleBudget().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
