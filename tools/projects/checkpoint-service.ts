import fs from "node:fs/promises";
import path from "node:path";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  normalizeProjectId,
  parseProjectDocument,
  parseProjectFrontmatter,
} from "./project-manifest.js";
import { getProject, type ProjectServiceOptions } from "./project-service.js";

export interface CheckpointEvidenceInput {
  path: string;
  line: number;
}

export interface CheckpointEvidence extends CheckpointEvidenceInput {
  section: string;
}

export interface CreateProjectCheckpointOptions extends ProjectServiceOptions {
  projectId: string;
  checkpointId?: string;
  title: string;
  createdAt?: string;
  author?: string;
  whatChanged: string;
  completed?: string[];
  currentBlocker?: string;
  nextStartingPoint: string;
  evidence?: CheckpointEvidenceInput[];
  dryRun?: boolean;
}

export interface ProjectCheckpoint {
  checkpointId: string;
  projectId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  author: string;
  whatChanged: string;
  completed: string[];
  currentBlocker: string;
  nextStartingPoint: string;
  evidence: CheckpointEvidence[];
  path: string;
  whatChangedLine: number;
  completedLine: number;
  currentBlockerLine: number;
  nextStartingPointLine: number;
}

export interface CreatedProjectCheckpoint extends ProjectCheckpoint {
  content: string;
  dryRun: boolean;
}

export async function createProjectCheckpoint(
  options: CreateProjectCheckpointOptions,
): Promise<CreatedProjectCheckpoint> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const loaded = await getProject(options.projectId, {
    repoRoot,
    scanRoots: options.scanRoots,
    workspace: options.workspace,
  });
  const projectId = loaded.parsed.manifest.projectId;
  const canonicalProjectPath = `kb/projects/${projectId}/project.md`;
  if (loaded.path !== canonicalProjectPath) {
    throw new Error(
      `Checkpoint creation requires a writable canonical project at ${canonicalProjectPath}.`,
    );
  }

  const title = requireScalar(options.title, "title");
  const createdAt = validateDate(options.createdAt || todayIso(), "createdAt");
  const author =
    cleanScalar(options.author) || cleanScalar(loaded.parsed.manifest.owner) || "unassigned";
  const whatChanged = requireText(options.whatChanged, "whatChanged");
  const nextStartingPoint = requireText(options.nextStartingPoint, "nextStartingPoint");
  const completed = normalizeList(options.completed || []);
  const currentBlocker =
    cleanSectionText(options.currentBlocker, "currentBlocker") || "None recorded.";
  const checkpointId = options.checkpointId
    ? requireCheckpointId(options.checkpointId)
    : deriveCheckpointId(createdAt, projectId, title);
  const relPath = `kb/projects/${projectId}/checkpoints/${createdAt}-${checkpointId}.md`;
  const target = await resolveSafePath(repoRoot, relPath, options.workspace, "write");
  const evidence = await validateEvidence(
    options.evidence || [],
    repoRoot,
    loaded.path,
    loaded.parsed.manifest.projectId,
    loaded.parsed.manifest.sourceRoots,
    loaded.parsed.explicitPaths,
    options.workspace,
  );
  const content = renderCheckpoint({
    checkpointId,
    projectId,
    workspaceId: loaded.parsed.manifest.workspaceId || "default",
    title,
    createdAt,
    author,
    whatChanged,
    completed,
    currentBlocker,
    nextStartingPoint,
    evidence,
  });

  if (!options.dryRun) {
    const lockPath = await acquireCheckpointLock(repoRoot, checkpointId, options.workspace);
    try {
      const duplicate = await findCheckpointById(
        repoRoot,
        checkpointId,
        options.scanRoots,
        options.workspace,
      );
      if (duplicate) {
        throw new Error(`Checkpoint ID already exists at ${duplicate}: ${checkpointId}`);
      }
      await writeExclusive(target, content, options.workspace, relPath);
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  } else {
    const duplicate = await findCheckpointById(
      repoRoot,
      checkpointId,
      options.scanRoots,
      options.workspace,
    );
    if (duplicate) {
      throw new Error(`Checkpoint ID already exists at ${duplicate}: ${checkpointId}`);
    }
  }

  return {
    checkpointId,
    projectId,
    workspaceId: loaded.parsed.manifest.workspaceId || "default",
    title,
    createdAt,
    author,
    whatChanged,
    completed,
    currentBlocker,
    nextStartingPoint,
    evidence,
    path: relPath,
    whatChangedLine: checkpointSectionLine(content, "What changed"),
    completedLine: checkpointSectionLine(content, "Completed"),
    currentBlockerLine: checkpointSectionLine(content, "Current blocker"),
    nextStartingPointLine: checkpointSectionLine(content, "Next starting point"),
    content,
    dryRun: Boolean(options.dryRun),
  };
}

