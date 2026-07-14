import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getKbRetriever } from "../grounding/retriever.js";
import type { IndexedDocument } from "../grounding/types.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { meaningfulSectionItems } from "./project-manifest.js";
import { calculateProjectAttention, isValidIsoDate } from "./project-attention.js";
import { getProject, listProjects } from "./project-service.js";
import { isDocumentInProject, resolveProjectDocument } from "./project-scope.js";
import type {
  ProjectChangedDocument,
  ProjectCitation,
  ProjectReviewEntry,
  ProjectReviewState,
  WorkspaceReviewReport,
} from "./types.js";

const execFileAsync = promisify(execFile);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ReviewWorkspaceArgs {
  asOf?: string;
  since?: string;
  projectId?: string;
  state?: "due" | "overdue" | "all";
}

export async function reviewWorkspace(
  args: ReviewWorkspaceArgs,
  repoRootInput: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<{ contentText: string; structured: WorkspaceReviewReport }> {
  const repoRoot = path.resolve(repoRootInput);
  const asOf = normalizeIsoInput(args.asOf, "asOf", new Date().toISOString());
  const since = args.since ? normalizeIsoInput(args.since, "since") : null;
  if (since && Date.parse(since) > Date.parse(asOf)) {
    throw new Error("since must not be later than asOf");
  }
  const state = args.state || "all";
  if (!(["due", "overdue", "all"] as const).includes(state)) {
    throw new Error("state must be due, overdue, or all");
  }

  const requestedProjectId = `${args.projectId || ""}`.trim();
  const summaries = await listProjects({ repoRoot, scanRoots, workspace });
  const projectIds = [...new Set(summaries.map((project) => project.projectId))].filter(
    (projectId) => !requestedProjectId || projectId === requestedProjectId,
  );
  if (requestedProjectId && !projectIds.length) {
    throw new Error(`Unknown project ID: ${requestedProjectId}`);
  }

  const retriever = await getKbRetriever({
    workspace,
    repoRoot,
    scanRoots,
    cacheTtlMs: 15000,
    forceRefresh: false,
  });
  const allDocuments = retriever.getDocuments();
  const gitAvailable = since ? await isGitWorkspace(repoRoot) : false;
  const projects: ProjectReviewEntry[] = [];

  for (const projectId of projectIds) {
    const loaded = await getProject(projectId, { repoRoot, scanRoots, workspace });
    const manifestDocument = resolveProjectDocument(allDocuments, projectId);
    if (!manifestDocument) throw new Error(`Unknown project ID: ${projectId}`);
    const scopedDocuments = allDocuments.filter((document) =>
      isDocumentInProject(
        document,
        projectId,
        manifestDocument.relPath,
        loaded.parsed.manifest.sourceRoots,
        loaded.parsed.explicitPaths,
      ),
    );
    const entry = await buildProjectReview({
      repoRoot,
      asOf,
      since,
      gitAvailable,
      rawProject: loaded.raw,
      manifestDocument,
      scopedDocuments,
      parsed: loaded.parsed,
    });
    if (state === "all" || entry.reviewState === state) projects.push(entry);
  }

  projects.sort(compareProjectReviews);
  const structured: WorkspaceReviewReport = {
    asOf,
    since,
    projectCount: projects.length,
    attentionCount: projects.filter((project) => project.needsAttention).length,
    projects,
  };
  return { contentText: renderWorkspaceReview(structured), structured };
}

async function buildProjectReview({
  repoRoot,
  asOf,
  since,
  gitAvailable,
  rawProject,
  manifestDocument,
  scopedDocuments,
  parsed,
}: {
  repoRoot: string;
  asOf: string;
  since: string | null;
  gitAvailable: boolean;
  rawProject: string;
  manifestDocument: IndexedDocument;
  scopedDocuments: IndexedDocument[];
  parsed: Awaited<ReturnType<typeof getProject>>["parsed"];
}): Promise<ProjectReviewEntry> {
  const manifest = parsed.manifest;
  const blockers = meaningfulSectionItems(parsed.sections.get("blockers"));
  const openQuestions = meaningfulSectionItems(parsed.sections.get("open-questions"));
  const { reviewState, daysUntilReview, needsAttention, attentionReasons } =
    calculateProjectAttention({
      reviewAfter: manifest.reviewAfter,
      asOf,
      status: manifest.status,
      blockers,
      openQuestions,
    });
  const changedDocuments = since
    ? await findChangedDocuments({ repoRoot, since, gitAvailable, documents: scopedDocuments })
    : [];
  const citations = uniqueCitations([
    reviewCitation(rawProject, manifestDocument.relPath),
    sectionCitation(parsed.sections.get("blockers"), manifestDocument.relPath),
    sectionCitation(parsed.sections.get("open-questions"), manifestDocument.relPath),
    ...changedDocuments.map((document) => document.citation),
  ]);

  return {
    projectId: manifest.projectId,
    title: manifest.title,
    status: manifest.status,
    path: manifestDocument.relPath,
    reviewAfter: manifest.reviewAfter,
    reviewState,
    daysUntilReview,
    needsAttention,
    attentionReasons,
    blockers,
    openQuestions,
    changedDocuments,
    citations,
  };
}

async function findChangedDocuments({
  repoRoot,
  since,
  gitAvailable,
  documents,
}: {
  repoRoot: string;
  since: string;
  gitAvailable: boolean;
  documents: IndexedDocument[];
}): Promise<ProjectChangedDocument[]> {
  const changed = await Promise.all(
    documents.map(async (document) => {
      const absPath = resolveDocumentPath(repoRoot, document.relPath);
      if (gitAvailable) {
        const tracked = await isGitTracked(repoRoot, document.relPath);
        if (tracked) {
          const committedAt = await getGitChangeDate(repoRoot, document.relPath, since);
          if (committedAt) {
            return changedDocument(document, committedAt, "git", await citationLine(absPath));
          }
          const dirty = await isGitDirty(repoRoot, document.relPath);
          if (!dirty) return null;
        }
      }
      return fallbackChangedDocument(document, absPath, since);
    }),
  );
  return changed
    .filter((document): document is ProjectChangedDocument => Boolean(document))
    .sort(
      (left, right) =>
        changeSortValue(right.changedAt) - changeSortValue(left.changedAt) ||
        left.path.localeCompare(right.path),
    );
}

async function fallbackChangedDocument(
  document: IndexedDocument,
  absPath: string,
  since: string,
): Promise<ProjectChangedDocument | null> {
  const sinceMs = Date.parse(since);
  const updated = document.frontmatter.updated;
  if (isValidIsoDate(updated) && updated >= since.slice(0, 10)) {
    return changedDocument(document, updated, "frontmatter", await citationLine(absPath));
  }
  try {
    const stat = await fs.stat(absPath);
    if (stat.mtimeMs >= sinceMs) {
      return changedDocument(
        document,
        stat.mtime.toISOString(),
        "mtime",
        await citationLine(absPath),
      );
    }
  } catch {
    return null;
  }
  return null;
}

function changedDocument(
  document: IndexedDocument,
  changedAt: string,
  source: ProjectChangedDocument["source"],
  line: number,
): ProjectChangedDocument {
  return {
    path: document.relPath,
    title: document.title,
    changedAt,
    source,
    citation: { path: document.relPath, line, section: "Changed document" },
  };
}

async function isGitWorkspace(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isGitTracked(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", relPath]);
    return true;
  } catch {
    return false;
  }
}

async function getGitChangeDate(
  repoRoot: string,
  relPath: string,
  since: string,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoRoot, [
      "log",
      "-1",
      "--format=%cI",
      `--since=${since}`,
      "--",
      relPath,
    ]);
    const value = stdout.trim();
    return value ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

async function isGitDirty(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(repoRoot, [
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      relPath,
    ]);
    return Boolean(stdout.trim());
  } catch {
    return true;
  }
}

