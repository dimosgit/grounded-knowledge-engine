import fs from "node:fs/promises";
import path from "node:path";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
  isContained,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { normalizeProjectId, parseProjectFrontmatter } from "../projects/project-manifest.js";
import { getProject, type LoadedProject } from "../projects/project-service.js";
import type {
  CreateDecisionOptions,
  CreatedDecision,
  DecisionConfidence,
  DecisionEvidence,
  DecisionEvidenceInput,
  DecisionRecord,
  DecisionReviewState,
  DecisionServiceOptions,
  DecisionStatus,
  ListDecisionOptions,
} from "./types.js";

const DEFAULT_SCAN_ROOTS = ["demo-kb", "kb"];
const VALID_STATUSES = new Set<DecisionStatus>(["proposed", "active", "superseded", "rejected"]);
const VALID_CONFIDENCE = new Set<DecisionConfidence>(["low", "medium", "high"]);
const VALID_REVIEW_STATES = new Set<DecisionReviewState>(["current", "due", "overdue"]);
const REQUIRED_SECTIONS = [
  "decision-question",
  "recommendation",
  "alternatives-considered",
  "rationale",
  "assumptions",
  "risks-and-caveats",
  "evidence-snapshot",
  "review-history",
  "supersession",
] as const;

export async function createDecision(options: CreateDecisionOptions): Promise<CreatedDecision> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const title = requireScalar(options.title, "title");
  const decisionId = options.decisionId
    ? requireDecisionId(options.decisionId)
    : requireDecisionId(normalizeProjectId(title));
  const project = options.projectId
    ? await loadWritableProject(options.projectId, repoRoot, options.scanRoots, options.workspace)
    : undefined;
  const projectId = project?.parsed.manifest.projectId;
  const workspaceId =
    cleanScalar(options.workspaceId) ||
    cleanScalar(project?.parsed.manifest.workspaceId) ||
    cleanScalar(options.workspace?.id) ||
    "default";
  const status = requireStatus(options.status || "proposed");
  const confidence = requireConfidence(options.confidence);
  const decidedAt = validateDate(options.decidedAt, "decidedAt");
  const evidenceCheckedAt = validateDate(options.evidenceCheckedAt, "evidenceCheckedAt");
  const reviewAfter = validateDate(options.reviewAfter, "reviewAfter");
  const updated = decidedAt;
  const question = requireText(options.question, "question");
  const recommendation = requireText(options.recommendation, "recommendation");
  const rationale = requireText(options.rationale, "rationale");
  const alternatives = normalizeList(options.alternatives || [], "alternatives");
  const assumptions = normalizeList(options.assumptions || [], "assumptions");
  const risks = normalizeList(options.risks || [], "risks");
  const tags = normalizeCsv(options.tags || []);
  const evidence = await validateEvidence(
    options.evidence || [],
    repoRoot,
    options.scanRoots || DEFAULT_SCAN_ROOTS,
    project,
    options.workspace,
  );
  if (status === "active" && evidence.length === 0) {
    throw new Error("An active decision requires at least one evidence citation.");
  }
  const relPath = `kb/decisions/${decisionId}.md`;
  const target = await resolveWritePath(repoRoot, relPath, options.workspace);
  const content = renderDecision({
    decisionId,
    workspaceId,
    projectId,
    title,
    status,
    owner: requireScalar(options.owner, "owner"),
    decidedAt,
    evidenceCheckedAt,
    reviewAfter,
    confidence,
    updated,
    tags,
    question,
    recommendation,
    alternatives,
    rationale,
    assumptions,
    risks,
    evidence,
  });

  const scanRoots = options.scanRoots || DEFAULT_SCAN_ROOTS;
  if (options.dryRun) {
    const duplicate = await findDecisionById(repoRoot, decisionId, scanRoots, options.workspace);
    if (duplicate) throw new Error(`Decision ID already exists at ${duplicate}: ${decisionId}`);
  } else {
    const lockPath = await acquireDecisionLock(repoRoot, decisionId, options.workspace);
    try {
      const duplicate = await findDecisionById(repoRoot, decisionId, scanRoots, options.workspace);
      if (duplicate) throw new Error(`Decision ID already exists at ${duplicate}: ${decisionId}`);
      await writeExclusive(target, content, options.workspace, relPath);
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }

  return {
    decisionId,
    workspaceId,
    projectId,
    title,
    status,
    owner: requireScalar(options.owner, "owner"),
    decidedAt,
    evidenceCheckedAt,
    reviewAfter,
    confidence,
    updated,
    tags,
    question,
    recommendation,
    alternatives,
    rationale,
    assumptions,
    risks,
    evidence,
    reviewHistory: [],
    supersession: [],
    reviewState: reviewState(reviewAfter, todayIso()),
    path: relPath,
    content,
    dryRun: Boolean(options.dryRun),
  };
}

