import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeProjectId,
  parseProjectDocument,
  parseProjectFrontmatter,
} from "./project-manifest.js";
import type {
  ParsedProjectDocument,
  ProjectSummary,
  ProjectValidationIssue,
  ProjectValidationResult,
} from "./types.js";

const DEFAULT_SCAN_ROOTS = ["demo-kb", "kb"];
const REQUIRED_FRONTMATTER = [
  "schema_version",
  "record_type",
  "workspace_id",
  "project_id",
  "title",
  "status",
  "owner",
  "track",
  "started_at",
  "updated",
  "review_after",
] as const;
const REQUIRED_SECTIONS = [
  "outcome",
  "current-focus",
  "last-meaningful-change",
  "active-decisions",
  "blockers",
  "open-questions",
  "next-actions",
  "key-documents",
] as const;
const VALID_LIFECYCLES = new Set(["active", "next", "blocked", "completed"]);
const DATE_FIELDS = ["started_at", "updated", "review_after"] as const;

export interface ProjectServiceOptions {
  repoRoot?: string;
  scanRoots?: string[];
}

export interface CreateProjectOptions extends ProjectServiceOptions {
  projectId: string;
  title?: string;
  workspaceId?: string;
  status?: string;
  lifecycle?: string;
  owner?: string;
  track?: string;
  startedAt?: string;
  updated?: string;
  reviewAfter?: string;
  tags?: string[];
  sourceRoots?: string[];
  createSourceDirectory?: boolean;
  dryRun?: boolean;
}

export interface CreatedProject {
  projectId: string;
  path: string;
  sourceDirectories: string[];
  content: string;
  dryRun: boolean;
}

export interface UpdateProjectOptions extends ProjectServiceOptions {
  projectId: string;
  title?: string;
  status?: string;
  lifecycle?: string;
  owner?: string;
  track?: string;
  updated?: string;
  reviewAfter?: string;
  tags?: string[];
  sourceRoots?: string[];
  sections?: Partial<Record<ProjectSectionKey, string | string[]>>;
  dryRun?: boolean;
}

export interface UpdatedProject {
  projectId: string;
  path: string;
  content: string;
  changed: boolean;
  dryRun: boolean;
}

export interface LinkProjectSourceOptions extends ProjectServiceOptions {
  projectId: string;
  sourcePath: string;
  label?: string;
  dryRun?: boolean;
}

export type ProjectSectionKey =
  | "outcome"
  | "current-focus"
  | "last-meaningful-change"
  | "active-decisions"
  | "blockers"
  | "open-questions"
  | "next-actions"
  | "key-documents";

export interface LoadedProject {
  raw: string;
  parsed: ParsedProjectDocument;
  path: string;
}

export async function createProject(options: CreateProjectOptions): Promise<CreatedProject> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const projectId = requireCanonicalProjectId(options.projectId);
  const title = cleanScalar(options.title) || titleFromProjectId(projectId);
  const today = todayIso();
  const sourceRoots = normalizeSourceRoots(
    options.sourceRoots?.length ? options.sourceRoots : [`kb/sources/${projectId}`],
  );
  const lifecycle = normalizeLifecycle(options.lifecycle || lifecycleFromStatus(options.status));
  const values = {
    workspaceId: cleanScalar(options.workspaceId) || "default",
    status: cleanScalar(options.status) || lifecycle,
    lifecycle,
    owner: cleanScalar(options.owner) || "unassigned",
    track: cleanScalar(options.track) || "general",
    startedAt: validateDateInput(options.startedAt || today, "startedAt"),
    updated: validateDateInput(options.updated || today, "updated"),
    reviewAfter: validateDateInput(options.reviewAfter || addDays(today, 14), "reviewAfter"),
    tags: normalizeCsvValues(options.tags || []),
  };
  const relPath = `kb/projects/${projectId}/project.md`;
  const absPath = await resolveSafeWorkspacePath(repoRoot, relPath);
  if (await exists(absPath)) {
    throw new Error(`Project already exists: ${relPath}`);
  }

  const duplicates = await listProjects({ repoRoot });
  if (duplicates.some((project) => project.projectId === projectId)) {
    throw new Error(`Project ID already exists: ${projectId}`);
  }

  const content = renderProjectTemplate({
    projectId,
    title,
    workspaceId: values.workspaceId,
    status: values.status,
    lifecycle: values.lifecycle,
    owner: values.owner,
    track: values.track,
    startedAt: values.startedAt,
    updated: values.updated,
    reviewAfter: values.reviewAfter,
    tags: values.tags,
    sourceRoots,
  });
  const sourceDirectories = options.createSourceDirectory === false ? [] : sourceRoots;
  const sourceDirectoryPaths = await Promise.all(
    sourceDirectories.map((sourceRoot) => resolveSafeWorkspacePath(repoRoot, sourceRoot)),
  );

  if (!options.dryRun) {
    await atomicWrite(absPath, content);
    for (const sourceAbs of sourceDirectoryPaths) {
      await fs.mkdir(sourceAbs, { recursive: true });
    }
  }

  return { projectId, path: relPath, sourceDirectories, content, dryRun: Boolean(options.dryRun) };
}

