import fs from "node:fs/promises";
import path from "node:path";
import { getPaths, syncContent } from "./sync-lib.js";

const { repoRoot, sourceFolders } = getPaths();
const pollMs = 1500;
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);
let syncInProgress = false;
let syncQueued = false;
let lastSignature = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;

interface FileEntry {
  path: string;
  mtime: number;
  size: number;
}

interface Signature {
  signature: string;
  count: number;
}

function log(message: string): void {
  console.log(`[content-watch] ${message}`);
}

async function runSync(trigger = "initial"): Promise<void> {
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  syncInProgress = true;
  try {
    const stats = await syncContent();
    log(`sync (${trigger}): ${stats.total} files (${stats.markdown} md, ${stats.assets} assets)`);
  } catch (error) {
    console.error(error);
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      await runSync("queued");
    }
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function shouldTrackFile(relativePath: string, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return true;

  const ext = path.extname(lower);
  if (!imageExtensions.has(ext)) return false;
  return relativePath.toLowerCase().includes("/assets/");
}

async function collectMarkdownStats(rootPath: string, relPrefix = ""): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const dirEntries = await fs.readdir(rootPath, { withFileTypes: true });

  for (const entry of dirEntries) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      entries.push(...(await collectMarkdownStats(absolutePath, relativePath)));
      continue;
    }

    if (!entry.isFile() || !shouldTrackFile(relativePath, entry.name)) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    entries.push({
      path: relativePath,
      mtime: stat.mtimeMs,
      size: stat.size,
    });
  }

  return entries;
}

async function buildSignature(): Promise<Signature> {
  const entries: FileEntry[] = [];

  for (const { from } of sourceFolders) {
    const absolute = path.join(repoRoot, from);
    if (!(await exists(absolute))) continue;
    entries.push(...(await collectMarkdownStats(absolute, from)));
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  const signature = entries.map((entry) => `${entry.path}:${entry.mtime}:${entry.size}`).join("|");
  return { signature, count: entries.length };
}

async function pollOnce(): Promise<void> {
  const snapshot = await buildSignature();
  if (snapshot.signature === lastSignature) return;
  lastSignature = snapshot.signature;
  log(`change detected (${snapshot.count} files)`);
  await runSync("poll");
}

async function main(): Promise<void> {
  log("starting watcher");
  const initialSnapshot = await buildSignature();
  lastSignature = initialSnapshot.signature;
  await runSync("initial");
  log(`polling every ${pollMs}ms`);

  pollTimer = setInterval(() => {
    pollOnce().catch((error) => console.error(error));
  }, pollMs);

  function shutdown(): void {
    if (pollTimer) clearInterval(pollTimer);
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