export async function listDecisions(options: ListDecisionOptions = {}): Promise<DecisionRecord[]> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const asOf = validateDate(options.asOf || todayIso(), "asOf");
  const projectId = options.projectId
    ? requireCanonicalSlug(options.projectId, "projectId")
    : undefined;
  const status = options.status ? requireStatus(options.status) : undefined;
  const requestedReviewState = options.reviewState
    ? requireReviewState(options.reviewState)
    : undefined;
  const records = await discoverDecisions(
    repoRoot,
    options.scanRoots || DEFAULT_SCAN_ROOTS,
    options.workspace,
  );
  const decisions: DecisionRecord[] = [];
  for (const record of records) {
    const raw = await fs.readFile(record.absPath, "utf8");
    const parsed = parseDecision(raw, record.relPath, asOf);
    if (projectId && parsed.projectId !== projectId) continue;
    if (status && parsed.status !== status) continue;
    if (requestedReviewState && parsed.reviewState !== requestedReviewState) continue;
    if (options.owner && parsed.owner !== options.owner) continue;
    if (options.tag && !parsed.tags.includes(options.tag)) continue;
    decisions.push(parsed);
  }
  return decisions.sort(
    (a, b) =>
      a.reviewAfter.localeCompare(b.reviewAfter) ||
      b.decidedAt.localeCompare(a.decidedAt) ||
      a.decisionId.localeCompare(b.decisionId),
  );
}

