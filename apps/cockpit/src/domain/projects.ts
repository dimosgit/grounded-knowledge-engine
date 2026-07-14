import {
  meaningfulSectionItems,
  normalizeProjectId,
  parseProjectData,
  sectionItems,
  sectionSummary,
} from "../../../../tools/projects/project-manifest";
import {
  calculateProjectAttention,
  isCompletedProjectStatus,
} from "../../../../tools/projects/project-attention";

const ACTIVE_LIFECYCLES = new Set([
  "active",
  "in-progress",
  "in_progress",
  "wip",
  "ongoing",
  "doing",
]);
const BLOCKED_LIFECYCLES = new Set(["blocked", "on-hold", "on_hold", "stuck", "waiting"]);
const NEXT_LIFECYCLES = new Set([
  "next",
  "todo",
  "to-do",
  "planned",
  "queued",
  "upcoming",
  "backlog",
]);

export const BUCKET_LIFECYCLE: Record<string, string> = {
  active: "active",
  next: "next",
  blocked: "blocked",
  done: "completed",
  reference: "",
};

export const PROJECT_ATTENTION_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs-attention", label: "Needs attention" },
  { key: "overdue", label: "Overdue" },
  { key: "blocked", label: "Blocked" },
  { key: "open-questions", label: "Open questions" },
] as const;

export type ProjectAttentionFilter = (typeof PROJECT_ATTENTION_FILTERS)[number]["key"];

