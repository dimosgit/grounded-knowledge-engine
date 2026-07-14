import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
// The cockpit lives at `apps/cockpit`, so the knowledge base it renders sits two
// levels up at the repository root (`demo-kb/`, `kb/`).
const repoRoot = path.resolve(appRoot, "../..");
const contentRoot = path.join(appRoot, "content");

// Each entry maps a repo-root source folder to the folder it lands under inside
// the generated `content/` tree. Everything is funneled under `kb/` so the
// viewer's taxonomy (modules / topics / terms / digests) works against a single
// namespace, regardless of which physical folder a note came from. Override with
// `KB_PREVIEW_SOURCE_FOLDERS="from:to,from2:to2"` (the `:to` part is optional and
// defaults to the source name).
export interface SourceFolder {
  from: string;
  to: string;
}

export interface SyncContentOptions {
  publicOnly?: boolean;
}

function parseSourceFolders({ publicOnly = false }: SyncContentOptions = {}): SourceFolder[] {
  if (publicOnly) {
    return [{ from: "demo-kb", to: "kb" }];
  }

  const raw = process.env.KB_PREVIEW_SOURCE_FOLDERS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [from, to] = entry.split(":").map((part) => part.trim());
        return { from, to: to || from };
      });
  }
  return [
    { from: "demo-kb", to: "kb" },
    { from: "kb", to: "kb" },
  ];
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

export interface SyncStats {
  total: number;
  markdown: number;
  assets: number;
}

interface CopyDecision {
  markdown: boolean;
  asset: boolean;
}

interface CopyCounts {
  markdown: number;
  assets: number;
}

export interface RepoPaths {
  appRoot: string;
  repoRoot: string;
  sourceFolders: SourceFolder[];
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeForMatch(filePath: string): string {
  return filePath.split(path.sep).join("/").toLowerCase();
}

function isOperationalStatePath(filePath: string): boolean {
  return normalizeForMatch(filePath)
    .split("/")
    .some((segment) => segment === ".gke");
}

function shouldCopyFile(sourcePath: string, fileName: string): CopyDecision {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return { markdown: true, asset: false };

  const ext = path.extname(lower);
  if (!imageExtensions.has(ext)) return { markdown: false, asset: false };

  const normalizedSource = normalizeForMatch(sourcePath);
  if (!normalizedSource.includes("/assets/")) return { markdown: false, asset: false };

  return { markdown: false, asset: true };
}

async function copyContentTree(sourceDir: string, destinationDir: string): Promise<CopyCounts> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let markdown = 0;
  let assets = 0;

  for (const entry of entries) {
    if (entry.name.toLowerCase() === ".gke") continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyContentTree(sourcePath, destinationPath);
      markdown += nested.markdown;
      assets += nested.assets;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const copyDecision = shouldCopyFile(sourcePath, entry.name);
    if (!copyDecision.markdown && !copyDecision.asset) continue;

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
    if (copyDecision.markdown) markdown += 1;
    if (copyDecision.asset) assets += 1;
  }

  return { markdown, assets };
}

export async function syncContent(options: SyncContentOptions = {}): Promise<SyncStats> {
  const sourceFolders = parseSourceFolders(options);
  await fs.rm(contentRoot, { recursive: true, force: true });
  await fs.mkdir(contentRoot, { recursive: true });

  let markdown = 0;
  let assets = 0;
  for (const { from, to } of sourceFolders) {
    if (isOperationalStatePath(from) || isOperationalStatePath(to)) continue;
    const source = path.join(repoRoot, from);
    const destination = path.join(contentRoot, to);
    if (!(await exists(source))) continue;
    const copied = await copyContentTree(source, destination);
    markdown += copied.markdown;
    assets += copied.assets;
  }

  return {
    total: markdown + assets,
    markdown,
    assets,
  };
}

export function getPaths(options: SyncContentOptions = {}): RepoPaths {
  return {
    appRoot,
    repoRoot,
    sourceFolders: parseSourceFolders(options),
  };
}