export async function getDecision(
  identifier: string,
  options: DecisionServiceOptions & { asOf?: string } = {},
): Promise<DecisionRecord> {
  const cleanIdentifier = cleanScalar(identifier);
  if (!cleanIdentifier) throw new Error("Decision identifier cannot be empty.");
  const decisions = await listDecisions({ ...options, asOf: options.asOf });
  const normalizedPath = normalizeOptionalPath(cleanIdentifier);
  const canonicalId = normalizeProjectId(cleanIdentifier.replace(/\.md$/i, ""));
  const exact = decisions.filter(
    (decision) =>
      decision.decisionId === canonicalId ||
      decision.path === normalizedPath ||
      decision.title.toLowerCase() === cleanIdentifier.toLowerCase(),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Decision identifier is ambiguous: ${identifier}. Matches: ${exact
        .map((decision) => decision.decisionId)
        .join(", ")}`,
    );
  }
  throw new Error(`Decision not found: ${identifier}`);
}

export function parseDecision(raw: string, relPath: string, asOf = todayIso()): DecisionRecord {
  const { frontmatter, bodyStartLine } = parseProjectFrontmatter(raw);
  if (frontmatter.schema_version !== "1") {
    throw new Error(`Decision at ${relPath} must use schema_version 1.`);
  }
  if (frontmatter.record_type !== "decision") {
    throw new Error(`Decision at ${relPath} must use record_type decision.`);
  }
  const sections = parseSections(raw, bodyStartLine);
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) throw new Error(`Decision at ${relPath} is missing ${section}.`);
  }
  const decisionId = requireDecisionId(frontmatter.decision_id);
  const pathId = relPath.match(/(?:^|\/)(?:demo-kb|kb)\/decisions\/([^/]+)\.md$/)?.[1];
  if (pathId && pathId !== decisionId) {
    throw new Error(
      `Decision ID '${decisionId}' does not match the canonical path ID '${pathId}' at ${relPath}.`,
    );
  }
  const title = requireScalar(frontmatter.title, "title");
  const reviewAfter = validateDate(frontmatter.review_after, "review_after");
  return {
    decisionId,
    workspaceId: requireScalar(frontmatter.workspace_id, "workspace_id"),
    projectId: cleanScalar(frontmatter.project_id)
      ? requireCanonicalSlug(frontmatter.project_id, "project_id")
      : undefined,
    title,
    status: requireStatus(frontmatter.status),
    owner: requireScalar(frontmatter.owner, "owner"),
    decidedAt: validateDate(frontmatter.decided_at, "decided_at"),
    evidenceCheckedAt: validateDate(frontmatter.evidence_checked_at, "evidence_checked_at"),
    reviewAfter,
    confidence: requireConfidence(frontmatter.confidence),
    updated: validateDate(frontmatter.updated, "updated"),
    tags: splitCsv(frontmatter.tags),
    question: requireText(sections.get("decision-question"), "Decision question"),
    recommendation: requireText(sections.get("recommendation"), "Recommendation"),
    alternatives: parseList(sections.get("alternatives-considered") || ""),
    rationale: requireText(sections.get("rationale"), "Rationale"),
    assumptions: parseList(sections.get("assumptions") || ""),
    risks: parseList(sections.get("risks-and-caveats") || ""),
    evidence: parseEvidence(sections.get("evidence-snapshot") || ""),
    reviewHistory: parseList(sections.get("review-history") || ""),
    supersession: parseList(sections.get("supersession") || ""),
    reviewState: reviewState(reviewAfter, validateDate(asOf, "asOf")),
    path: relPath,
  };
}

function renderDecision(values: {
  decisionId: string;
  workspaceId: string;
  projectId?: string;
  title: string;
  status: DecisionStatus;
  owner: string;
  decidedAt: string;
  evidenceCheckedAt: string;
  reviewAfter: string;
  confidence: DecisionConfidence;
  updated: string;
  tags: string[];
  question: string;
  recommendation: string;
  alternatives: string[];
  rationale: string;
  assumptions: string[];
  risks: string[];
  evidence: DecisionEvidence[];
}): string {
  return `---
schema_version: 1
record_type: decision
workspace_id: ${values.workspaceId}
decision_id: ${values.decisionId}
${values.projectId ? `project_id: ${values.projectId}\n` : ""}title: ${values.title}
status: ${values.status}
owner: ${values.owner}
decided_at: ${values.decidedAt}
evidence_checked_at: ${values.evidenceCheckedAt}
review_after: ${values.reviewAfter}
confidence: ${values.confidence}
updated: ${values.updated}
tags: ${values.tags.join(", ")}
---

# ${values.title}

## Decision question

${values.question}

## Recommendation

${values.recommendation}

## Alternatives considered

${renderList(values.alternatives)}

## Rationale

${values.rationale}

## Assumptions

${renderList(values.assumptions)}

## Risks and caveats

${renderList(values.risks)}

## Evidence snapshot

${values.evidence.length ? values.evidence.map(renderEvidence).join("\n") : "- None recorded."}

## Review history

- None recorded.

## Supersession

- None recorded.
`;
}

async function validateEvidence(
  inputs: DecisionEvidenceInput[],
  repoRoot: string,
  scanRoots: string[],
  project: LoadedProject | undefined,
  workspace?: WorkspaceContext,
): Promise<DecisionEvidence[]> {
  const results: DecisionEvidence[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!Number.isInteger(input.line) || input.line < 1) {
      throw new Error(`Evidence line must be a positive integer: ${input.path}:${input.line}`);
    }
    const relPath = normalizeWorkspacePath(input.path);
    const target = await resolveReadPath(repoRoot, relPath, scanRoots, workspace);
    const raw = await fs.readFile(target, "utf8");
    const lines = raw.split(/\r?\n/);
    if (input.line > lines.length) {
      throw new Error(`Evidence line ${input.line} is outside ${relPath} (${lines.length} lines).`);
    }
    if (project && !isEvidenceInProject(raw, relPath, project)) {
      throw new Error(`Decision evidence is outside explicit project scope: ${relPath}`);
    }
    const key = `${relPath}:${input.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ path: relPath, line: input.line, section: findSection(lines, input.line) });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function isEvidenceInProject(raw: string, relPath: string, project: LoadedProject): boolean {
  const projectId = project.parsed.manifest.projectId;
  if (relPath === project.path || relPath.startsWith(`kb/projects/${projectId}/`)) return true;
  if (normalizeProjectId(parseProjectFrontmatter(raw).frontmatter.project_id) === projectId) {
    return true;
  }
  if (
    project.parsed.manifest.sourceRoots.some((root) =>
      equivalentPaths(root).some(
        (candidate) => relPath === candidate || relPath.startsWith(`${candidate}/`),
      ),
    )
  ) {
    return true;
  }
  return project.parsed.explicitPaths.some((linkedPath) => {
    const resolved =
      linkedPath.startsWith("kb/") || linkedPath.startsWith("demo-kb/")
        ? normalizeWorkspacePath(linkedPath)
        : normalizeWorkspacePath(
            path.posix.normalize(path.posix.join(path.posix.dirname(project.path), linkedPath)),
          );
    return equivalentPaths(resolved).includes(relPath);
  });
}

async function loadWritableProject(
  projectId: string,
  repoRoot: string,
  scanRoots: string[] | undefined,
  workspace: WorkspaceContext | undefined,
): Promise<LoadedProject> {
  const project = await getProject(projectId, { repoRoot, scanRoots, workspace });
  const canonical = `kb/projects/${project.parsed.manifest.projectId}/project.md`;
  if (project.path !== canonical) {
    throw new Error(`Decision creation requires a writable canonical project at ${canonical}.`);
  }
  return project;
}

async function discoverDecisions(
  repoRoot: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<Array<{ relPath: string; absPath: string }>> {
  const records: Array<{ relPath: string; absPath: string }> = [];
  for (const scanRoot of scanRoots) {
    const normalizedRoot = normalizeWorkspacePath(scanRoot);
    const relDirectory = `${normalizedRoot}/decisions`;
    const directory = await resolveReadDirectory(repoRoot, relDirectory, scanRoots, workspace);
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
      const absPath = await resolveReadPath(repoRoot, relPath, scanRoots, workspace);
      records.push({ relPath, absPath });
    }
  }
  return records.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function findDecisionById(
  repoRoot: string,
  decisionId: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<string | null> {
  for (const record of await discoverDecisions(repoRoot, scanRoots, workspace)) {
    const raw = await fs.readFile(record.absPath, "utf8");
    if (parseProjectFrontmatter(raw).frontmatter.decision_id === decisionId) return record.relPath;
  }
  return null;
}

function parseSections(raw: string, bodyStartLine: number): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = raw.split(/\r?\n/).slice(bodyStartLine - 1);
  let key: string | undefined;
  let content: string[] = [];
  const save = (): void => {
    if (!key) return;
    if (sections.has(key)) throw new Error(`Decision contains duplicate '${key}' sections.`);
    sections.set(key, content.join("\n").trim());
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      save();
      key = normalizeProjectId(heading[1]);
      content = [];
    } else if (key) {
      content.push(line);
    }
  }
  save();
  return sections;
}

function parseEvidence(raw: string): DecisionEvidence[] {
  const results: DecisionEvidence[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned || /^-\s+none recorded\.?$/i.test(cleaned)) continue;
    const match = cleaned.match(/^-\s+(.+):([1-9]\d*)\s+—\s+(.+)$/);
    if (!match) throw new Error(`Invalid decision evidence citation: ${cleaned}`);
    results.push({
      path: normalizeWorkspacePath(match[1]),
      line: Number.parseInt(match[2], 10),
      section: match[3].trim(),
    });
  }
  return results;
}

