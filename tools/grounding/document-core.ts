import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CandidateFile, Frontmatter } from "./types.js";

const SKIP_DIRECTORIES = new Set([".git", ".gke", "node_modules", "dist", "content", ".cache"]);

export interface ParsedFrontmatter {
  frontmatter: Frontmatter;
  body: string;
}

export async function gatherCandidateFiles(
  repoRoot: string,
  scanRoots: string[],
): Promise<CandidateFile[]> {
  const candidates: CandidateFile[] = [];
  for (const root of scanRoots) {
    if (isOperationalStatePath(root)) continue;
    const absRoot = path.resolve(repoRoot, root);
    let stat;
    try {
      stat = await fs.stat(absRoot);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      await walk(absRoot, repoRoot, candidates);
      continue;
    }
    const relPath = toPosix(path.relative(repoRoot, absRoot));
    if (isOperationalStatePath(relPath)) continue;
    if (!isSearchableTextFile(relPath)) continue;
    candidates.push({ absPath: absRoot, relPath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return candidates;
}

export function buildManifestHash(files: CandidateFile[]): string {
  const hash = crypto.createHash("sha1");
  for (const file of files) {
    hash.update(`${file.relPath}:${file.size}:${Math.floor(file.mtimeMs)}\n`);
  }
  return hash.digest("hex");
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const header = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const frontmatter: Frontmatter = {};
  for (const line of header.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

export function getDocumentTitle(body: string, relPath: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return path.basename(relPath, path.extname(relPath));
}

export function inferSourceKind(relPath: string): string {
  if (relPath.startsWith("source-docs/")) return "reference-source";
  if (relPath.startsWith("kb/topics/")) return "kb-topic";
  if (relPath.startsWith("kb/terms/")) return "kb-term";
  if (relPath.startsWith("kb/modules/")) return "kb-module";
  if (relPath.startsWith("kb/digests/")) return "kb-digest";
  if (relPath.startsWith("kb/clients/")) return "kb-client";
  if (relPath.startsWith("project/")) return "project";
  return "doc";
}

export function inferTrack(relPath: string, frontmatter: Frontmatter): string {
  const explicit = normalizeScalar(frontmatter.track);
  if (explicit) return explicit;
  if (relPath.startsWith("source-docs/")) return "domain";
  if (relPath.startsWith("project/")) return "domain";
  if (relPath.startsWith("kb/")) return "domain";
  return "";
}

export function normalizeScanRoots(value: string[] | string, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.map((part) => `${part}`.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return fallback;
}

export function isSearchableTextFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".txt");
}

export function isOperationalStatePath(relPath: string): boolean {
  return toPosix(relPath)
    .split("/")
    .some((segment) => segment.toLowerCase() === ".gke");
}

export function normalizeScalar(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function parsePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw =
    typeof value === "string" || typeof value === "number"
      ? Number.parseInt(`${value}`, 10)
      : Number.NaN;
  let output = Number.isFinite(raw) ? raw : fallback;
  if (Number.isFinite(min)) output = Math.max(min, output);
  if (Number.isFinite(max)) output = Math.min(max, output);
  return output;
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function walk(dir: string, repoRoot: string, out: CandidateFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = toPosix(path.relative(repoRoot, absPath));
    if (isOperationalStatePath(relPath)) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await walk(absPath, repoRoot, out);
      continue;
    }
    if (!entry.isFile() || !isSearchableTextFile(relPath)) continue;
    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      continue;
    }
    out.push({ absPath, relPath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
}
