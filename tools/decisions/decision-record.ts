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
import { parseDecision as parseDecisionRecord } from "./decision-parser.js";
import type {
  CreateDecisionOptions,
  CreatedDecision,
  DecisionConfidence,
  DecisionEvidence,
  DecisionEvidenceChangeRecord,
  DecisionEvidenceInput,
  DecisionEvidenceReviewInput,
  DecisionRecord,
  DecisionReviewState,
  DecisionServiceOptions,
  DecisionStatus,
  ListDecisionOptions,
  ReviewDecisionOptions,
  ReviewedDecision,
  SupersedeDecisionOptions,
  SupersededDecision,
} from "./types.js";

const DEFAULT_SCAN_ROOTS = ["demo-kb", "kb"];
const VALID_STATUSES = new Set<DecisionStatus>(["proposed", "active", "superseded", "rejected"]);
const VALID_CONFIDENCE = new Set<DecisionConfidence>(["low", "medium", "high"]);
const VALID_REVIEW_STATES = new Set<DecisionReviewState>(["current", "due", "overdue"]);

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
  const canonicalId =
    cleanIdentifier === normalizeProjectId(cleanIdentifier) ? cleanIdentifier : undefined;
  const direct = decisions.filter(
    (decision) =>
      (canonicalId && decision.decisionId === canonicalId) || decision.path === normalizedPath,
  );
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) throw new Error(`Decision identifier is ambiguous: ${identifier}`);
  const exact = decisions.filter(
    (decision) => decision.title.toLowerCase() === cleanIdentifier.toLowerCase(),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const active = exact.filter((decision) => decision.status === "active");
    if (active.length === 1) return active[0];
    throw new Error(
      `Decision identifier is ambiguous: ${identifier}. Matches: ${exact
        .map((decision) => decision.decisionId)
        .join(", ")}`,
    );
  }
  throw new Error(`Decision not found: ${identifier}`);
}