export async function listProjects(options: ProjectServiceOptions = {}): Promise<ProjectSummary[]> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const records = await discoverProjectRecords(repoRoot, options.scanRoots || DEFAULT_SCAN_ROOTS);
  const summaries: ProjectSummary[] = [];

  for (const record of records) {
    const raw = await fs.readFile(record.absPath, "utf8");
    const parsed = parseProjectDocument(raw, record.relPath, "");
    summaries.push({
      projectId: parsed.manifest.projectId,
      title: parsed.manifest.title,
      status: parsed.manifest.status,
      owner: parsed.manifest.owner,
      track: parsed.manifest.track,
      updated: parsed.manifest.updated,
      path: record.relPath,
      workspaceId: parsed.manifest.workspaceId,
    });
  }

  return summaries.sort(
    (a, b) => a.projectId.localeCompare(b.projectId) || a.path.localeCompare(b.path),
  );
}

export async function getProject(
  projectIdInput: string,
  options: ProjectServiceOptions = {},
): Promise<LoadedProject> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const projectId = requireCanonicalProjectId(projectIdInput);
  const records = await discoverProjectRecords(repoRoot, options.scanRoots || DEFAULT_SCAN_ROOTS);
  const matches: LoadedProject[] = [];

  for (const record of records) {
    const raw = await fs.readFile(record.absPath, "utf8");
    const parsed = parseProjectDocument(raw, record.relPath, "");
    if (parsed.manifest.projectId === projectId) {
      matches.push({ raw, parsed, path: record.relPath });
    }
  }

  if (!matches.length) throw new Error(`Unknown project ID: ${projectId}`);
  if (matches.length > 1) {
    throw new Error(
      `Duplicate project ID '${projectId}' found in: ${matches.map((item) => item.path).join(", ")}`,
    );
  }
  return matches[0];
}

export async function validateProject(
  projectIdInput: string,
  options: ProjectServiceOptions = {},
): Promise<ProjectValidationResult> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const projectId = requireCanonicalProjectId(projectIdInput);
  const records = await discoverProjectRecords(repoRoot, options.scanRoots || DEFAULT_SCAN_ROOTS);
  const matches: LoadedProject[] = [];

  for (const record of records) {
    const raw = await fs.readFile(record.absPath, "utf8");
    const parsed = parseProjectDocument(raw, record.relPath, "");
    if (parsed.manifest.projectId === projectId) {
      matches.push({ raw, parsed, path: record.relPath });
    }
  }

  if (!matches.length) throw new Error(`Unknown project ID: ${projectId}`);
  const target = matches[0];
  const issues = await validateLoadedProject(repoRoot, target, matches.length);
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    projectId,
    path: target.path,
    issues,
  };
}