async function runGit(repoRoot: string, args: string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout: result.stdout };
}

function resolveDocumentPath(repoRoot: string, relPath: string): string {
  const target = path.resolve(repoRoot, relPath);
  const relative = path.relative(repoRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (!relative) return target;
    throw new Error(`Project document escapes repository root: ${relPath}`);
  }
  return target;
}

async function citationLine(absPath: string): Promise<number> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const index = raw.split(/\r?\n/).findIndex((line) => /^#\s+/.test(line));
    return index >= 0 ? index + 1 : 1;
  } catch {
    return 1;
  }
}

function reviewCitation(raw: string, projectPath: string): ProjectCitation | null {
  const index = raw.split(/\r?\n/).findIndex((line) => /^review_after\s*:/.test(line));
  return index >= 0 ? { path: projectPath, line: index + 1, section: "Review after" } : null;
}

function sectionCitation(
  section: { line: number; heading: string; content: string } | undefined,
  projectPath: string,
): ProjectCitation | null {
  return section?.content
    ? { path: projectPath, line: section.line, section: section.heading }
    : null;
}

function uniqueCitations(citations: Array<ProjectCitation | null>): ProjectCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation): citation is ProjectCitation => {
    if (!citation) return false;
    const key = `${citation.path}:${citation.line}:${citation.section}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareProjectReviews(left: ProjectReviewEntry, right: ProjectReviewEntry): number {
  const rank: Record<ProjectReviewState, number> = {
    overdue: 0,
    due: 1,
    scheduled: 2,
    unscheduled: 3,
    "not-applicable": 4,
  };
  const stateDelta = rank[left.reviewState] - rank[right.reviewState];
  if (stateDelta) return stateDelta;
  if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
  const reviewDelta = dateSortValue(left.reviewAfter) - dateSortValue(right.reviewAfter);
  return reviewDelta || left.projectId.localeCompare(right.projectId);
}

function renderWorkspaceReview(report: WorkspaceReviewReport): string {
  const lines = [
    "# Workspace review",
    "",
    `As of: ${report.asOf}`,
    `Since: ${report.since || "not requested"}`,
    `Projects: ${report.projectCount}`,
    `Need attention: ${report.attentionCount}`,
  ];
  for (const project of report.projects) {
    lines.push(
      "",
      `## ${project.title} (${project.projectId})`,
      `- Review: ${project.reviewState}${project.reviewAfter ? ` (${project.reviewAfter})` : ""}`,
      `- Status: ${project.status || "not recorded"}`,
    );
    if (project.attentionReasons.length) {
      lines.push(...project.attentionReasons.map((reason) => `- Attention: ${reason}`));
    } else {
      lines.push("- Attention: none");
    }
    if (report.since) {
      lines.push(
        ...(project.changedDocuments.length
          ? project.changedDocuments.map(
              (document) =>
                `- Changed: ${document.path}:${document.citation.line} (${document.source}, ${document.changedAt})`,
            )
          : ["- Changed: none"]),
      );
    }
  }
  return lines.join("\n");
}

function normalizeIsoInput(value: string | undefined, field: string, fallback?: string): string {
  const raw = `${value || fallback || ""}`.trim();
  if (DATE_PATTERN.test(raw) && isValidIsoDate(raw)) return `${raw}T00:00:00.000Z`;
  if (!TIMESTAMP_PATTERN.test(raw)) {
    throw new Error(`${field} must be an ISO date or timestamp`);
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO date or timestamp`);
  return new Date(parsed).toISOString();
}

function dateSortValue(value: string): number {
  return isValidIsoDate(value) ? Date.parse(`${value}T00:00:00.000Z`) : Number.MAX_SAFE_INTEGER;
}

function changeSortValue(value: string): number {
  if (isValidIsoDate(value)) return Date.parse(`${value}T00:00:00.000Z`);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
