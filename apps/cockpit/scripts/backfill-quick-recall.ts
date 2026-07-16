import fs from "node:fs/promises";
import path from "node:path";
import { getPaths } from "./sync-lib.js";

interface SplitDoc {
  frontmatter: string;
  body: string;
}

interface QuickRecallInput {
  body: string;
  relPath: string;
  title: string;
}

interface InsertResult {
  changed: boolean;
  content: string;
}

const { repoRoot } = getPaths();
const kbRoot = path.join(repoRoot, "kb");
const skipDirs = new Set(["archive"]);
const maxAtGlance = 4;
const maxNext = 3;
const refreshExisting = process.argv.includes("--refresh");
const preserveExisting = new Set(["kb/topics/kb-quick-recall-summary-card-standard.md"]);

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      files.push(...(await walkMarkdown(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function splitFrontmatter(raw: string): SplitDoc {
  if (!raw.startsWith("---\n")) return { frontmatter: "", body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: raw };
  return {
    frontmatter: raw.slice(0, end + 5),
    body: raw.slice(end + 5),
  };
}

function titleFromBody(body: string, filePath: string): string {
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (title) return title;
  return path.basename(filePath, ".md").replace(/[-_]/g, " ");
}

function firstHeadingIndex(body: string): number {
  const lines = body.split("\n");
  return lines.findIndex((line) => /^#\s+/.test(line));
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactBullet(value: string): string {
  const stripped = stripMarkdown(value)
    .replace(/^What changed:\s*/i, "")
    .replace(/^Why it matters:\s*/i, "")
    .replace(/^Go back to:\s*/i, "")
    .replace(/^question:\s*/i, "")
    .replace(/^what would resolve it:\s*/i, "")
    .trim();

  if (!stripped || stripped === "..." || stripped.length < 8) return "";
  if (stripped.length <= 165) return stripped;

  const clipped = stripped.slice(0, 162);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 96 ? boundary : 162).trim()}...`;
}

function uniqueBullets(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const bullet = compactBullet(item);
    const key = bullet.toLowerCase();
    if (!bullet || seen.has(key)) continue;
    seen.add(key);
    result.push(bullet);
    if (result.length >= limit) break;
  }

  return result;
}

function sectionContent(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^##\\s+${escaped}\\s*$`, "im");
  const match = body.match(pattern);
  if (!match || match.index === undefined) return "";

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function sectionBullets(body: string, heading: string, limit: number): string[] {
  const section = sectionContent(body, heading);
  if (!section) return [];
  const bullets = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line));
  return uniqueBullets(bullets, limit);
}

function firstUsefulParagraphs(body: string, limit: number): string[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "\n");
  const blocks = withoutCode
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith("---"))
    .filter((block) => !block.startsWith("#"))
    .filter((block) => !/^[-*]\s+/m.test(block))
    .filter((block) => !block.startsWith("|"))
    .filter((block) => !/^\[.*\]\(.*\)$/.test(block));

  return uniqueBullets(blocks, limit);
}

function firstBullets(body: string, limit: number): string[] {
  return uniqueBullets(
    body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line)),
    limit,
  );
}

function h2Headings(body: string): string[] {
  return [...body.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => stripMarkdown(match[1]))
    .filter(Boolean);
}

function isTerm(relPath: string): boolean {
  return relPath.startsWith("kb/terms/");
}

function isModule(relPath: string): boolean {
  return relPath.startsWith("kb/modules/");
}

function isDigest(relPath: string): boolean {
  return relPath.startsWith("kb/digests/");
}

function isClient(relPath: string): boolean {
  return relPath.startsWith("kb/clients/");
}

function isTrack(relPath: string): boolean {
  return relPath.startsWith("kb/tracks/");
}

function buildAtGlance(body: string, relPath: string, title: string): string[] {
  const candidates: string[] = [];

  if (isDigest(relPath)) candidates.push(...sectionBullets(body, "Week at a glance", maxAtGlance));
  if (isTerm(relPath))
    candidates.push(...sectionBullets(body, "1-minute explanation", maxAtGlance));
  if (isModule(relPath) || isClient(relPath) || isTrack(relPath)) {
    candidates.push(...sectionBullets(body, "Scope", maxAtGlance));
  }
  candidates.push(...sectionBullets(body, "Current status", maxAtGlance));
  candidates.push(...sectionBullets(body, "Purpose", maxAtGlance));
  candidates.push(...sectionBullets(body, "High-level summary", maxAtGlance));
  candidates.push(...firstBullets(body, maxAtGlance));
  candidates.push(...firstUsefulParagraphs(body, 2));

  const headings = h2Headings(body).filter((heading) => !/^Quick recall$/i.test(heading));
  if (headings.length) {
    candidates.push(`Key sections include ${headings.slice(0, 3).join(", ")}.`);
  }

  candidates.push(`This note is the quick entry point for ${title}.`);
  return uniqueBullets(candidates, maxAtGlance);
}

