export type ProjectContextGroupKey = "work" | "attention" | "decisions" | "history" | "evidence";

export type ProjectContextFilter = "all" | ProjectContextGroupKey;

export interface ProjectContextItem {
  id: string;
  label: string;
  detail: string;
  meta: string;
  destination?: "delivery-checklist";
  path?: string;
  decisionId?: string;
  status?: string;
}

export interface ProjectContextGroup {
  key: ProjectContextGroupKey;
  label: string;
  description: string;
  items: ProjectContextItem[];
}

export interface ProjectContextMap {
  projectId: string;
  sourcePath: string;
  groups: ProjectContextGroup[];
  totalItems: number;
}

interface ProjectContextDoc {
  path: string;
  title?: string;
  excerpt?: string;
  content?: string;
  docType?: string;
  frontmatter?: Record<string, unknown>;
}

const GROUP_DEFINITIONS: Array<
  Omit<ProjectContextGroup, "items"> & { key: ProjectContextGroupKey }
> = [
  {
    key: "work",
    label: "Current work",
    description: "Focus, active tasks, and the next concrete moves.",
  },
  {
    key: "attention",
    label: "Needs attention",
    description: "Blockers, gates, and questions that need resolution.",
  },
  {
    key: "decisions",
    label: "Decisions",
    description: "Recorded choices that constrain or guide this project.",
  },
  {
    key: "history",
    label: "History",
    description: "Checkpoints and meaningful changes that explain the current state.",
  },
  {
    key: "evidence",
    label: "Evidence",
    description: "The project record and explicitly scoped supporting documents.",
  },
];

const EMPTY_VALUES = new Set([
  "",
  "none",
  "none.",
  "none recorded",
  "none recorded.",
  "n/a",
  "not applicable",
]);

