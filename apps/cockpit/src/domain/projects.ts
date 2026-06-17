import {
  getMarkdownSection,
  getSectionBullets,
  normalizeFrontmatterScalar,
  toSlug,
} from "./docs";

function hasProjectSections(doc: any) {
  return ["Current status", "Current focus", "Next 3 actions", "Blockers"].some((heading) =>
    Boolean(getMarkdownSection(doc.content, heading).trim()),
  );
}

function getProjectId(doc) {
  return normalizeFrontmatterScalar(doc.frontmatter?.module) || toSlug(doc.title || doc.path);
}

const COMPLETED_LIFECYCLES = new Set(["completed", "done", "complete", "shipped", "delivered"]);
const ACTIVE_LIFECYCLES = new Set(["active", "in-progress", "in_progress", "wip", "ongoing", "doing"]);
const BLOCKED_LIFECYCLES = new Set(["blocked", "on-hold", "on_hold", "stuck", "waiting"]);
const NEXT_LIFECYCLES = new Set(["next", "todo", "to-do", "planned", "queued", "upcoming", "backlog"]);

// Canonical `lifecycle:` value written back to source markdown for each board
// lane. The empty string clears the field so the card falls back to the content
// heuristic ("Auto"). Inverse of the *_LIFECYCLES sets above.
export const BUCKET_LIFECYCLE: Record<string, string> = {
  active: "active",
  next: "next",
  blocked: "blocked",
  done: "completed",
  reference: "",
};

function getProjectStatusBucket(project) {
  // Explicit author intent (frontmatter `lifecycle`) wins over content
  // heuristics. "Active Now" is opt-in: a project only lands there when its
  // author marks it `lifecycle: active`, so the lane reflects what is genuinely
  // being worked on rather than "any doc that happens to list next actions".
  const lifecycle = project.lifecycle;
  if (lifecycle && COMPLETED_LIFECYCLES.has(lifecycle)) return "done";
  if (lifecycle && ACTIVE_LIFECYCLES.has(lifecycle)) return "active";
  if (lifecycle && BLOCKED_LIFECYCLES.has(lifecycle)) return "blocked";
  if (lifecycle && NEXT_LIFECYCLES.has(lifecycle)) return "next";

  // No explicit lifecycle: fall back to content. A real blocker still forces the
  // blocked lane; everything else with a status is "Next Up" (to start).
  if (project.blockers.length) return "blocked";
  if (project.currentStatus) return "next";
  return "reference";
}

function getFirstParagraph(sectionContent) {
  return sectionContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("- ")) || "";
}

function calculateProjectProgress(content: string) {
  const lines = content.split('\n');
  let totalWeight = 0;
  let completedWeight = 0;
  
  const weightMap: Record<string, number> = {
    'S': 1,
    'M': 3,
    'L': 5,
    'XL': 8,
    'XS': 0.5
  };

  const taskRegex = /^\s*-\s+\[([ xX])\]\s+(.*)$/;
  
  for (const line of lines) {
    const match = line.match(taskRegex);
    if (match) {
      const isCompleted = match[1].trim().toLowerCase() === 'x';
      const text = match[2];
      
      // Look for a complexity marker like [M] or (M) or [XL] at the end of the line
      const markerMatch = text.match(/[\[\(](XS|S|M|L|XL)[\]\)]$/i);
      let weight = 1; // Default
      if (markerMatch) {
        weight = weightMap[markerMatch[1].toUpperCase()] || 1;
      }
      
      totalWeight += weight;
      if (isCompleted) {
        completedWeight += weight;
      }
    }
  }
  
  if (totalWeight === 0) return null; // No tasks found
  
  return Math.round((completedWeight / totalWeight) * 100);
}

function isArchivedDoc(doc) {
  const path = doc.path || "";
  const type = doc.frontmatter?.type;
  const status = normalizeFrontmatterScalar(doc.frontmatter?.status);
  // Archived snapshots and merged redirect stubs are historical records, not
  // live project contexts. Their frozen `## Blockers` sections must not surface
  // as active (and usually duplicate) blocked cards on the project board.
  return path.includes("/archive/") || type === "redirect" || status === "merged";
}