export async function validateAllProjects(
  options: ProjectServiceOptions = {},
): Promise<ProjectValidationResult[]> {
  const projects = await listProjects(options);
  const ids = [...new Set(projects.map((project) => project.projectId))];
  return Promise.all(ids.map((projectId) => validateProject(projectId, options)));
}

export async function updateProject(options: UpdateProjectOptions): Promise<UpdatedProject> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const loaded = await getProject(options.projectId, {
    repoRoot,
    scanRoots: options.scanRoots,
  });
  let content = loaded.raw;
  const frontmatterUpdates: Record<string, string> = {};

  if (options.title !== undefined)
    frontmatterUpdates.title = requireNonEmpty(options.title, "title");
  if (options.status !== undefined)
    frontmatterUpdates.status = requireNonEmpty(options.status, "status");
  if (options.lifecycle !== undefined)
    frontmatterUpdates.lifecycle = normalizeLifecycle(options.lifecycle);
  if (options.owner !== undefined)
    frontmatterUpdates.owner = requireNonEmpty(options.owner, "owner");
  if (options.track !== undefined)
    frontmatterUpdates.track = requireNonEmpty(options.track, "track");
  if (options.updated !== undefined)
    frontmatterUpdates.updated = validateDateInput(options.updated, "updated");
  if (options.reviewAfter !== undefined) {
    frontmatterUpdates.review_after = validateDateInput(options.reviewAfter, "reviewAfter");
  }
  if (options.tags !== undefined)
    frontmatterUpdates.tags = normalizeCsvValues(options.tags).join(", ");
  if (options.sourceRoots !== undefined) {
    frontmatterUpdates.source_roots = normalizeSourceRoots(options.sourceRoots).join(", ");
  }
  if (Object.keys(frontmatterUpdates).length) {
    content = updateFrontmatter(content, frontmatterUpdates);
  }

  for (const [key, value] of Object.entries(options.sections || {})) {
    if (value === undefined) continue;
    content = updateMarkdownSection(
      content,
      key as ProjectSectionKey,
      renderSectionValue(key as ProjectSectionKey, value),
    );
  }

  const changed = content !== loaded.raw;
  if (changed && !options.dryRun) {
    const target = await resolveSafeWorkspacePath(repoRoot, loaded.path);
    await atomicWrite(target, content);
  }
  return {
    projectId: loaded.parsed.manifest.projectId,
    path: loaded.path,
    content,
    changed,
    dryRun: Boolean(options.dryRun),
  };
}

export async function linkProjectSource(
  options: LinkProjectSourceOptions,
): Promise<UpdatedProject> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const loaded = await getProject(options.projectId, {
    repoRoot,
    scanRoots: options.scanRoots,
  });
  const sourcePath = normalizeWorkspaceRelativePath(options.sourcePath);
  const sourceAbs = await resolveSafeWorkspacePath(repoRoot, sourcePath);
  if (!(await exists(sourceAbs))) throw new Error(`Source path does not exist: ${sourcePath}`);
  const sourceStat = await fs.stat(sourceAbs);
  if (!sourceStat.isFile()) throw new Error(`Source path is not a file: ${sourcePath}`);

  const projectDirectory = path.posix.dirname(loaded.path);
  let relativeTarget = path.posix.relative(projectDirectory, sourcePath);
  if (!relativeTarget.startsWith(".")) relativeTarget = `./${relativeTarget}`;
  const label =
    cleanScalar(options.label) ||
    titleFromProjectId(path.posix.basename(sourcePath, path.posix.extname(sourcePath)));
  const markdownLink = `[${label}](${relativeTarget})`;
  const existing = loaded.parsed.sections.get("key-documents")?.content || "";
  const items = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:[-*]\s+)?None recorded\.?$/i.test(line));
  if (!items.some((item) => item.includes(`](${relativeTarget})`))) {
    items.push(`- ${markdownLink}`);
  }
  return updateProject({
    repoRoot,
    scanRoots: options.scanRoots,
    projectId: options.projectId,
    sections: { "key-documents": items },
    dryRun: options.dryRun,
  });
}