function buildNext(body: string, relPath: string): string[] {
  const candidates: string[] = [];

  if (isDigest(relPath))
    candidates.push(...sectionBullets(body, "Next session starting point", maxNext));
  candidates.push(...sectionBullets(body, "Next starting point", maxNext));
  candidates.push(...sectionBullets(body, "Next 3 actions", maxNext));
  candidates.push(...sectionBullets(body, "Blockers", 1).map((item) => `Check blocker: ${item}`));

  if (isModule(relPath)) {
    candidates.push(
      "Start from the canonical entry points, then use topic links for deeper notes.",
    );
  } else if (isTerm(relPath)) {
    candidates.push(
      "Read the definition, SAP context, example, and pitfalls before using the term.",
    );
  } else if (isClient(relPath)) {
    candidates.push("Open the linked active project/module notes for the current client context.");
  } else if (isTrack(relPath)) {
    candidates.push("Use the linked modules as the main navigation path for this track.");
  }

  const headings = h2Headings(body).filter((heading) => !/^Quick recall$/i.test(heading));
  const firstBodyHeading = headings.find((heading) => !/^Last updated$/i.test(heading));
  if (firstBodyHeading) candidates.push(`Continue with ${firstBodyHeading}.`);
  candidates.push("Use the table of contents to jump to the next relevant section.");

  return uniqueBullets(candidates, maxNext);
}

function quickRecallBlock({ body, relPath, title }: QuickRecallInput): string {
  const atGlance = buildAtGlance(body, relPath, title);
  const next = buildNext(body, relPath);

  return [
    "## Quick recall",
    "### At a glance",
    ...atGlance.map((item) => `- ${item}`),
    "",
    "### Next starting point",
    ...next.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function insertQuickRecall(raw: string, filePath: string): InsertResult {
  const relPath = normalizePath(path.relative(repoRoot, filePath));
  if (preserveExisting.has(relPath) && /^##\s+Quick recall\s*$/im.test(raw)) {
    return { changed: false, content: raw };
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  if (!refreshExisting && /^##\s+Quick recall\s*$/im.test(body))
    return { changed: false, content: raw };

  const workingBody = refreshExisting ? removeQuickRecall(body) : body;
  if (/^##\s+Quick recall\s*$/im.test(workingBody)) return { changed: false, content: raw };
  const title = titleFromBody(body, filePath);
  const block = quickRecallBlock({ body: workingBody, relPath, title });
  const lines = workingBody.split("\n");
  const headingIndex = firstHeadingIndex(workingBody);

  if (headingIndex === -1) {
    return {
      changed: true,
      content: `${frontmatter}${block}${workingBody.startsWith("\n") ? workingBody : `\n${workingBody}`}`,
    };
  }

  lines.splice(headingIndex + 1, 0, "", block);
  return {
    changed: true,
    content: `${frontmatter}${lines.join("\n")}`,
  };
}

function removeQuickRecall(body: string): string {
  const match = body.match(/^##\s+Quick recall\s*$/im);
  if (!match || match.index === undefined) return body;

  const start = match.index;
  const rest = body.slice(start + match[0].length);
  const next = rest.search(/^##\s+/m);
  if (next === -1) return body;

  const before = body.slice(0, start).replace(/\n+$/, "\n");
  const after = rest.slice(next);
  return `${before}${after.replace(/^\n+/, "\n")}`;
}

async function main(): Promise<void> {
  const files = await walkMarkdown(kbRoot);
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const result = insertQuickRecall(raw, file);
    const relPath = normalizePath(path.relative(repoRoot, file));

    if (!result.changed) {
      skipped.push(relPath);
      continue;
    }

    await fs.writeFile(file, result.content, "utf8");
    changed.push(relPath);
  }

  console.log(
    `Quick Recall backfill updated ${changed.length} files; skipped ${skipped.length} files with existing sections.`,
  );
  for (const file of changed) console.log(`- ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
