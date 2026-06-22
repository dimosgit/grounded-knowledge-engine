import {
  normalizeProjectId,
  parseProjectData,
  sectionItems,
  sectionSummary,
} from "../../../../tools/projects/project-manifest";

const COMPLETED_LIFECYCLES = new Set(["completed", "done", "complete", "shipped", "delivered"]);
const ACTIVE_LIFECYCLES = new Set(["active", "in-progress", "in_progress", "wip", "ongoing", "doing"]);
const BLOCKED_LIFECYCLES = new Set(["blocked", "on-hold", "on_hold", "stuck", "waiting"]);
const NEXT_LIFECYCLES = new Set(["next", "todo", "to-do", "planned", "queued", "upcoming", "backlog"]);

export const BUCKET_LIFECYCLE: Record<string, string> = {
  active: "active",
  next: "next",
  blocked: "blocked",
  done: "completed",
  reference: "",
};

export function buildProjectSummaries(docs, lifecycleOverrides: Record<string, string> = {}) {
  const projectGroups = new Map();

  docs
    .filter((doc) => !isArchivedDoc(doc))
    .filter(isProjectDoc)
    .forEach((doc) => {
      const parsed = parseProjectData(doc.frontmatter || {}, doc.content || "", doc.path, doc.title);
      const { manifest, sections, explicitPaths } = parsed;
      if (!manifest.projectId) return;

      const currentStatus = sectionSummary(sections.get("current-status")) || doc.excerpt;
      const currentFocus = sectionSummary(sections.get("current-focus")) || currentStatus;
      const recentChanges =
        sectionSummary(sections.get("last-meaningful-change")) ||
        currentStatus ||
        "No recent change recorded.";
      const activeDecisions = sectionItems(sections.get("active-decisions"));
      const blockers = sectionItems(sections.get("blockers"));
      const openQuestions = sectionItems(sections.get("open-questions"));
      const nextActions = sectionItems(sections.get("next-actions")).slice(0, 5);
      const keyDocuments = unique([
        ...sectionItems(sections.get("key-documents")).map(stripMarkdownLink),
        ...explicitPaths.map((item) => resolveLogicalPath(doc.path, item)),
      ]);
      const lifecycle = (
        lifecycleOverrides[manifest.projectId] ??
        doc.frontmatter?.lifecycle ??
        manifest.status ??
        ""
      ).toLowerCase();
      const eligiblePaths = buildEligiblePaths(docs, doc, manifest.projectId, manifest.sourceRoots, keyDocuments);
      const project = {
        id: manifest.projectId,
        baseId: manifest.projectId,
        title: manifest.title || doc.title,
        track: doc.track,
        trackLabel: doc.trackLabel,
        module: doc.frontmatter?.module || manifest.projectId,
        lifecycle,
        currentStatus,
        currentFocus,
        recentChanges,
        activeDecisions,
        blockers,
        openQuestions,
        blockersAndQuestions: [...blockers, ...openQuestions],
        nextActions,
        keyDocuments,
        updated: manifest.updated || doc.frontmatter?.updated || "",
        reviewAfter: manifest.reviewAfter,
        progressPercent: calculateProjectProgress(doc.content),
        sourceDocPath: doc.path,
        sourceDoc: doc,
        eligiblePaths,
        legacy: manifest.legacy,
      };
      const score = projectRecordScore(doc);
      const existing = projectGroups.get(project.id);
      if (!existing || score > existing.score) projectGroups.set(project.id, { score, project });
    });

  return Array.from(projectGroups.values())
    .map(({ project }) => ({
      ...project,
      statusBucket: getProjectStatusBucket(project),
      handoffMarkdown: formatTechnicalPeerHandoff(project),
    }))
    .sort((a, b) => {
      const statusOrder = { blocked: 0, active: 1, next: 2, done: 3, reference: 4 };
      const statusDelta = statusOrder[a.statusBucket] - statusOrder[b.statusBucket];
      if (statusDelta !== 0) return statusDelta;
      return (b.updated || "").localeCompare(a.updated || "");
    });
}

export function buildOpenQuestionItems(docs) {
  const openQuestionsDoc = docs.find((doc) => doc.path === "kb/open_questions.md");
  if (!openQuestionsDoc) return [];
  return listItems(openQuestionsDoc.content).slice(0, 6).map((label, index) => ({
    id: `open-question-${index}`,
    label,
    path: openQuestionsDoc.path,
  }));
}

export function getActiveProject(projectSummaries, selectedProjectId) {
  if (!projectSummaries.length) return null;
  return (
    projectSummaries.find((project) => project.id === normalizeProjectId(selectedProjectId)) ||
    projectSummaries.find((project) => project.statusBucket === "active") ||
    projectSummaries[0]
  );
}

