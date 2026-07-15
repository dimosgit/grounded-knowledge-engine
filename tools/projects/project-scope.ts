import type { IndexedDocument } from "../grounding/types.js";
import { normalizeProjectId } from "./project-manifest.js";

export interface ProjectRecordSummary {
  projectId: string;
  title: string;
  relPath: string;
  canonical: boolean;
}

/**
 * Enumerate the distinct projects in the index (canonical `kb/projects/<id>/project.md`
 * records plus any remaining legacy `type: project` notes), deduped by project id with
 * the highest-scoring record per id (canonical preferred). Used to make projects
 * discoverable via `resources/list` without the caller knowing ids in advance.
 */
export function listProjectRecords(docs: IndexedDocument[]): ProjectRecordSummary[] {
  const byId = new Map<string, { score: number; summary: ProjectRecordSummary }>();
  for (const doc of docs) {
    if (!isProjectRecord(doc)) continue;
    const projectId = getDocumentProjectId(doc);
    if (!projectId) continue;
    const summary: ProjectRecordSummary = {
      projectId,
      title: `${doc.title || projectId}`.trim(),
      relPath: doc.relPath,
      canonical:
        doc.frontmatter?.record_type === "project" ||
        /(?:^|\/)(?:demo-kb|kb)\/projects\/[^/]+\/project\.md$/.test(doc.relPath),
    };
    const score = projectRecordScore(doc);
    const existing = byId.get(projectId);
    if (!existing || score > existing.score) byId.set(projectId, { score, summary });
  }
  return [...byId.values()]
    .map((entry) => entry.summary)
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export function resolveProjectDocument(
  docs: IndexedDocument[],
  requestedProjectId: string,
): IndexedDocument | null {
  const projectId = normalizeProjectId(requestedProjectId);
  const candidates = docs
    .filter((doc) => isProjectRecord(doc))
    .map((doc) => ({ doc, identity: getDocumentProjectId(doc), score: projectRecordScore(doc) }))
    .filter((candidate) => candidate.identity === projectId)
    .sort((a, b) => b.score - a.score || a.doc.relPath.localeCompare(b.doc.relPath));
  return candidates[0]?.doc || null;
}

export function isDocumentInProject(
  doc: IndexedDocument,
  projectId: string,
  manifestPath: string,
  sourceRoots: string[],
  explicitPaths: string[],
): boolean {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (doc.relPath === manifestPath) return true;
  if (normalizeProjectId(doc.frontmatter?.project_id) === normalizedProjectId) return true;
  if (doc.relPath.startsWith(`kb/projects/${normalizedProjectId}/`)) return true;
  if (
    sourceRoots.some((root) =>
      equivalentRoots(root).some(
        (candidateRoot) =>
          doc.relPath === candidateRoot ||
          doc.relPath.startsWith(`${candidateRoot.replace(/\/+$/, "")}/`),
      ),
    )
  )
    return true;
  return explicitPaths.some((linkedPath) =>
    pathsReferToSameDocument(manifestPath, linkedPath, doc.relPath),
  );
}

function isProjectRecord(doc: IndexedDocument): boolean {
  if (doc.frontmatter?.record_type === "project") return true;
  if (doc.frontmatter?.type === "project") return true;
  return /(?:^|\/)kb\/projects\/[^/]+\/project\.md$/.test(doc.relPath);
}

function getDocumentProjectId(doc: IndexedDocument): string {
  const canonicalPathMatch = doc.relPath.match(
    /(?:^|\/)(?:demo-kb|kb)\/projects\/([^/]+)\/project\.md$/,
  );
  return normalizeProjectId(
    doc.frontmatter?.project_id ||
      canonicalPathMatch?.[1] ||
      (doc.frontmatter?.type === "project" ? doc.frontmatter?.module : "") ||
      doc.title ||
      fileStem(doc.relPath),
  );
}

function projectRecordScore(doc: IndexedDocument): number {
  let score = 0;
  if (doc.frontmatter?.record_type === "project") score += 20;
  if (/(?:^|\/)(?:demo-kb|kb)\/projects\/[^/]+\/project\.md$/.test(doc.relPath)) score += 10;
  if (doc.frontmatter?.project_id) score += 5;
  if (doc.frontmatter?.type === "project") score += 2;
  return score;
}

function pathsReferToSameDocument(
  manifestPath: string,
  linkedPath: string,
  candidatePath: string,
): boolean {
  const fromManifest = manifestPath.split("/").slice(0, -1);
  const resolved = normalizePosixPath([...fromManifest, ...linkedPath.split("/")]);
  return (
    equivalentPaths(linkedPath).includes(candidatePath) ||
    equivalentPaths(resolved).includes(candidatePath)
  );
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

function fileStem(relPath: string): string {
  const base = relPath.split("/").pop() || relPath;
  return base.replace(/\.[^.]+$/, "");
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