export async function listProjectCheckpoints(
  projectIdInput: string,
  options: ProjectServiceOptions = {},
): Promise<ProjectCheckpoint[]> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const loaded = await getProject(projectIdInput, {
    repoRoot,
    scanRoots: options.scanRoots,
    workspace: options.workspace,
  });
  const projectId = loaded.parsed.manifest.projectId;
  if (loaded.path !== `kb/projects/${projectId}/project.md`) return [];
  const relDirectory = `kb/projects/${projectId}/checkpoints`;
  const directory = await resolveSafePath(repoRoot, relDirectory, options.workspace, "read");
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const checkpoints: ProjectCheckpoint[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relPath = `${relDirectory}/${entry.name}`;
    const target = await resolveSafePath(repoRoot, relPath, options.workspace, "read");
    const raw = await fs.readFile(target, "utf8");
    const checkpoint = parseCheckpoint(raw, relPath);
    if (checkpoint.projectId !== projectId) {
      throw new Error(
        `Checkpoint project ID '${checkpoint.projectId}' does not match '${projectId}' at ${relPath}.`,
      );
    }
    checkpoints.push(checkpoint);
  }

  return checkpoints.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.path.localeCompare(a.path),
  );
}

function parseCheckpoint(raw: string, relPath: string): ProjectCheckpoint {
  const { frontmatter } = parseProjectFrontmatter(raw);
  if (frontmatter.schema_version !== "1") {
    throw new Error(`Checkpoint at ${relPath} must use schema_version 1.`);
  }
  if (frontmatter.record_type !== "checkpoint") {
    throw new Error(`Checkpoint at ${relPath} must use record_type checkpoint.`);
  }
  const checkpointId = requireCheckpointId(frontmatter.checkpoint_id);
  const projectId = requireProjectId(frontmatter.project_id);
  const createdAt = validateDate(frontmatter.created_at, "created_at");
  const author = requireScalar(frontmatter.author, "author");
  const parsed = parseProjectDocument(raw, relPath, "");
  const title = raw.match(/^#\s+Checkpoint\s+[—-]\s+(.+?)\s*$/m)?.[1]?.trim() || checkpointId;
  const whatChangedSection = parsed.sections.get("what-changed");
  if (!whatChangedSection) throw new Error(`Checkpoint at ${relPath} is missing What changed.`);
  const completedSection = parsed.sections.get("completed");
  const currentBlockerSection = parsed.sections.get("current-blocker");
  const nextStartingPointSection = parsed.sections.get("next-starting-point");
  if (!nextStartingPointSection) {
    throw new Error(`Checkpoint at ${relPath} is missing Next starting point.`);
  }

  return {
    checkpointId,
    projectId,
    workspaceId: cleanScalar(frontmatter.workspace_id) || "default",
    title,
    createdAt,
    author,
    whatChanged: requireText(whatChangedSection.content, "What changed"),
    completed: parseList(completedSection?.content || ""),
    currentBlocker: cleanText(currentBlockerSection?.content) || "None recorded.",
    nextStartingPoint: requireText(nextStartingPointSection.content, "Next starting point"),
    evidence: parseEvidence(parsed.sections.get("evidence")?.content || ""),
    path: relPath,
    whatChangedLine: whatChangedSection.line,
    completedLine: completedSection?.line || whatChangedSection.line,
    currentBlockerLine: currentBlockerSection?.line || whatChangedSection.line,
    nextStartingPointLine: nextStartingPointSection.line,
  };
}

async function validateEvidence(
  inputs: CheckpointEvidenceInput[],
  repoRoot: string,
  projectPath: string,
  projectId: string,
  sourceRoots: string[],
  explicitPaths: string[],
  workspace?: WorkspaceContext,
): Promise<CheckpointEvidence[]> {
  const evidence: CheckpointEvidence[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const relPath = normalizeWorkspacePath(input.path);
    if (!Number.isInteger(input.line) || input.line < 1) {
      throw new Error(`Evidence line must be a positive integer: ${input.path}:${input.line}`);
    }
    const target = await resolveSafePath(repoRoot, relPath, workspace, "read");
    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      throw new Error(`Checkpoint evidence does not exist: ${relPath}`);
    }
    if (!stat.isFile()) throw new Error(`Checkpoint evidence is not a file: ${relPath}`);
    const raw = await fs.readFile(target, "utf8");
    const lines = raw.split(/\r?\n/);
    if (input.line > lines.length) {
      throw new Error(`Evidence line ${input.line} is outside ${relPath} (${lines.length} lines).`);
    }
    if (!isEvidenceInProject(raw, relPath, projectPath, projectId, sourceRoots, explicitPaths)) {
      throw new Error(`Checkpoint evidence is outside explicit project scope: ${relPath}`);
    }
    const key = `${relPath}:${input.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      path: relPath,
      line: input.line,
      section: findSection(lines, input.line),
    });
  }
  return evidence.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function isEvidenceInProject(
  raw: string,
  relPath: string,
  projectPath: string,
  projectId: string,
  sourceRoots: string[],
  explicitPaths: string[],
): boolean {
  if (relPath === projectPath || relPath.startsWith(`kb/projects/${projectId}/`)) return true;
  const { frontmatter } = parseProjectFrontmatter(raw);
  if (normalizeProjectId(frontmatter.project_id) === projectId) return true;
  if (
    sourceRoots.some((root) =>
      equivalentPaths(root).some(
        (candidate) => relPath === candidate || relPath.startsWith(`${candidate}/`),
      ),
    )
  ) {
    return true;
  }
  return explicitPaths.some((linkedPath) => {
    const resolved =
      linkedPath.startsWith("kb/") || linkedPath.startsWith("demo-kb/")
        ? normalizeWorkspacePath(linkedPath)
        : normalizeWorkspacePath(
            path.posix.normalize(path.posix.join(path.posix.dirname(projectPath), linkedPath)),
          );
    return equivalentPaths(resolved).includes(relPath);
  });
}

function renderCheckpoint(
  values: Omit<
    ProjectCheckpoint,
    "path" | "whatChangedLine" | "completedLine" | "currentBlockerLine" | "nextStartingPointLine"
  >,
): string {
  return `---
schema_version: 1
record_type: checkpoint
workspace_id: ${values.workspaceId}
project_id: ${values.projectId}
checkpoint_id: ${values.checkpointId}
created_at: ${values.createdAt}
author: ${values.author}
---

# Checkpoint — ${values.title}

## What changed

${values.whatChanged}

## Completed

${renderList(values.completed)}

## Current blocker

${values.currentBlocker}

## Next starting point

${values.nextStartingPoint}

## Evidence

${values.evidence.length ? values.evidence.map(renderEvidence).join("\n") : "- None recorded."}
`;
}

function renderEvidence(item: CheckpointEvidence): string {
  return `- ${item.path}:${item.line} — ${item.section}`;
}

function parseEvidence(raw: string): CheckpointEvidence[] {
  const evidence: CheckpointEvidence[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.trim().match(/^-\s+(.+):(\d+)\s+—\s+(.+)$/);
    if (!match || /^none recorded\.?$/i.test(match[1])) continue;
    evidence.push({
      path: match[1],
      line: Number.parseInt(match[2], 10),
      section: match[3].trim(),
    });
  }
  return evidence;
}

function parseList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line && !/^none recorded\.?$/i.test(line));
}

function renderList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded.";
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map(cleanScalar).filter(Boolean))];
}

function deriveCheckpointId(createdAt: string, projectId: string, title: string): string {
  const slug = normalizeProjectId(title);
  if (!slug) throw new Error("title must contain at least one letter or number.");
  return requireCheckpointId(
    `cp-${createdAt.replaceAll("-", "")}-${projectId}-${slug}`.slice(0, 128).replace(/-+$/, ""),
  );
}

function requireCheckpointId(value: unknown): string {
  const raw = cleanScalar(value);
  const normalized = normalizeProjectId(raw);
  if (!raw || raw !== normalized || !raw.startsWith("cp-") || raw.length > 128) {
    throw new Error("checkpointId must be a canonical lowercase slug beginning with 'cp-'.");
  }
  return raw;
}

function requireProjectId(value: unknown): string {
  const raw = cleanScalar(value);
  const normalized = normalizeProjectId(raw);
  if (!raw || raw !== normalized) throw new Error("Checkpoint project_id must be canonical.");
  return raw;
}

function requireScalar(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function requireText(value: unknown, field: string): string {
  const cleaned = cleanSectionText(value, field);
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function cleanScalar(value: unknown): string {
  return `${value ?? ""}`.trim().replace(/[\r\n]+/g, " ");
}

function cleanText(value: unknown): string {
  return `${value ?? ""}`.trim();
}

function cleanSectionText(value: unknown, field: string): string {
  const cleaned = cleanText(value);
  if (/^#{1,2}\s+/m.test(cleaned)) {
    throw new Error(`${field} cannot inject checkpoint section headings.`);
  }
  return cleaned;
}

function validateDate(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  const parsed = new Date(`${cleaned}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== cleaned) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return cleaned;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function findSection(lines: string[], oneBasedLine: number): string {
  for (let index = Math.min(oneBasedLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const heading = lines[index].match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) return heading[1].trim();
  }
  return "Document";
}

function checkpointSectionLine(content: string, heading: string): number {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `## ${heading}`);
  return index + 1;
}