async function validateLoadedProject(
  repoRoot: string,
  loaded: LoadedProject,
  duplicateCount: number,
): Promise<ProjectValidationIssue[]> {
  const issues: ProjectValidationIssue[] = [];
  const { frontmatter } = parseProjectFrontmatter(loaded.raw);
  const add = (severity: "error" | "warning", code: string, message: string, field?: string) =>
    issues.push({ severity, code, message, path: loaded.path, field });

  for (const field of REQUIRED_FRONTMATTER) {
    if (!cleanScalar(frontmatter[field])) {
      add("error", "missing-frontmatter", `Missing required frontmatter field '${field}'.`, field);
    }
  }
  if (frontmatter.schema_version && frontmatter.schema_version !== "1") {
    add(
      "error",
      "unsupported-schema-version",
      "Only schema_version 1 is supported.",
      "schema_version",
    );
  }
  if (frontmatter.record_type && frontmatter.record_type !== "project") {
    add("error", "invalid-record-type", "record_type must be 'project'.", "record_type");
  }
  if (
    frontmatter.project_id &&
    normalizeProjectId(frontmatter.project_id) !== frontmatter.project_id
  ) {
    add(
      "error",
      "noncanonical-project-id",
      "project_id must be a lowercase canonical slug.",
      "project_id",
    );
  }
  const folderId = canonicalProjectIdFromPath(loaded.path);
  if (folderId && folderId !== loaded.parsed.manifest.projectId) {
    add(
      "error",
      "project-path-mismatch",
      `Folder project ID '${folderId}' does not match frontmatter '${loaded.parsed.manifest.projectId}'.`,
      "project_id",
    );
  }
  if (duplicateCount > 1) {
    add(
      "error",
      "duplicate-project-id",
      `Project ID is declared by ${duplicateCount} project records.`,
      "project_id",
    );
  }
  if (frontmatter.lifecycle && !VALID_LIFECYCLES.has(frontmatter.lifecycle)) {
    add(
      "error",
      "invalid-lifecycle",
      `lifecycle must be one of: ${[...VALID_LIFECYCLES].join(", ")}.`,
      "lifecycle",
    );
  }
  for (const field of DATE_FIELDS) {
    const value = cleanScalar(frontmatter[field]);
    if (value && !isIsoDate(value)) {
      add("error", "invalid-date", `${field} must be a valid YYYY-MM-DD date.`, field);
    }
  }
  for (const key of REQUIRED_SECTIONS) {
    if (!loaded.parsed.sections.has(key)) {
      add("error", "missing-section", `Missing required section '${sectionLabel(key)}'.`);
    }
  }

  for (const sourceRoot of loaded.parsed.manifest.sourceRoots) {
    try {
      const candidates = equivalentWorkspacePaths(sourceRoot);
      const found = await anyWorkspacePathExists(repoRoot, candidates);
      if (!found) {
        add(
          "warning",
          "missing-source-root",
          `Configured source root does not exist: ${sourceRoot}`,
          "source_roots",
        );
      }
    } catch (error) {
      add("error", "unsafe-source-root", errorMessage(error), "source_roots");
    }
  }

  for (const linkedPath of loaded.parsed.explicitPaths) {
    const resolved = resolveProjectLink(loaded.path, linkedPath);
    try {
      const absPath = await resolveSafeWorkspacePath(repoRoot, resolved);
      if (!(await exists(absPath))) {
        add("warning", "broken-project-link", `Linked local path does not exist: ${linkedPath}`);
      }
    } catch (error) {
      add("error", "unsafe-project-link", errorMessage(error));
    }
  }

  return issues;
}