export function buildProjectContextMap(project, docs: ProjectContextDoc[]): ProjectContextMap {
  if (!project) {
    return { projectId: "", sourcePath: "", groups: createEmptyGroups(), totalItems: 0 };
  }

  const docsByPath = new Map<string, ProjectContextDoc>(docs.map((doc) => [doc.path, doc]));
  const sourcePath = project.sourceDocPath || "";
  const work: ProjectContextItem[] = [];
  const attention: ProjectContextItem[] = [];
  const decisions: ProjectContextItem[] = [];
  const history: ProjectContextItem[] = [];
  const evidence: ProjectContextItem[] = [];

  if (meaningful(project.currentFocus)) {
    work.push({
      id: "current-focus",
      label: "Current focus",
      detail: project.currentFocus,
      meta: "Focus",
      path: sourcePath,
    });
  }

  const openTasks = (project.tasks || []).filter((task) => task.status !== "done");
  if (openTasks.length) {
    for (const [index, task] of openTasks.entries()) {
      const statusLabel = taskStatusLabel(task.status);
      work.push({
        id: `task:${index}:${slug(task.text)}`,
        label: task.text,
        detail: statusLabel,
        meta: [statusLabel, task.weight].filter(Boolean).join(" · "),
        destination: "delivery-checklist",
        status: task.status,
        path: sourcePath,
      });
    }
  } else {
    for (const [index, action] of (project.nextActions || []).entries()) {
      if (!meaningful(action)) continue;
      work.push({
        id: `next-action:${index}`,
        label: action,
        detail: "Recorded in the project's next actions.",
        meta: `Next action ${index + 1}`,
        status: "todo",
        path: sourcePath,
      });
    }
  }

  for (const [index, blocker] of (project.blockers || []).entries()) {
    if (!meaningful(blocker)) continue;
    attention.push({
      id: `blocker:${index}`,
      label: blocker,
      detail: "Recorded project blocker.",
      meta: "Blocker",
      status: "blocked",
      path: sourcePath,
    });
  }

  for (const [index, question] of (project.openQuestions || []).entries()) {
    if (!meaningful(question)) continue;
    attention.push({
      id: `question:${index}`,
      label: question,
      detail: "Open question awaiting evidence or a decision.",
      meta: "Open question",
      status: "question",
      path: sourcePath,
    });
  }

  for (const [index, task] of openTasks.filter((item) => item.status === "gated").entries()) {
    if (attention.some((item) => normalize(item.label) === normalize(task.text))) continue;
    attention.push({
      id: `gated-task:${index}:${slug(task.text)}`,
      label: task.text,
      detail: "Checklist item marked as gated or waiting.",
      meta: ["Gated task", task.weight].filter(Boolean).join(" · "),
      destination: "delivery-checklist",
      status: "blocked",
      path: sourcePath,
    });
  }

  const decisionDocs = docs.filter(
    (doc) => recordType(doc) === "decision" && scalar(doc.frontmatter?.project_id) === project.id,
  );
  const explicitDecisionLabels = new Set<string>();
  for (const doc of decisionDocs) {
    const label = scalar(doc.frontmatter?.title) || doc.title || "Untitled decision";
    explicitDecisionLabels.add(normalize(label));
    decisions.push({
      id: `decision:${scalar(doc.frontmatter?.decision_id) || doc.path}`,
      label,
      detail: doc.excerpt || "Project decision record.",
      meta: [scalar(doc.frontmatter?.status) || "recorded", reviewLabel(doc.frontmatter)]
        .filter(Boolean)
        .join(" · "),
      status: scalar(doc.frontmatter?.status),
      path: doc.path,
      decisionId:
        scalar(doc.frontmatter?.decision_id) && scalar(doc.frontmatter?.review_after)
          ? scalar(doc.frontmatter?.decision_id)
          : undefined,
    });
  }

  for (const [index, decision] of (project.activeDecisions || []).entries()) {
    if (!meaningful(decision) || explicitDecisionLabels.has(normalize(decision))) continue;
    decisions.push({
      id: `inline-decision:${index}`,
      label: decision,
      detail: "Decision recorded in the project document.",
      meta: "Active decision",
      status: "active",
      path: sourcePath,
    });
  }

  const checkpointDocs = docs
    .filter(
      (doc) =>
        recordType(doc) === "checkpoint" && scalar(doc.frontmatter?.project_id) === project.id,
    )
    .sort((a, b) => checkpointDate(b).localeCompare(checkpointDate(a)));
  for (const doc of checkpointDocs) {
    history.push({
      id: `checkpoint:${scalar(doc.frontmatter?.checkpoint_id) || doc.path}`,
      label: scalar(doc.frontmatter?.title) || doc.title || "Project checkpoint",
      detail: sectionSummary(doc.content || "", "What changed") || doc.excerpt || "Checkpoint",
      meta: ["Checkpoint", checkpointDate(doc)].filter(Boolean).join(" · "),
      path: doc.path,
    });
  }

  if (meaningful(project.recentChanges)) {
    history.push({
      id: "latest-change",
      label: "Latest meaningful change",
      detail: project.recentChanges,
      meta: project.updated ? `Project record · ${project.updated}` : "Project record",
      path: sourcePath,
    });
  }

  const sourceDoc = docsByPath.get(sourcePath) || project.sourceDoc;
  evidence.push({
    id: `evidence:${sourcePath || project.id}`,
    label: sourceDoc?.title || project.title || "Project record",
    detail: project.startHereBrief || "Canonical project context.",
    meta: project.legacy ? "Legacy project record" : "Canonical project record",
    path: sourcePath || undefined,
  });

  const excludedPaths = new Set([
    sourcePath,
    ...decisionDocs.map((doc) => doc.path),
    ...checkpointDocs.map((doc) => doc.path),
  ]);
  for (const path of project.eligiblePaths || []) {
    if (!path || excludedPaths.has(path)) continue;
    const doc = docsByPath.get(path);
    if (!doc) continue;
    evidence.push({
      id: `evidence:${path}`,
      label: doc.title || path.split("/").pop() || path,
      detail: doc.excerpt || "Explicitly included in the project scope.",
      meta: evidenceMeta(doc),
      path,
    });
  }

  const itemsByGroup: Record<ProjectContextGroupKey, ProjectContextItem[]> = {
    work: uniqueItems(work),
    attention: uniqueItems(attention),
    decisions: uniqueItems(decisions),
    history: uniqueItems(history),
    evidence: uniqueItems(evidence),
  };
  const groups = GROUP_DEFINITIONS.map((definition) => ({
    ...definition,
    items: itemsByGroup[definition.key],
  }));

  return {
    projectId: project.id,
    sourcePath,
    groups,
    totalItems: groups.reduce((total, group) => total + group.items.length, 0),
  };
}

function createEmptyGroups(): ProjectContextGroup[] {
  return GROUP_DEFINITIONS.map((definition) => ({ ...definition, items: [] }));
}

function uniqueItems(items: ProjectContextItem[]): ProjectContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${normalize(item.label)}:${item.path || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function taskStatusLabel(status: string): string {
  if (status === "inProgress") return "In progress";
  if (status === "gated") return "Gated / waiting";
  return "Up next";
}

function evidenceMeta(doc): string {
  const type = recordType(doc) || doc.docType || "document";
  return `${type.replaceAll("_", " ")} · explicit project scope`;
}

function reviewLabel(frontmatter): string {
  const reviewAfter = scalar(frontmatter?.review_after);
  return reviewAfter ? `review ${reviewAfter}` : "";
}

function checkpointDate(doc): string {
  return (
    scalar(doc.frontmatter?.created_at) ||
    scalar(doc.frontmatter?.created) ||
    scalar(doc.frontmatter?.updated)
  );
}

function recordType(doc): string {
  return scalar(doc.frontmatter?.record_type || doc.frontmatter?.type).toLowerCase();
}

function sectionSummary(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^##[\\t ]+${escaped}[\\t ]*\\r?\\n([\\s\\S]*?)(?=^##[\\t ]+|(?![\\s\\S]))`, "im"),
  );
  if (!match) return "";
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function meaningful(value): boolean {
  return !EMPTY_VALUES.has(normalize(value));
}

function normalize(value): string {
  return scalar(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function scalar(value): string {
  if (Array.isArray(value)) return scalar(value[0]);
  return `${value ?? ""}`.trim().replace(/^['"]|['"]$/g, "");
}

function slug(value): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