export function buildProjectSummaries(
  docs,
  lifecycleOverrides: Record<string, string> = {},
  options: { asOf?: string } = {},
) {
  const projectGroups = new Map();

  docs
    .filter((doc) => !isArchivedDoc(doc))
    .filter(isProjectDoc)
    .forEach((doc) => {
      const parsed = parseProjectData(
        doc.frontmatter || {},
        doc.content || "",
        doc.path,
        doc.title,
      );
      const { manifest, sections, explicitPaths } = parsed;
      if (!manifest.projectId) return;

      const outcome = sectionSummary(sections.get("outcome"));
      const currentStatus = sectionSummary(sections.get("current-status")) || doc.excerpt;
      const currentFocus = sectionSummary(sections.get("current-focus")) || currentStatus;
      const recentChanges =
        sectionSummary(sections.get("last-meaningful-change")) ||
        currentStatus ||
        "No recent change recorded.";
      const activeDecisions = meaningfulSectionItems(sections.get("active-decisions"));
      const blockers = meaningfulSectionItems(sections.get("blockers")).slice(0, 5);
      const openQuestions = meaningfulSectionItems(sections.get("open-questions"));
      const hasLifecycleOverride = Object.prototype.hasOwnProperty.call(
        lifecycleOverrides,
        manifest.projectId,
      );
      const resolvedStatus = (
        hasLifecycleOverride
          ? lifecycleOverrides[manifest.projectId]
          : normalizeFrontmatterScalar(doc.frontmatter?.lifecycle) || manifest.status || ""
      ).toLowerCase();
      const completed = isCompletedProjectStatus(resolvedStatus);
      // Single source of truth for tasks: when the record has a checklist,
      // "next" is derived from its open items (in progress first, then not
      // started, in checklist order — checklists are priority-ordered among
      // open items). The `## Next actions` section is only a fallback for
      // records without a checklist, so a task update is one checkbox edit.
      const tasks = parseProjectTasks(doc.content);
      const derivedNextActions = [
        ...tasks.filter((task) => task.status === "inProgress"),
        ...tasks.filter((task) => task.status === "todo"),
      ].map((task) => task.text);
      const nextActions = completed
        ? []
        : (derivedNextActions.length
            ? derivedNextActions
            : meaningfulSectionItems(sections.get("next-actions"))
          ).slice(0, 5);
      const keyDocuments = unique([
        ...sectionItems(sections.get("key-documents")).map(stripMarkdownLink),
        ...explicitPaths.map((item) => resolveLogicalPath(doc.path, item)),
      ]);
      const startHereBrief = outcome || currentStatus || currentFocus;
      const lifecycle = resolvedStatus;
      const eligiblePaths = buildEligiblePaths(
        docs,
        doc,
        manifest.projectId,
        manifest.sourceRoots,
        keyDocuments,
      );
      const projectCore = {
        id: manifest.projectId,
        baseId: manifest.projectId,
        title: manifest.title || doc.title,
        track: doc.track,
        trackLabel: doc.trackLabel,
        module: normalizeFrontmatterScalar(doc.frontmatter?.module) || manifest.projectId,
        lifecycle,
        startHereBrief,
        currentStatus,
        currentFocus,
        recentChanges,
        activeDecisions,
        blockers,
        openQuestions,
        blockersAndQuestions: [...blockers, ...openQuestions],
        nextActions,
        keyDocuments,
        updated: manifest.updated || normalizeFrontmatterScalar(doc.frontmatter?.updated),
        reviewAfter: manifest.reviewAfter,
        progressPercent: calculateProjectProgress(doc.content),
        tasks,
        taskCounts: countProjectTasks(tasks),
        sourceDocPath: doc.path,
        sourceDoc: doc,
        eligiblePaths,
        legacy: manifest.legacy,
        ...calculateProjectAttention({
          reviewAfter: manifest.reviewAfter,
          asOf: options.asOf || new Date().toISOString(),
          status: resolvedStatus,
          blockers,
          openQuestions,
        }),
      };
      const project = {
        ...projectCore,
        glance: buildProjectGlance(projectCore),
      };
      const score = projectRecordScore(doc);
      const existing = projectGroups.get(project.id);
      if (
        !existing ||
        score > existing.score ||
        (score === existing.score && (project.updated || "") > (existing.project.updated || ""))
      ) {
        projectGroups.set(project.id, { score, project });
      }
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

export function countProjectTasks(tasks: Array<{ status: string }>) {
  const counts = { done: 0, inProgress: 0, gated: 0, todo: 0, total: tasks.length };
  for (const task of tasks) {
    if (task.status === "done") counts.done += 1;
    else if (task.status === "inProgress") counts.inProgress += 1;
    else if (task.status === "gated") counts.gated += 1;
    else counts.todo += 1;
  }
  return counts;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function compactProjectText(value: string, maxLength: number): string {
  // Glance surfaces render plain text, so inline markdown (bold, links, code)
  // must not leak through as literal asterisks/brackets.
  const normalized = stripInlineMarkdown(`${value || ""}`.replace(/\s+/g, " ").trim());
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, Math.max(0, maxLength - 1));
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.65) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}…`;
}

function buildProjectGlance(project) {
  return {
    startHere: compactProjectText(project.startHereBrief, 180),
    currentFocus: compactProjectText(project.currentFocus, 160),
    recentChanges: compactProjectText(project.recentChanges, 160),
    blocker: compactProjectText(project.blockers[0] || "", 160),
    activeDecisions: project.activeDecisions
      .slice(0, 2)
      .map((item) => compactProjectText(item, 150)),
    openQuestions: project.openQuestions.slice(0, 2).map((item) => compactProjectText(item, 150)),
    nextActions: project.nextActions.slice(0, 3).map((item) => compactProjectText(item, 160)),
  };
}

export function buildOpenQuestionItems(docs) {
  const openQuestionsDoc = docs.find((doc) => doc.path === "kb/open_questions.md");
  if (!openQuestionsDoc) return [];
  return listItems(openQuestionsDoc.content)
    .slice(0, 6)
    .map((label, index) => ({
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

export function filterProjectSummaries(projectSummaries, filter: ProjectAttentionFilter = "all") {
  if (filter === "needs-attention") {
    return projectSummaries.filter((project) => project.needsAttention);
  }
  if (filter === "overdue") {
    return projectSummaries.filter((project) => project.reviewState === "overdue");
  }
  if (filter === "blocked") {
    return projectSummaries.filter(
      (project) =>
        project.reviewState !== "not-applicable" &&
        (project.statusBucket === "blocked" || project.blockers.length > 0),
    );
  }
  if (filter === "open-questions") {
    return projectSummaries.filter((project) => project.openQuestions.length > 0);
  }
  return projectSummaries;
}

export function buildProjectAttentionCounts(projectSummaries) {
  const due = projectSummaries.filter((project) => project.reviewState === "due").length;
  const overdue = projectSummaries.filter((project) => project.reviewState === "overdue").length;
  return {
    due,
    overdue,
    dueOrOverdue: due + overdue,
    blocked: filterProjectSummaries(projectSummaries, "blocked").length,
    openQuestions: filterProjectSummaries(projectSummaries, "open-questions").length,
    needsAttention: filterProjectSummaries(projectSummaries, "needs-attention").length,
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
  if (/^(?:demo-kb|kb)\/projects\/[^/]+\/project\.md$/.test(doc.path || "")) return true;
  const explicitType = doc.frontmatter?.type;
  if (explicitType && explicitType !== "project") return false;
  return ["Current status", "Current focus", "Next 3 actions", "Next actions", "Blockers"].some(
    (heading) => new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(doc.content || ""),
  );
}

function isArchivedDoc(doc): boolean {
  return (
    doc.path?.includes("/archive/") ||
    doc.frontmatter?.type === "redirect" ||
    doc.frontmatter?.status === "merged"
  );
}

function getProjectStatusBucket(project): string {
  const lifecycle = project.lifecycle;
  if (lifecycle && isCompletedProjectStatus(lifecycle)) return "done";
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
  if (/^(?:demo-kb|kb)\/projects\/[^/]+\/project\.md$/.test(doc.path || "")) score += 10;
  if (doc.frontmatter?.project_id) score += 5;
  if (doc.frontmatter?.type === "project") score += 2;
  return score;
}

function buildEligiblePaths(docs, projectDoc, projectId, sourceRoots, keyDocuments): string[] {
  return unique([
    projectDoc.path,
    ...docs.filter((doc) => doc.frontmatter?.project_id === projectId).map((doc) => doc.path),
    ...docs
      .filter((doc) =>
        sourceRoots.some(
          (root) => doc.path === root || doc.path.startsWith(`${root.replace(/\/+$/, "")}/`),
        ),
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

function calculateProjectProgress(content: string) {
  const lines = content.split("\n");
  let totalWeight = 0;
  let completedWeight = 0;
  const weightMap: Record<string, number> = { XS: 0.5, S: 1, M: 3, L: 5, XL: 8 };
  const taskRegex = /^\s*-\s+\[([ xX])\]\s+(.*)$/;

  for (const line of lines) {
    const match = line.match(taskRegex);
    if (!match) continue;
    const markerMatch = match[2].match(/[[(](XS|S|M|L|XL)[\])]$/i);
    const weight = markerMatch ? weightMap[markerMatch[1].toUpperCase()] || 1 : 1;
    totalWeight += weight;
    if (match[1].trim().toLowerCase() === "x") completedWeight += weight;
  }

  if (totalWeight === 0) return null;
  return Math.round((completedWeight / totalWeight) * 100);
}

function normalizeFrontmatterScalar(value): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
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
