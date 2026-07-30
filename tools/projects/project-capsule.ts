import { promises as fs } from "node:fs";
import path from "node:path";
import { getKbRetriever } from "../grounding/retriever.js";
import { authorizeWorkspaceRead } from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { listProjectCheckpoints } from "./checkpoint-service.js";
import {
  isPlaceholderSectionItem,
  meaningfulSectionItems,
  parseProjectDocument,
  sectionItems,
  sectionSummary,
} from "./project-manifest.js";
import {
  isDocumentInProject,
  listProjectRecords,
  resolveProjectDocument,
  type ProjectRecordSummary,
} from "./project-scope.js";
import type { ProjectCapsule, ProjectCitation, ProjectSection } from "./types.js";

export async function listProjectRecordsForWorkspace(
  repoRoot: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<ProjectRecordSummary[]> {
  const retriever = await getKbRetriever({
    workspace,
    repoRoot,
    scanRoots,
    cacheTtlMs: 15000,
    forceRefresh: false,
  });
  return listProjectRecords(retriever.getDocuments());
}

export async function resumeProject(
  args: { projectId: string },
  repoRoot: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<{ contentText: string; structured: ProjectCapsule }> {
  const requestedProjectId = `${args.projectId || ""}`.trim();
  if (!requestedProjectId) throw new Error("Missing required argument: projectId");

  const retriever = await getKbRetriever({
    workspace,
    repoRoot,
    scanRoots,
    cacheTtlMs: 15000,
    forceRefresh: false,
  });
  const allDocs = retriever.getDocuments();
  const manifestDoc = resolveProjectDocument(allDocs, requestedProjectId);
  if (!manifestDoc) throw new Error(`Unknown project ID: ${requestedProjectId}`);

  const projectPath = path.resolve(repoRoot, manifestDoc.relPath);
  if (workspace) await authorizeWorkspaceRead(workspace, projectPath);
  const rawProject = await fs.readFile(projectPath, "utf8");
  const parsed = parseProjectDocument(rawProject, manifestDoc.relPath, manifestDoc.title);
  const checkpoints = /(?:^|\/)kb\/projects\/[^/]+\/project\.md$/.test(manifestDoc.relPath)
    ? await listProjectCheckpoints(parsed.manifest.projectId, {
        repoRoot,
        scanRoots,
        workspace,
      })
    : [];
  const latestCheckpoint = checkpoints[0];
  const projectDocs = allDocs.filter((doc) =>
    isDocumentInProject(
      doc,
      parsed.manifest.projectId,
      manifestDoc.relPath,
      parsed.manifest.sourceRoots,
      parsed.explicitPaths,
    ),
  );
  if (!projectDocs.length)
    throw new Error(`No project context found for project ID: ${requestedProjectId}`);

  const outcome = sectionSummary(parsed.sections.get("outcome"));
  const currentStatus = sectionSummary(parsed.sections.get("current-status"));
  const currentFocus =
    sectionSummary(parsed.sections.get("current-focus")) ||
    currentStatus ||
    "No current focus recorded.";
  const recentChanges =
    latestCheckpoint?.whatChanged ||
    sectionSummary(parsed.sections.get("last-meaningful-change")) ||
    currentStatus ||
    "No recent change recorded.";
  const activeDecisions = meaningfulSectionItems(parsed.sections.get("active-decisions"));
  const blockers = unique([
    ...(latestCheckpoint && !isPlaceholderSectionItem(latestCheckpoint.currentBlocker)
      ? [latestCheckpoint.currentBlocker]
      : []),
    ...meaningfulSectionItems(parsed.sections.get("blockers")),
  ]);
  const openQuestions = meaningfulSectionItems(parsed.sections.get("open-questions"));
  const blockersAndQuestions = [...blockers, ...openQuestions];
  const completed = ["completed", "complete", "done", "shipped", "delivered"].includes(
    parsed.manifest.status.toLowerCase(),
  );
  const recordedNextActions = meaningfulSectionItems(parsed.sections.get("next-actions"));
  const recommendedNextAction = completed
    ? "Project completed; no next action required."
    : latestCheckpoint?.nextStartingPoint || recordedNextActions[0] || "No next action recorded.";
  const nextThreeActions = completed
    ? []
    : unique([
        ...(recommendedNextAction === "No next action recorded." ? [] : [recommendedNextAction]),
        ...recordedNextActions,
      ]).slice(0, 3);
  const completedSinceCheckpoint = latestCheckpoint?.completed || [];
  const keyDocuments = unique([
    ...sectionItems(parsed.sections.get("key-documents")),
    ...projectDocs.filter((doc) => doc.relPath !== manifestDoc.relPath).map((doc) => doc.relPath),
  ]);
  const startHereBrief = outcome || currentStatus || currentFocus;
  const citations = [
    ...(latestCheckpoint
      ? [
          {
            path: latestCheckpoint.path,
            line: latestCheckpoint.whatChangedLine,
            section: "What changed",
          },
          ...(completedSinceCheckpoint.length
            ? [
                {
                  path: latestCheckpoint.path,
                  line: latestCheckpoint.completedLine,
                  section: "Completed",
                },
              ]
            : []),
          ...(blockers.includes(latestCheckpoint.currentBlocker)
            ? [
                {
                  path: latestCheckpoint.path,
                  line: latestCheckpoint.currentBlockerLine,
                  section: "Current blocker",
                },
              ]
            : []),
          {
            path: latestCheckpoint.path,
            line: latestCheckpoint.nextStartingPointLine,
            section: "Next starting point",
          },
        ]
      : []),
    ...buildCitations(manifestDoc.relPath, parsed.sections, [
      "outcome",
      "current-status",
      "current-focus",
      "last-meaningful-change",
      "active-decisions",
      "blockers",
      "open-questions",
      "next-actions",
      "key-documents",
    ]),
  ];

  const structured: ProjectCapsule = {
    projectId: parsed.manifest.projectId,
    title: parsed.manifest.title,
    status: parsed.manifest.status || "unknown",
    startHereBrief,
    currentFocus,
    recentChanges,
    recommendedNextAction,
    activeDecisions,
    blockers,
    openQuestions,
    blockersAndQuestions,
    completedSinceCheckpoint,
    latestCheckpointAt: latestCheckpoint?.createdAt || "",
    nextThreeActions,
    keyDocuments,
    citations: uniqueCitations(citations),
  };

  return {
    contentText: renderProjectCapsule(structured),
    structured,
  };
}

export function renderProjectCapsule(capsule: ProjectCapsule): string {
  const followingActions = capsule.nextThreeActions.filter(
    (action) => action !== capsule.recommendedNextAction,
  );
  return [
    `# Resume: ${capsule.title}`,
    "",
    `Status: ${capsule.status}`,
    "",
    "## Do next",
    capsule.recommendedNextAction,
    "",
    "## What changed",
    capsule.recentChanges,
    "",
    "## Completed since last checkpoint",
    ...asMarkdownList(capsule.completedSinceCheckpoint),
    "",
    "## What is blocked",
    ...asMarkdownList(capsule.blockers),
    "",
    "## What was decided",
    ...asMarkdownList(capsule.activeDecisions),
    "",
    "## Open questions",
    ...asMarkdownList(capsule.openQuestions),
    "",
    "## Current focus",
    capsule.currentFocus,
    "",
    "## Following actions",
    ...asMarkdownList(followingActions),
    "",
    "## Project outcome",
    capsule.startHereBrief,
    "",
    "## Key documents",
    ...asMarkdownList(capsule.keyDocuments),
    "",
    "## Citations",
    ...capsule.citations.map(
      (citation) => `- ${citation.path}:${citation.line} — ${citation.section}`,
    ),
  ].join("\n");
}

export function formatTechnicalPeerHandoff(capsule: ProjectCapsule): string {
  return [
    `# Technical handoff: ${capsule.title}`,
    "",
    "## Continue from here",
    `- Do next: ${capsule.recommendedNextAction}`,
    `- Current focus: ${capsule.currentFocus}`,
    `- Recent change: ${capsule.recentChanges}`,
    ...capsule.completedSinceCheckpoint.map((item) => `- Completed: ${item}`),
    "",
    "## Decisions",
    ...capsule.activeDecisions.map((item) => `- Decision: ${item}`),
    "",
    "## Blockers",
    ...asMarkdownList(capsule.blockers),
    "",
    "## Open questions",
    ...asMarkdownList(capsule.openQuestions),
    "",
    "## Next actions",
    ...asMarkdownList(capsule.nextThreeActions),
    "",
    "## Evidence",
    ...capsule.citations.map((citation) => `- ${citation.path}:${citation.line}`),
  ].join("\n");
}

function buildCitations(
  projectPath: string,
  sections: Map<string, ProjectSection>,
  sectionKeys: string[],
): ProjectCitation[] {
  return sectionKeys.flatMap((key) => {
    const section = sections.get(key);
    if (!section?.content) return [];
    return [{ path: projectPath, line: section.line, section: section.heading }];
  });
}

function asMarkdownList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- None recorded."];
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function uniqueCitations(citations: ProjectCitation[]): ProjectCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.path}:${citation.line}:${citation.section}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
