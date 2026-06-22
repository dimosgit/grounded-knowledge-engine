import type { ParsedProjectDocument, ProjectManifest, ProjectSection } from "./types.js";

const SECTION_ALIASES: Record<string, string> = {
  "definition of done": "outcome",
  "current status": "current-status",
  "current focus": "current-focus",
  "last meaningful change": "last-meaningful-change",
  "recent changes": "last-meaningful-change",
  "active decisions": "active-decisions",
  blockers: "blockers",
  "open questions": "open-questions",
  "next actions": "next-actions",
  "next 3 actions": "next-actions",
  "key documents": "key-documents",
  outcome: "outcome",
};

export function normalizeProjectId(value: unknown): string {
  return `${value || ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseProjectDocument(raw: string, relPath: string, fallbackTitle: string): ParsedProjectDocument {
  const { frontmatter, bodyStartLine } = parseFrontmatter(raw);
  const body = raw.split(/\r?\n/).slice(bodyStartLine - 1).join("\n");
  return parseProjectData(frontmatter, body, relPath, fallbackTitle, bodyStartLine);
}

export function parseProjectData(
  frontmatter: Record<string, string>,
  body: string,
  relPath: string,
  fallbackTitle: string,
  bodyStartLine = 1,
): ParsedProjectDocument {
  const sections = new Map<string, ProjectSection>();
  let title = `${frontmatter.title || fallbackTitle || ""}`.trim();
  let current: ProjectSection | null = null;
  const bodyLines = body.split(/\r?\n/);

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    const absoluteLine = bodyStartLine + index;
    const titleMatch = line.match(/^#\s+(.+?)\s*$/);
    if (titleMatch && !title) title = titleMatch[1].trim();

    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current) {
        current.content = current.content.trim();
        sections.set(current.key, current);
      }
      const heading = headingMatch[1].trim();
      current = {
        key: SECTION_ALIASES[heading.toLowerCase()] || normalizeProjectId(heading),
        heading,
        content: "",
        line: absoluteLine,
      };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) {
    current.content = current.content.trim();
    sections.set(current.key, current);
  }

  const canonicalPathMatch = relPath.match(/(?:^|\/)(?:demo-kb|kb)\/projects\/([^/]+)\/project\.md$/);
  const projectId = normalizeProjectId(
    frontmatter.project_id ||
      canonicalPathMatch?.[1] ||
      (frontmatter.type === "project" ? frontmatter.module : "") ||
      title ||
      fileStem(relPath),
  );
  const canonical = frontmatter.record_type === "project" || Boolean(canonicalPathMatch);
  const manifest: ProjectManifest = {
    projectId,
    title: title || projectId,
    workspaceId: `${frontmatter.workspace_id || frontmatter.workspace || "default"}`.trim(),
    status: `${frontmatter.status || frontmatter.lifecycle || ""}`.trim(),
    owner: `${frontmatter.owner || ""}`.trim(),
    startedAt: `${frontmatter.started_at || ""}`.trim(),
    updated: `${frontmatter.updated || ""}`.trim(),
    reviewAfter: `${frontmatter.review_after || ""}`.trim(),
    sourceRoots: splitCsv(frontmatter.source_roots),
    tags: splitCsv(frontmatter.tags),
    path: relPath,
    legacy: !canonical,
  };

  return {
    manifest,
    sections,
    explicitPaths: extractWorkspaceRelativeLinks(body),
  };
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; bodyStartLine: number } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, bodyStartLine: 1 };
  }
  const lines = raw.split(/\r?\n/);
  const frontmatter: Record<string, string> = {};
  let index = 1;
  for (; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") break;
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = match[2].trim();
  }
  return { frontmatter, bodyStartLine: Math.min(index + 2, lines.length + 1) };
}

function splitCsv(value: unknown): string[] {
  return `${value || ""}`
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractWorkspaceRelativeLinks(raw: string): string[] {
  const paths = new Set<string>();
  for (const match of raw.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0].trim();
    if (!target || /^[a-z]+:\/\//i.test(target)) continue;
    paths.add(target.replace(/^\.\//, ""));
  }
  for (const match of raw.matchAll(/`((?:kb|demo-kb)\/[^`]+)`/g)) {
    paths.add(match[1].trim());
  }
  return [...paths];
}

function fileStem(relPath: string): string {
  const base = relPath.split("/").pop() || relPath;
  return base.replace(/\.[^.]+$/, "");
}

export function sectionItems(section: ProjectSection | undefined): string[] {
  if (!section?.content) return [];
  return section.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^\[[ xX]\]\s+/, ""))
    .filter((line) => Boolean(line) && !line.startsWith("#"));
}

export function sectionSummary(section: ProjectSection | undefined): string {
  if (!section?.content) return "";
  return section.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => Boolean(line) && !line.startsWith("#"))?.replace(/^[-*]\s+/, "") || "";
}
