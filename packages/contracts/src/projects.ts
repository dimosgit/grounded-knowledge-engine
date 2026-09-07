/**
 * Browser-safe project record contract shared by the engine and UI surfaces.
 * Keep this module free of Node, browser, React, transport, and filesystem APIs.
 */

export const PROJECT_CONTRACT_VERSION = 1 as const;

export interface ProjectManifest {
  projectId: string;
  title: string;
  workspaceId: string;
  status: string;
  owner: string;
  track: string;
  startedAt: string;
  updated: string;
  reviewAfter: string;
  sourceRoots: string[];
  tags: string[];
  path: string;
  legacy: boolean;
}

export interface ProjectSection {
  key: string;
  heading: string;
  content: string;
  line: number;
}

export interface ParsedProjectDocument {
  manifest: ProjectManifest;
  sections: Map<string, ProjectSection>;
  explicitPaths: string[];
}

export interface ProjectCitation {
  path: string;
  line: number;
  section: string;
}

export type ProjectValidationSeverity = "error" | "warning";

export interface ProjectValidationIssue {
  severity: ProjectValidationSeverity;
  code: string;
  message: string;
  path: string;
  field?: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  projectId: string;
  path: string;
  issues: ProjectValidationIssue[];
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  status: string;
  owner: string;
  track: string;
  updated: string;
  path: string;
  workspaceId: string;
}

export type ProjectReviewState = "due" | "overdue" | "scheduled" | "unscheduled" | "not-applicable";

export type ProjectChangeSource = "git" | "frontmatter" | "mtime";

export interface ProjectChangedDocument {
  path: string;
  title: string;
  changedAt: string;
  source: ProjectChangeSource;
  citation: ProjectCitation;
}

export interface ProjectReviewEntry {
  projectId: string;
  title: string;
  status: string;
  path: string;
  reviewAfter: string;
  reviewState: ProjectReviewState;
  daysUntilReview: number | null;
  needsAttention: boolean;
  attentionReasons: string[];
  blockers: string[];
  openQuestions: string[];
  changedDocuments: ProjectChangedDocument[];
  citations: ProjectCitation[];
}

export interface WorkspaceReviewReport {
  asOf: string;
  since: string | null;
  projectCount: number;
  attentionCount: number;
  projects: ProjectReviewEntry[];
}

export interface ProjectCapsule {
  projectId: string;
  title: string;
  status: string;
  startHereBrief: string;
  currentFocus: string;
  recentChanges: string;
  recommendedNextAction: string;
  activeDecisions: string[];
  blockers: string[];
  openQuestions: string[];
  blockersAndQuestions: string[];
  completedSinceCheckpoint: string[];
  latestCheckpointAt: string;
  nextThreeActions: string[];
  keyDocuments: string[];
  citations: ProjectCitation[];
}

export interface ProjectAttentionInput {
  reviewAfter: string;
  asOf: string;
  status: string;
  blockers?: string[];
  openQuestions?: string[];
}

export interface ProjectAttention {
  reviewState: ProjectReviewState;
  daysUntilReview: number | null;
  needsAttention: boolean;
  attentionReasons: string[];
}