export function buildProjectColumns(projectSummaries) {
  return {
    active: projectSummaries.filter((project) => project.statusBucket === "active"),
    next: projectSummaries.filter((project) => project.statusBucket === "next"),
    blocked: projectSummaries.filter((project) => project.statusBucket === "blocked"),
    done: projectSummaries.filter((project) => project.statusBucket === "done"),
    reference: projectSummaries.filter((project) => project.statusBucket === "reference"),
  };
}

export function buildProjectLinkedDocs(activeProject, _projectContextGraph, docs) {
  if (!activeProject) return [];
  const eligible = new Set(activeProject.eligiblePaths || []);
  return docs
    .filter((doc) => eligible.has(doc.path))
    .sort((a, b) => {
      if (a.path === activeProject.sourceDocPath) return -1;
      if (b.path === activeProject.sourceDocPath) return 1;
      return a.path.localeCompare(b.path);
    })
    .slice(0, 8);
}

export function formatTechnicalPeerHandoff(project) {
  return [
    `# Technical handoff: ${project.title}`,
    "",
    "## Facts",
    `- Current focus: ${project.currentFocus || "Not recorded."}`,
    `- Recent change: ${project.recentChanges || "Not recorded."}`,
    ...(project.activeDecisions || []).map((item) => `- Decision: ${item}`),
    "",
    "## Risks and unresolved questions",
    ...asMarkdownList(project.blockersAndQuestions || []),
    "",
    "## Recommended next actions",
    ...asMarkdownList((project.nextActions || []).slice(0, 3)),
    "",
    "## Evidence",
    `- ${project.sourceDocPath}`,
    ...(project.keyDocuments || []).map((item) => `- ${item}`),
  ].join("\n");
}

function isProjectDoc(doc): boolean {
  if (doc.frontmatter?.record_type === "project") return true;
  if (doc.frontmatter?.type === "project") return true;
  if (/^kb\/projects\/[^/]+\/project\.md$/.test(doc.path)) return true;
  return ["Current status", "Current focus", "Next 3 actions", "Next actions", "Blockers"].some((heading) =>
    new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(doc.content || ""),
  );
}

function isArchivedDoc(doc): boolean {
  return doc.path?.includes("/archive/") || doc.frontmatter?.type === "redirect" || doc.frontmatter?.status === "merged";
}

function getProjectStatusBucket(project): string {
  const lifecycle = project.lifecycle;
  if (lifecycle && COMPLETED_LIFECYCLES.has(lifecycle)) return "done";
  if (lifecycle && ACTIVE_LIFECYCLES.has(lifecycle)) return "active";
  if (lifecycle && BLOCKED_LIFECYCLES.has(lifecycle)) return "blocked";
  if (lifecycle && NEXT_LIFECYCLES.has(lifecycle)) return "next";
  if (project.blockers.length) return "blocked";
  if (project.currentStatus) return "next";
  return "reference";
}

function projectRecordScore(doc): number {
  let score = 0;
  if (doc.frontmatter?.record_type === "project") score += 20;
  if (/^kb\/projects\/[^/]+\/project\.md$/.test(doc.path)) score += 10;
  if (doc.frontmatter?.project_id) score += 5;
  if (doc.frontmatter?.type === "project") score += 2;
  return score;
}

function buildEligiblePaths(docs, projectDoc, projectId, sourceRoots, keyDocuments): string[] {
  return unique([
    projectDoc.path,
    ...docs
      .filter((doc) => doc.frontmatter?.project_id === projectId)
      .map((doc) => doc.path),
    ...docs
      .filter((doc) =>
        sourceRoots.some((root) => doc.path === root || doc.path.startsWith(`${root.replace(/\/+$/, "")}/`)),
      )
      .map((doc) => doc.path),
    ...keyDocuments,
  ]).filter((candidate) => docs.some((doc) => doc.path === candidate));
}

function resolveLogicalPath(projectPath: string, linkedPath: string): string {
  if (linkedPath.startsWith("kb/")) return linkedPath;
  const parts = [...projectPath.split("/").slice(0, -1), ...linkedPath.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function stripMarkdownLink(value: string): string {
  const match = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  return match ? match[2] : value.replace(/^`|`$/g, "");
}

function calculateProjectProgress(content: string): number | null {
  const tasks = content.match(/^\s*-\s+\[([ xX])\]\s+.+$/gm) || [];
  if (!tasks.length) return null;
  const completed = tasks.filter((task) => /^\s*-\s+\[[xX]\]/.test(task)).length;
  return Math.round((completed / tasks.length) * 100);
}

function asMarkdownList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- None recorded."];
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""));
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