export async function reviewDecision(options: ReviewDecisionOptions): Promise<ReviewedDecision> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const scanRoots = options.scanRoots || DEFAULT_SCAN_ROOTS;
  const decisionId = requireDecisionId(options.decisionId);
  const reviewedAt = validateDate(options.reviewedAt, "reviewedAt");
  const nextReviewAfter = validateDate(options.reviewAfter, "reviewAfter");
  if (nextReviewAfter < reviewedAt) {
    throw new Error("reviewAfter cannot be earlier than reviewedAt.");
  }
  const reviewer = requireScalar(options.reviewer, "reviewer");
  const recommendationSupported = requireRecommendationSupported(options.recommendationSupported);
  const assumptions = normalizeList(
    options.assumptionsNeedingValidation || [],
    "assumptionsNeedingValidation",
  );
  const notes = options.notes ? requireText(options.notes, "notes") : "";
  const apply = async (): Promise<ReviewedDecision> => {
    const decision = await loadCanonicalDecision(decisionId, {
      repoRoot,
      scanRoots,
      workspace: options.workspace,
    });
    if (decision.record.status === "superseded" || decision.record.status === "rejected") {
      throw new Error(`Only proposed or active decisions can be reviewed: ${decisionId}`);
    }
    if (reviewedAt < decision.record.evidenceCheckedAt) {
      throw new Error("reviewedAt cannot be earlier than the previous evidence check.");
    }
    const project = decision.record.projectId
      ? await loadWritableProject(decision.record.projectId, repoRoot, scanRoots, options.workspace)
      : undefined;
    const currentEvidence = await validateEvidence(
      options.evidence,
      repoRoot,
      scanRoots,
      project,
      options.workspace,
    );
    const changes = compareEvidence(decision.record.evidence, currentEvidence, options.evidence);
    const reviewEntry = renderReviewEntry({
      reviewedAt,
      nextReviewAfter,
      reviewer,
      recommendationSupported,
      assumptions,
      changes,
      notes,
    });
    let content = replaceFrontmatterField(decision.raw, "evidence_checked_at", reviewedAt);
    content = replaceFrontmatterField(content, "review_after", nextReviewAfter);
    content = replaceFrontmatterField(content, "updated", reviewedAt);
    content = appendSectionContent(content, "Review history", reviewEntry);
    if (!options.dryRun) {
      await writeAtomic(decision.absPath, content, options.workspace);
    }
    return {
      decisionId,
      path: decision.record.path,
      reviewedAt,
      reviewAfter: nextReviewAfter,
      recommendationSupported,
      assumptionsNeedingValidation: assumptions,
      changes,
      content,
      dryRun: Boolean(options.dryRun),
    };
  };

  if (options.dryRun) return apply();
  const lockPath = await acquireDecisionLock(repoRoot, decisionId, options.workspace);
  try {
    return await apply();
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

export async function supersedeDecision(
  options: SupersedeDecisionOptions,
): Promise<SupersededDecision> {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const scanRoots = options.scanRoots || DEFAULT_SCAN_ROOTS;
  const decisionId = requireDecisionId(options.decisionId);
  const replacementId = requireDecisionId(options.replacementId);
  if (decisionId === replacementId) throw new Error("A decision cannot supersede itself.");
  const supersededAt = validateDate(options.supersededAt, "supersededAt");
  const reason = requireText(options.reason, "reason");
  const apply = async (): Promise<SupersededDecision> => {
    const original = await loadCanonicalDecision(decisionId, {
      repoRoot,
      scanRoots,
      workspace: options.workspace,
    });
    const replacement = await loadCanonicalDecision(replacementId, {
      repoRoot,
      scanRoots,
      workspace: options.workspace,
    });
    if (original.record.status === "superseded" || original.record.status === "rejected") {
      throw new Error(`Only proposed or active decisions can be superseded: ${decisionId}`);
    }
    if (replacement.record.status === "superseded" || replacement.record.status === "rejected") {
      throw new Error(`Replacement decision must be proposed or active: ${replacementId}`);
    }
    if (original.record.workspaceId !== replacement.record.workspaceId) {
      throw new Error("Superseded decisions must belong to the same workspace.");
    }
    if (original.record.projectId !== replacement.record.projectId) {
      throw new Error("Superseded decisions must belong to the same project scope.");
    }
    if (
      supersededAt < original.record.decidedAt ||
      supersededAt < replacement.record.decidedAt ||
      supersededAt < original.record.updated ||
      supersededAt < replacement.record.updated
    ) {
      throw new Error("supersededAt cannot predate either decision.");
    }
    if (replacement.record.status === "proposed" && replacement.record.evidence.length === 0) {
      throw new Error("Activating a replacement decision requires evidence.");
    }

    let decisionContent = replaceFrontmatterField(original.raw, "status", "superseded");
    decisionContent = replaceFrontmatterField(decisionContent, "updated", supersededAt);
    decisionContent = appendSectionContent(
      decisionContent,
      "Supersession",
      `- Superseded by [${replacementId}](${replacement.record.path}) on ${supersededAt} — ${cleanScalar(reason)}`,
    );
    let replacementContent = replaceFrontmatterField(replacement.raw, "status", "active");
    replacementContent = replaceFrontmatterField(replacementContent, "updated", supersededAt);
    replacementContent = appendSectionContent(
      replacementContent,
      "Supersession",
      `- Supersedes [${decisionId}](${original.record.path}) on ${supersededAt} — ${cleanScalar(reason)}`,
    );
    if (!options.dryRun) {
      await writePairAtomic(
        original.absPath,
        decisionContent,
        original.raw,
        replacement.absPath,
        replacementContent,
        replacement.raw,
        options.workspace,
      );
    }
    return {
      decisionId,
      replacementId,
      decisionPath: original.record.path,
      replacementPath: replacement.record.path,
      decisionContent,
      replacementContent,
      dryRun: Boolean(options.dryRun),
    };
  };

  if (options.dryRun) return apply();
  const lockIds = [decisionId, replacementId].sort();
  const locks: string[] = [];
  try {
    for (const lockId of lockIds) {
      locks.push(await acquireDecisionLock(repoRoot, lockId, options.workspace));
    }
    return await apply();
  } finally {
    await Promise.all(locks.map((lockPath) => fs.rm(lockPath, { force: true })));
  }
}

export function parseDecision(raw: string, relPath: string, asOf = todayIso()): DecisionRecord {
  return parseDecisionRecord(raw, relPath, asOf);
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

function compareEvidence(
  previous: DecisionEvidence[],
  current: DecisionEvidence[],
  inputs: DecisionEvidenceReviewInput[],
): DecisionEvidenceChangeRecord[] {
  const currentByKey = new Map(current.map((item) => [evidenceKey(item), item]));
  const inputByKey = new Map(inputs.map((item) => [evidenceKey(item), item]));
  const changes: DecisionEvidenceChangeRecord[] = [];
  for (const oldEvidence of previous) {
    const key = evidenceKey(oldEvidence);
    const currentEvidence = currentByKey.get(key);
    if (!currentEvidence) {
      changes.push({ classification: "missing", previous: oldEvidence });
      continue;
    }
    const input = inputByKey.get(key);
    changes.push({
      classification: requireEvidenceClassification(input?.classification || "unchanged", false),
      previous: oldEvidence,
      current: currentEvidence,
      ...(input?.note ? { note: requireScalar(input.note, "evidence note") } : {}),
    });
    currentByKey.delete(key);
  }
  for (const currentEvidence of currentByKey.values()) {
    const input = inputByKey.get(evidenceKey(currentEvidence));
    changes.push({
      classification: requireEvidenceClassification(input?.classification || "new", false),
      current: currentEvidence,
      ...(input?.note ? { note: requireScalar(input.note, "evidence note") } : {}),
    });
  }
  return changes;
}

function renderReviewEntry(values: {
  reviewedAt: string;
  nextReviewAfter: string;
  reviewer: string;
  recommendationSupported: boolean | "uncertain";
  assumptions: string[];
  changes: DecisionEvidenceChangeRecord[];
  notes: string;
}): string {
  const support =
    values.recommendationSupported === "uncertain"
      ? "uncertain"
      : values.recommendationSupported
        ? "yes"
        : "no";
  const assumptions = values.assumptions.length
    ? values.assumptions.map((item) => `  - ${item}`).join("\n")
    : "  - None.";
  const changes = values.changes.length
    ? values.changes
        .map((change) => {
          const evidence = change.current || change.previous;
          return `  - ${change.classification}: ${evidence?.path}:${evidence?.line}${change.note ? ` — ${change.note}` : ""}`;
        })
        .join("\n")
    : "  - None.";
  return `### Review ${values.reviewedAt}

- Reviewer: ${values.reviewer}
- Recommendation supported: ${support}
- Next review after: ${values.nextReviewAfter}
- Assumptions needing human validation:
${assumptions}
- Evidence changes:
${changes}${values.notes ? `\n- Notes: ${values.notes}` : ""}`;
}

async function loadCanonicalDecision(
  decisionId: string,
  options: DecisionServiceOptions & { asOf?: string },
): Promise<{ record: DecisionRecord; raw: string; absPath: string }> {
  const record = await getDecision(decisionId, options);
  const canonicalPath = `kb/decisions/${record.decisionId}.md`;
  if (record.path !== canonicalPath) {
    throw new Error(`Decision mutation requires a writable canonical record at ${canonicalPath}.`);
  }
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const absPath = await resolveWritePath(repoRoot, record.path, options.workspace);
  return { record, raw: await fs.readFile(absPath, "utf8"), absPath };
}

function replaceFrontmatterField(raw: string, field: string, value: string): string {
  const pattern = new RegExp(`^${field}:.*$`, "m");
  if (!pattern.test(raw)) throw new Error(`Decision frontmatter is missing ${field}.`);
  return raw.replace(pattern, `${field}: ${cleanScalar(value)}`);
}

function appendSectionContent(raw: string, heading: string, addition: string): string {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`Decision is missing ${heading}.`);
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  const existing = lines
    .slice(start + 1, end)
    .join("\n")
    .trim()
    .replace(/^-\s+None recorded\.?$/i, "")
    .trim();
  const section = [`## ${heading}`, "", existing, addition].filter(Boolean).join("\n\n");
  return [...lines.slice(0, start), section, ...lines.slice(end)].join("\n");
}

function evidenceKey(value: DecisionEvidenceInput): string {
  return `${normalizeWorkspacePath(value.path)}:${value.line}`;
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

function renderEvidence(value: DecisionEvidence): string {
  return `- ${value.path}:${value.line} — ${value.section}`;
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

function requireRecommendationSupported(value: unknown): boolean | "uncertain" {
  if (value === true || value === false || value === "uncertain") return value;
  throw new Error("recommendationSupported must be true, false, or uncertain.");
}

function requireEvidenceClassification(
  value: unknown,
  allowMissing: boolean,
): DecisionEvidenceChangeRecord["classification"] {
  const classification = cleanScalar(value) as DecisionEvidenceChangeRecord["classification"];
  const allowed = new Set([
    "unchanged",
    "strengthened",
    "weakened",
    "contradicted",
    "new",
    ...(allowMissing ? ["missing"] : []),
  ]);
  if (!allowed.has(classification)) {
    throw new Error(
      "Evidence classification must be unchanged, strengthened, weakened, contradicted, or new.",
    );
  }
  return classification;
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

async function writeAtomic(
  target: string,
  content: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  if (workspace) await authorizeWorkspaceWrite(workspace, target);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  if (workspace) await authorizeWorkspaceWrite(workspace, temp);
  await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function writePairAtomic(
  firstPath: string,
  firstContent: string,
  firstOriginal: string,
  secondPath: string,
  secondContent: string,
  secondOriginal: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  await writeAtomic(firstPath, firstContent, workspace);
  try {
    await writeAtomic(secondPath, secondContent, workspace);
  } catch (error) {
    await writeAtomic(firstPath, firstOriginal, workspace);
    await writeAtomic(secondPath, secondOriginal, workspace).catch((): undefined => undefined);
    throw error;
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