export function buildProjectSummaries(docs, lifecycleOverrides: Record<string, string> = {}) {
  const projectGroups = new Map();

  docs
    .filter((doc) => !isArchivedDoc(doc))
    .filter((doc) => {
      // Explicitly typed non-projects (like concept, howto, topic) should not be considered projects
      const explicitType = doc.frontmatter?.type;
      if (explicitType && explicitType !== "project") return false;
      return explicitType === "project" || hasProjectSections(doc);
    })
    .forEach((doc) => {
      const baseId = getProjectId(doc);
      
      let score = 0;
      if (doc.frontmatter?.type === "project") score += 10;
      if (doc.title?.toLowerCase().includes("execution board") || doc.title?.toLowerCase().includes("task board")) score += 20;
      // Score based on actual populated project sections
      if (getMarkdownSection(doc.content, "Current status").trim()) score += 2;
      if (getSectionBullets(getMarkdownSection(doc.content, "Next 3 actions")).length > 0) score += 2;
      if (getSectionBullets(getMarkdownSection(doc.content, "Blockers")).length > 0) score += 2;

      const currentStatus = getFirstParagraph(getMarkdownSection(doc.content, "Current status")) || doc.excerpt;
      const currentFocus = getFirstParagraph(getMarkdownSection(doc.content, "Current focus")) || currentStatus;
      const nextActions = getSectionBullets(getMarkdownSection(doc.content, "Next 3 actions")).slice(0, 5);
      const blockers = getSectionBullets(getMarkdownSection(doc.content, "Blockers")).slice(0, 5);
      const updated = normalizeFrontmatterScalar(doc.frontmatter?.updated);
      const module = normalizeFrontmatterScalar(doc.frontmatter?.module);
      const lifecycle = (normalizeFrontmatterScalar(doc.frontmatter?.lifecycle) || "").toLowerCase();
      const progressPercent = calculateProjectProgress(doc.content);

      const projectDraft = {
        id: baseId,
        baseId,
        title: doc.title,
        track: doc.track,
        trackLabel: doc.trackLabel,
        module,
        lifecycle,
        currentStatus,
        currentFocus,
        nextActions,
        blockers,
        updated,
        progressPercent,
        sourceDocPath: doc.path,
        sourceDoc: doc,
      };

      const existing = projectGroups.get(baseId);
      if (!existing || score > existing.score || (score === existing.score && (updated || "") > (existing.project.updated || ""))) {
        projectGroups.set(baseId, { score, project: projectDraft });
      }
    });

  return Array.from(projectGroups.values())
    .map(({ project }) => {
      // An optimistic UI move (drag-and-drop / lane menu) overrides the
      // markdown-derived lifecycle until the source file is re-synced.
      const override = lifecycleOverrides[project.id];
      const effective =
        override !== undefined ? { ...project, lifecycle: override } : project;
      return {
        ...project,
        statusBucket: getProjectStatusBucket(effective),
      };
    })
    .sort((a, b) => {
      const statusOrder = { blocked: 0, next: 1, active: 2, done: 3, reference: 4 };
      const statusDelta = statusOrder[a.statusBucket] - statusOrder[b.statusBucket];
      if (statusDelta !== 0) return statusDelta;
      return (b.updated || "").localeCompare(a.updated || "");
    });
}

export function buildOpenQuestionItems(docs) {
  const openQuestionsDoc = docs.find((doc) => doc.path === "kb/open_questions.md");
  if (!openQuestionsDoc) return [];
  return getSectionBullets(openQuestionsDoc.content)
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
    projectSummaries.find((project) => project.id === selectedProjectId) ||
    projectSummaries.find((project) => project.baseId === selectedProjectId) ||
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

export function buildProjectLinkedDocs(activeProject, projectContextGraph, docs) {
  return [
    activeProject?.sourceDoc,
    ...projectContextGraph.nodes
      .filter((node) => node.path !== activeProject?.sourceDocPath)
      .map((node) => docs.find((doc) => doc.path === node.path))
      .filter(Boolean),
  ]
    .filter(Boolean)
    .slice(0, 6);
}