const COMPLETED_STATUSES = new Set(["completed", "complete", "done", "shipped", "delivered"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Browser-safe daily-attention rules shared by the engine and Cockpit. */
export function calculateProjectAttention(input: ProjectAttentionInput): ProjectAttention {
  const completed = isCompletedProjectStatus(input.status);
  const { reviewState, daysUntilReview } = calculateProjectReviewState(
    input.reviewAfter,
    input.asOf,
    completed,
  );
  const attentionReasons = completed
    ? []
    : buildProjectAttentionReasons(
        reviewState,
        input.reviewAfter,
        input.blockers || [],
        input.openQuestions || [],
      );
  return {
    reviewState,
    daysUntilReview,
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
  };
}

export function isCompletedProjectStatus(status: string): boolean {
  return COMPLETED_STATUSES.has(`${status || ""}`.trim().toLowerCase());
}

export function calculateProjectReviewState(
  reviewAfter: string,
  asOf: string,
  completed = false,
): { reviewState: ProjectReviewState; daysUntilReview: number | null } {
  if (completed) return { reviewState: "not-applicable", daysUntilReview: null };
  if (!isValidIsoDate(reviewAfter)) {
    return { reviewState: "unscheduled", daysUntilReview: null };
  }
  const asOfDate = `${asOf || ""}`.slice(0, 10);
  if (!isValidIsoDate(asOfDate)) {
    throw new Error("asOf must contain a valid ISO date");
  }
  const reviewMs = Date.parse(`${reviewAfter}T00:00:00.000Z`);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const daysUntilReview = Math.round((reviewMs - asOfMs) / DAY_MS);
  return {
    reviewState: daysUntilReview < 0 ? "overdue" : daysUntilReview === 0 ? "due" : "scheduled",
    daysUntilReview,
  };
}

export function buildProjectAttentionReasons(
  reviewState: ProjectReviewState,
  reviewAfter: string,
  blockers: string[],
  openQuestions: string[],
): string[] {
  const reasons: string[] = [];
  if (reviewState === "overdue") reasons.push(`Review overdue since ${reviewAfter}`);
  if (reviewState === "due") reasons.push(`Review due ${reviewAfter}`);
  if (blockers.length) {
    reasons.push(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`);
  }
  if (openQuestions.length) {
    reasons.push(`${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"}`);
  }
  return reasons;
}

export function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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

export function parseProjectDocument(
  raw: string,
  relPath: string,
  fallbackTitle: string,
): ParsedProjectDocument {
  const { frontmatter, bodyStartLine } = parseProjectFrontmatter(raw);
  const body = raw
    .split(/\r?\n/)
    .slice(bodyStartLine - 1)
    .join("\n");
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

  const canonicalPathMatch = relPath.match(
    /(?:^|\/)(?:demo-kb|kb)\/projects\/([^/]+)\/project\.md$/,
  );
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
    track: `${frontmatter.track || "general"}`.trim(),
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

export function parseProjectFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  bodyStartLine: number;
} {
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

const LIST_ITEM_MARKER = /^([-*]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/;

export function sectionItems(section: ProjectSection | undefined): string[] {
  if (!section?.content) return [];
  const items: string[] = [];
  for (const rawLine of section.content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const text = trimmed
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^\[[ xX]\]\s+/, "");
    if (LIST_ITEM_MARKER.test(trimmed) || items.length === 0) {
      items.push(text);
    } else {
      items[items.length - 1] = `${items[items.length - 1]} ${text}`.trim();
    }
  }
  return items.filter(Boolean);
}

export function meaningfulSectionItems(section: ProjectSection | undefined): string[] {
  return sectionItems(section).filter((item) => !isPlaceholderSectionItem(item));
}

export function isPlaceholderSectionItem(item: string): boolean {
  return /^(?:none|no (?:active |critical |current |hard )?blockers?)(?:\b|[.:\u2014-])/i.test(
    item.trim(),
  );
}

export function sectionSummary(section: ProjectSection | undefined): string {
  if (!section?.content) return "";
  const lines = section.content.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => Boolean(line) && !line.startsWith("#"));
  if (start < 0) return "";

  const first = lines[start];
  if (/^[-*]\s+/.test(first) || /^\d+[.)]\s+/.test(first)) {
    return first.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
  }

  const paragraph: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.startsWith("#") || /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) break;
    paragraph.push(line);
  }
  return paragraph.join(" ");
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

// Status circles used in project checklists (see the Legend line in project
// records). The checkbox itself is the status ([x] done, [ ] not started); a
// circle appears only when it adds information the checkbox cannot express:
// 🟡 in progress · 🔴 gated/waiting. Legacy 🟢/⚪ markers are still parsed.
const TASK_STATUS_EMOJI: Record<string, string> = {
  "🟢": "done",
  "🟡": "inProgress",
  "🔴": "gated",
  "⚪": "todo",
};

// Parses every `- [ ] / - [x]` checklist line in a project doc into a task the
// UI can render directly. The circle emoji (when present) refines the status;
// a checked box always means done. The trailing [XS|S|M|L|XL] complexity
// marker is split out so views can show it as a chip.
export function parseProjectTasks(content: string) {
  const taskRegex = /^\s*-\s+\[([ xX])\]\s+(.*)$/;
  const tasks: Array<{ text: string; status: string; weight: string | null }> = [];

  for (const line of (content || "").split("\n")) {
    const match = line.match(taskRegex);
    if (!match) continue;
    const checked = match[1].trim().toLowerCase() === "x";
    let text = match[2].trim();

    let status = checked ? "done" : "todo";
    const emojiMatch = text.match(/^(🟢|🟡|🔴|⚪)\s*/u);
    if (emojiMatch) {
      if (!checked) status = TASK_STATUS_EMOJI[emojiMatch[1]] || status;
      text = text.slice(emojiMatch[0].length);
    }

    const weightMatch = text.match(/\s*[[(](XS|S|M|L|XL)[\])]$/i);
    const weight = weightMatch ? weightMatch[1].toUpperCase() : null;
    if (weightMatch) text = text.slice(0, weightMatch.index).trim();

    tasks.push({ text: stripInlineMarkdown(text), status, weight });
  }
  return tasks;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Select actionable tasks once for every surface; recorded prose is a legacy fallback. */
export function selectProjectNextActions(input: {
  content: string;
  status: string;
  recordedNextActions: string[];
  fallbackAction?: string;
}) {
  const tasks = parseProjectTasks(input.content);
  const hasChecklist =
    tasks.length > 0 || /^##\s+(?:delivery|execution) checklist\s*$/im.test(input.content);
  const completed = isCompletedProjectStatus(input.status);
  const actions = completed
    ? []
    : hasChecklist
      ? [
          ...tasks.filter((task) => task.status === "inProgress"),
          ...tasks.filter((task) => task.status === "todo"),
        ].map((task) => task.text)
      : [
          ...new Set(
            [input.fallbackAction, ...input.recordedNextActions].filter((value): value is string =>
              Boolean(value),
            ),
          ),
        ];
  return {
    tasks,
    nextActions: actions.slice(0, 5),
    recommendedNextAction: completed
      ? "Project completed; no next action required."
      : actions[0] || "No next action recorded.",
    nextThreeActions: actions.slice(0, 3),
  };
}

export interface ProjectScopeDocument {
  relPath: string;
  frontmatter?: Record<string, unknown>;
}

export function createProjectMembership(
  projectId: string,
  manifestPath: string,
  sourceRoots: string[],
  explicitPaths: string[],
): (doc: ProjectScopeDocument) => boolean {
  const id = normalizeProjectId(projectId);
  const roots = [...new Set(sourceRoots.flatMap(equivalentRoots))];
  const canonicalRoots = equivalentRoots(`kb/projects/${id}`);
  const links = new Set(
    explicitPaths.flatMap((linkedPath) => [
      ...equivalentPaths(linkedPath),
      ...equivalentPaths(
        normalizePosixPath([...manifestPath.split("/").slice(0, -1), ...linkedPath.split("/")]),
      ),
    ]),
  );
  return (doc) =>
    doc.relPath === manifestPath ||
    (Boolean(id) && normalizeProjectId(doc.frontmatter?.project_id) === id) ||
    canonicalRoots.some((root) => doc.relPath.startsWith(`${root}/`)) ||
    roots.some((root) => doc.relPath === root || doc.relPath.startsWith(`${root}/`)) ||
    links.has(doc.relPath);
}

export function isDocumentInProject(
  doc: ProjectScopeDocument,
  projectId: string,
  manifestPath: string,
  sourceRoots: string[],
  explicitPaths: string[],
): boolean {
  return createProjectMembership(projectId, manifestPath, sourceRoots, explicitPaths)(doc);
}

function normalizePosixPath(parts: string[]): string {
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function equivalentRoots(root: string): string[] {
  return equivalentPaths(root.replace(/\/+$/, ""));
}

function equivalentPaths(value: string): string[] {
  const paths = new Set([value]);
  if (value.startsWith("kb/")) paths.add(`demo-kb/${value.slice(3)}`);
  if (value.startsWith("demo-kb/")) paths.add(`kb/${value.slice("demo-kb/".length)}`);
  return [...paths];
}