function equivalentPaths(value: string): string[] {
  const normalized = normalizeWorkspacePath(value).replace(/\/+$/, "");
  const paths = new Set([normalized]);
  if (normalized.startsWith("kb/")) paths.add(`demo-kb/${normalized.slice(3)}`);
  if (normalized.startsWith("demo-kb/")) {
    paths.add(`kb/${normalized.slice("demo-kb/".length)}`);
  }
  return [...paths];
}

function normalizeWorkspacePath(value: string): string {
  const normalized = cleanScalar(value)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "..")) {
    throw new Error(`Unsafe workspace-relative path: ${value}`);
  }
  return normalized;
}

async function resolveSafePath(
  repoRoot: string,
  relPath: string,
  workspace: WorkspaceContext | undefined,
  access: "read" | "write",
): Promise<string> {
  const normalized = normalizeWorkspacePath(relPath);
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes the workspace root: ${relPath}`);
  }
  const rootReal = await fs.realpath(root);
  let existing = target;
  while (!(await exists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const existingReal = await fs.realpath(existing);
  if (existingReal !== rootReal && !existingReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`Path resolves outside the workspace root through a symlink: ${relPath}`);
  }
  if (workspace) {
    if (access === "write") await authorizeWorkspaceWrite(workspace, target);
    else if (await exists(target)) await authorizeWorkspaceOperationalRead(workspace, target);
  }
  return target;
}

async function writeExclusive(
  target: string,
  content: string,
  workspace: WorkspaceContext | undefined,
  relPath: string,
): Promise<void> {
  if (workspace) await authorizeWorkspaceWrite(workspace, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (workspace) await authorizeWorkspaceWrite(workspace, target);
  let handle;
  try {
    handle = await fs.open(target, "wx", 0o600);
    await handle.writeFile(content, "utf8");
  } catch (error) {
    if (handle) {
      await handle.close();
      handle = undefined;
      await fs.rm(target, { force: true });
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Checkpoint already exists: ${relPath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function findCheckpointById(
  repoRoot: string,
  checkpointId: string,
  scanRoots: string[] | undefined,
  workspace?: WorkspaceContext,
): Promise<string | null> {
  for (const scanRoot of scanRoots?.length ? scanRoots : ["demo-kb", "kb"]) {
    const normalizedRoot = normalizeWorkspacePath(scanRoot);
    const projectsDirectory = await resolveSafePath(
      repoRoot,
      `${normalizedRoot}/projects`,
      workspace,
      "read",
    );
    let projects;
    try {
      projects = await fs.readdir(projectsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const relDirectory = `${normalizedRoot}/projects/${project.name}/checkpoints`;
      const directory = await resolveSafePath(repoRoot, relDirectory, workspace, "read");
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const relPath = `${relDirectory}/${entry.name}`;
        const target = await resolveSafePath(repoRoot, relPath, workspace, "read");
        const raw = await fs.readFile(target, "utf8");
        if (parseProjectFrontmatter(raw).frontmatter.checkpoint_id === checkpointId) return relPath;
      }
    }
  }
  return null;
}

async function acquireCheckpointLock(
  repoRoot: string,
  checkpointId: string,
  workspace?: WorkspaceContext,
): Promise<string> {
  const relPath = `.gke/checkpoint-locks/${checkpointId}.lock`;
  const lockPath = await resolveSafePath(repoRoot, relPath, workspace, "write");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return lockPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch((): null => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (attempt === 49) {
        throw new Error(`Checkpoint ID is already being created: ${checkpointId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Unable to acquire checkpoint lock: ${checkpointId}`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}