function renderEvidence(value: DecisionEvidence): string {
  return `- ${value.path}:${value.line} — ${value.section}`;
}

function parseList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line && !/^none recorded\.?$/i.test(line));
}

function renderList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None recorded.";
}

function normalizeList(values: string[], field: string): string[] {
  return [...new Set(values.map((value) => requireScalar(value, field)))];
}

function normalizeCsv(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(","))
        .map(cleanScalar)
        .filter(Boolean),
    ),
  ];
}

function splitCsv(value: unknown): string[] {
  return normalizeCsv([`${value || ""}`]);
}

function requireDecisionId(value: unknown): string {
  return requireCanonicalSlug(value, "decisionId");
}

function requireCanonicalSlug(value: unknown, field: string): string {
  const raw = cleanScalar(value);
  if (!raw || normalizeProjectId(raw) !== raw || raw.length > 128) {
    throw new Error(`${field} must be a canonical lowercase slug.`);
  }
  return raw;
}

function requireStatus(value: unknown): DecisionStatus {
  const status = cleanScalar(value) as DecisionStatus;
  if (!VALID_STATUSES.has(status)) {
    throw new Error("status must be proposed, active, superseded, or rejected.");
  }
  return status;
}

function requireConfidence(value: unknown): DecisionConfidence {
  const confidence = cleanScalar(value) as DecisionConfidence;
  if (!VALID_CONFIDENCE.has(confidence)) {
    throw new Error("confidence must be low, medium, or high.");
  }
  return confidence;
}

