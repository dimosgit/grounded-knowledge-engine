import { promises as fs } from "node:fs";
import path from "node:path";
import { getKbRetriever } from "../grounding/retriever.js";
import { authorizeWorkspaceRead } from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  meaningfulSectionItems,
  parseProjectDocument,
  sectionItems,
  sectionSummary,
} from "./project-manifest.js";
import { isDocumentInProject, resolveProjectDocument } from "./project-scope.js";
import type { ProjectCapsule, ProjectCitation, ProjectSection } from "./types.js";

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
    sectionSummary(parsed.sections.get("last-meaningful-change")) ||
    currentStatus ||
    "No recent change recorded.";
  const activeDecisions = meaningfulSectionItems(parsed.sections.get("active-decisions"));
  const blockersAndQuestions = [
    ...meaningfulSectionItems(parsed.sections.get("blockers")),
    ...meaningfulSectionItems(parsed.sections.get("open-questions")),
  ];
  const completed = ["completed", "complete", "done", "shipped", "delivered"].includes(
    parsed.manifest.status.toLowerCase(),
  );
  const nextThreeActions = completed
    ? []
    : meaningfulSectionItems(parsed.sections.get("next-actions")).slice(0, 3);
  const keyDocuments = unique([
    ...sectionItems(parsed.sections.get("key-documents")),
    ...projectDocs.filter((doc) => doc.relPath !== manifestDoc.relPath).map((doc) => doc.relPath),
  ]);
  const startHereBrief = outcome || currentStatus || currentFocus;
  const citations = buildCitations(manifestDoc.relPath, parsed.sections, [
    "outcome",
    "current-status",
    "current-focus",
    "last-meaningful-change",
    "active-decisions",
    "blockers",
    "open-questions",
    "next-actions",
    "key-documents",
  ]);

  const structured: ProjectCapsule = {
    projectId: parsed.manifest.projectId,
    title: parsed.manifest.title,
    startHereBrief,
    currentFocus,
    recentChanges,
    activeDecisions,
    blockersAndQuestions,
    nextThreeActions,
    keyDocuments,
    citations,
  };

  return {
    contentText: renderProjectCapsule(structured),
    structured,
  };
}

export function renderProjectCapsule(capsule: ProjectCapsule): string {
  return [
    `# Resume: ${capsule.title}`,
    "",
    "## Start here",
    capsule.startHereBrief,
    "",
    "## Current focus",
    capsule.currentFocus,
    "",
    "## Recent changes",
    capsule.recentChanges,
    "",
    "## Active decisions",
    ...asMarkdownList(capsule.activeDecisions),
    "",
    "## Blockers and open questions",
    ...asMarkdownList(capsule.blockersAndQuestions),
    "",
    "## Next actions",
    ...asMarkdownList(capsule.nextThreeActions),
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
    "## Facts",
    `- Current focus: ${capsule.currentFocus}`,
    `- Recent change: ${capsule.recentChanges}`,
    ...capsule.activeDecisions.map((item) => `- Decision: ${item}`),
    "",
    "## Risks and unresolved questions",
    ...asMarkdownList(capsule.blockersAndQuestions),
    "",
    "## Recommended next actions",
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