function renderProjectTemplate(values: {
  projectId: string;
  title: string;
  workspaceId: string;
  status: string;
  lifecycle: string;
  owner: string;
  track: string;
  startedAt: string;
  updated: string;
  reviewAfter: string;
  tags: string[];
  sourceRoots: string[];
}): string {
  return `---
schema_version: 1
record_type: project
workspace_id: ${values.workspaceId}
project_id: ${values.projectId}
title: ${values.title}
status: ${values.status}
lifecycle: ${values.lifecycle}
owner: ${values.owner}
track: ${values.track}
started_at: ${values.startedAt}
updated: ${values.updated}
review_after: ${values.reviewAfter}
source_roots: ${values.sourceRoots.join(", ")}
tags: ${values.tags.join(", ")}
---

# ${values.title}

## Outcome

Describe the intended result.

## Current focus

Describe what is being worked on now.

## Last meaningful change

Record the latest significant change.

## Active decisions

- None recorded.

## Blockers

- None recorded.

## Open questions

- None recorded.

## Next actions

1. Define the first concrete action.
2. Define the second concrete action.
3. Define the third concrete action.

## Key documents

- None recorded.
`;
}

function updateFrontmatter(raw: string, updates: Record<string, string>): string {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    throw new Error("Canonical project record is missing frontmatter.");
  }
  const lines = raw.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error("Canonical project frontmatter is not closed.");

  const pending = new Map(Object.entries(updates));
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):/);
    if (!match || !pending.has(match[1])) continue;
    lines[index] = `${match[1]}: ${pending.get(match[1])}`;
    pending.delete(match[1]);
  }
  if (pending.size) {
    lines.splice(end, 0, ...[...pending].map(([key, value]) => `${key}: ${value}`));
  }
  return ensureTrailingNewline(lines.join("\n"));
}