function requireReviewState(value: unknown): DecisionReviewState {
  const state = cleanScalar(value) as DecisionReviewState;
  if (!VALID_REVIEW_STATES.has(state)) {
    throw new Error("reviewState must be current, due, or overdue.");
  }
  return state;
}

function requireScalar(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function requireText(value: unknown, field: string): string {
  const cleaned = `${value ?? ""}`.trim();
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  if (/^#{1,2}\s+/m.test(cleaned)) {
    throw new Error(`${field} cannot inject decision section headings.`);
  }
  return cleaned;
}

function cleanScalar(value: unknown): string {
  return `${value ?? ""}`.trim().replace(/[\r\n]+/g, " ");
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

function reviewState(reviewAfter: string, asOf: string): DecisionReviewState {
  if (reviewAfter < asOf) return "overdue";
  if (reviewAfter === asOf) return "due";
  return "current";
}

function findSection(lines: string[], oneBasedLine: number): string {
  for (let index = Math.min(oneBasedLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const heading = lines[index].match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) return heading[1].trim();
  }
  return "Document";
}

function equivalentPaths(value: string): string[] {
  const normalized = normalizeWorkspacePath(value).replace(/\/+$/, "");
  const paths = new Set([normalized]);
  if (normalized.startsWith("kb/")) paths.add(`demo-kb/${normalized.slice(3)}`);
  if (normalized.startsWith("demo-kb/")) paths.add(`kb/${normalized.slice("demo-kb/".length)}`);
  return [...paths];
}

function normalizeOptionalPath(value: string): string {
  if (!value.includes("/") && !value.endsWith(".md")) return value;
  return normalizeWorkspacePath(value);
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

async function resolveReadDirectory(
  repoRoot: string,
  relPath: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<string> {
  const target = path.resolve(repoRoot, normalizeWorkspacePath(relPath));
  const root = path.resolve(repoRoot);
  if (!isContained(root, target)) throw new Error(`Path escapes workspace root: ${relPath}`);
  const scanTargets = scanRoots.map((scanRoot) =>
    path.resolve(root, normalizeWorkspacePath(scanRoot)),
  );
  if (!scanTargets.some((scanRoot) => isContained(scanRoot, target))) {
    throw new Error(`Decision path is outside configured scan roots: ${relPath}`);
  }
  if (workspace && (await exists(target))) {
    await authorizeWorkspaceOperationalRead(workspace, target);
  }
  return target;
}

async function resolveReadPath(
  repoRoot: string,
  relPath: string,
  scanRoots: string[],
  workspace?: WorkspaceContext,
): Promise<string> {
  const target = await resolveReadDirectory(repoRoot, relPath, scanRoots, workspace);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new Error(`Decision evidence does not exist: ${relPath}`);
  }
  if (!stat.isFile()) throw new Error(`Decision evidence is not a file: ${relPath}`);
  const rootReal = await fs.realpath(path.resolve(repoRoot));
  const targetReal = await fs.realpath(target);
  if (!isContained(rootReal, targetReal)) {
    throw new Error(`Path resolves outside the workspace root through a symlink: ${relPath}`);
  }
  return target;
}

async function resolveWritePath(
  repoRoot: string,
  relPath: string,
  workspace?: WorkspaceContext,
): Promise<string> {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, normalizeWorkspacePath(relPath));
  if (!isContained(root, target)) throw new Error(`Path escapes workspace root: ${relPath}`);
  const rootReal = await fs.realpath(root);
  let existing = target;
  while (!(await exists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const existingReal = await fs.realpath(existing);
  if (!isContained(rootReal, existingReal)) {
    throw new Error(`Path resolves outside the workspace root through a symlink: ${relPath}`);
  }
  if (workspace) await authorizeWorkspaceWrite(workspace, target);
  return target;
}

async function writeExclusive(
  target: string,
  content: string,
  workspace: WorkspaceContext | undefined,
  relPath: string,
): Promise<void> {
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
      throw new Error(`Decision already exists: ${relPath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function acquireDecisionLock(
  repoRoot: string,
  decisionId: string,
  workspace?: WorkspaceContext,
): Promise<string> {
  const relPath = `.gke/decision-locks/${decisionId}.lock`;
  const lockPath = await resolveWritePath(repoRoot, relPath, workspace);
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
      if (attempt === 49) throw new Error(`Decision ID is already being created: ${decisionId}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Unable to acquire decision lock: ${decisionId}`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