function updateMarkdownSection(raw: string, key: ProjectSectionKey, body: string): string {
  const heading = sectionHeading(key);
  const aliases = sectionAliases(key);
  const lines = raw.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return Boolean(match && aliases.has(match[1].trim().toLowerCase()));
  });
  const replacement = body.trim();

  if (headingIndex < 0) {
    return ensureTrailingNewline(`${raw.trimEnd()}\n\n## ${heading}\n\n${replacement}\n`);
  }
  let end = headingIndex + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1;
  lines.splice(headingIndex, end - headingIndex, `## ${heading}`, "", replacement, "");
  return ensureTrailingNewline(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function renderSectionValue(key: ProjectSectionKey, value: string | string[]): string {
  if (Array.isArray(value)) {
    const items = value.map(cleanScalar).filter(Boolean);
    if (!items.length) return "- None recorded.";
    if (key === "next-actions")
      return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    return items.map((item) => (/^[-*]\s+/.test(item) ? item : `- ${item}`)).join("\n");
  }
  return value.trim() || (isListSection(key) ? "- None recorded." : "None recorded.");
}

function sectionAliases(key: ProjectSectionKey): Set<string> {
  const aliases: Record<ProjectSectionKey, string[]> = {
    outcome: ["outcome", "definition of done"],
    "current-focus": ["current focus"],
    "last-meaningful-change": ["last meaningful change", "recent changes"],
    "active-decisions": ["active decisions"],
    blockers: ["blockers"],
    "open-questions": ["open questions"],
    "next-actions": ["next actions", "next 3 actions"],
    "key-documents": ["key documents"],
  };
  return new Set(aliases[key]);
}

function sectionHeading(key: ProjectSectionKey): string {
  const headings: Record<ProjectSectionKey, string> = {
    outcome: "Outcome",
    "current-focus": "Current focus",
    "last-meaningful-change": "Last meaningful change",
    "active-decisions": "Active decisions",
    blockers: "Blockers",
    "open-questions": "Open questions",
    "next-actions": "Next actions",
    "key-documents": "Key documents",
  };
  return headings[key];
}

function isListSection(key: ProjectSectionKey): boolean {
  return [
    "active-decisions",
    "blockers",
    "open-questions",
    "next-actions",
    "key-documents",
  ].includes(key);
}

async function discoverProjectRecords(
  repoRoot: string,
  scanRoots: string[],
): Promise<Array<{ absPath: string; relPath: string }>> {
  const records: Array<{ absPath: string; relPath: string }> = [];
  for (const scanRoot of scanRoots) {
    const normalizedRoot = normalizeWorkspaceRelativePath(scanRoot);
    const projectsRoot = await resolveSafeWorkspacePath(repoRoot, `${normalizedRoot}/projects`);
    let entries;
    try {
      entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = `${normalizedRoot}/projects/${entry.name}/project.md`;
      const absPath = await resolveSafeWorkspacePath(repoRoot, relPath);
      if (await exists(absPath)) records.push({ absPath, relPath });
    }
  }
  return records.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function resolveSafeWorkspacePath(repoRoot: string, relPath: string): Promise<string> {
  const normalized = normalizeWorkspaceRelativePath(relPath);
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
  return target;
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function normalizeWorkspaceRelativePath(value: string): string {
  const normalized = cleanScalar(value)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) throw new Error("Workspace-relative path is required.");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Unsafe workspace-relative path: ${value}`);
  }
  return normalized;
}

function normalizeSourceRoots(values: string[]): string[] {
  return normalizeCsvValues(values).map(normalizeWorkspaceRelativePath);
}

function normalizeCsvValues(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(","))
        .map(cleanScalar)
        .filter(Boolean),
    ),
  ];
}

function requireCanonicalProjectId(value: string): string {
  const raw = cleanScalar(value);
  const normalized = normalizeProjectId(raw);
  if (!raw || !normalized) throw new Error("Project ID is required.");
  if (raw !== normalized) {
    throw new Error(
      `Project ID must already be a canonical lowercase slug. Suggested: ${normalized}`,
    );
  }
  return normalized;
}

function normalizeLifecycle(value: string): string {
  const lifecycle = cleanScalar(value).toLowerCase();
  if (!VALID_LIFECYCLES.has(lifecycle)) {
    throw new Error(`Lifecycle must be one of: ${[...VALID_LIFECYCLES].join(", ")}`);
  }
  return lifecycle;
}

function lifecycleFromStatus(value: unknown): string {
  const status = cleanScalar(value).toLowerCase();
  if (status === "planned" || status === "next") return "next";
  if (status === "blocked") return "blocked";
  if (["completed", "complete", "done", "shipped", "delivered"].includes(status))
    return "completed";
  return "active";
}

function validateDateInput(value: string, field: string): string {
  if (!isIsoDate(value)) throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function titleFromProjectId(projectId: string): string {
  return projectId
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveProjectLink(projectPath: string, linkedPath: string): string {
  if (linkedPath.startsWith("kb/") || linkedPath.startsWith("demo-kb/")) {
    return normalizeWorkspaceRelativePath(linkedPath);
  }
  const base = path.posix.dirname(projectPath);
  return normalizeWorkspaceRelativePath(path.posix.normalize(path.posix.join(base, linkedPath)));
}

function equivalentWorkspacePaths(value: string): string[] {
  const normalized = normalizeWorkspaceRelativePath(value);
  const paths = new Set([normalized]);
  if (normalized.startsWith("kb/")) paths.add(`demo-kb/${normalized.slice(3)}`);
  if (normalized.startsWith("demo-kb/")) paths.add(`kb/${normalized.slice("demo-kb/".length)}`);
  return [...paths];
}

async function anyWorkspacePathExists(repoRoot: string, relPaths: string[]): Promise<boolean> {
  for (const relPath of relPaths) {
    const absPath = await resolveSafeWorkspacePath(repoRoot, relPath);
    if (await exists(absPath)) return true;
  }
  return false;
}

function canonicalProjectIdFromPath(relPath: string): string {
  const match = relPath.match(/(?:^|\/)(?:demo-kb|kb)\/projects\/([^/]+)\/project\.md$/);
  return normalizeProjectId(match?.[1] || "");
}

function sectionLabel(key: string): string {
  return key
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cleanScalar(value: unknown): string {
  return `${value ?? ""}`.trim().replace(/[\r\n]+/g, " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
