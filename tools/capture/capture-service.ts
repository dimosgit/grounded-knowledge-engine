import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import { DEFAULT_DOMAIN_PROFILE } from "../workspaces/domain-profile.js";
import type { DomainProfile } from "../workspaces/types.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  assertCandidateProposalReady,
  resolveCandidateProposal,
} from "../ingest/candidate-state.js";
import { resolveCaptureRoute } from "./capture-routing.js";
import {
  CAPTURE_PROPOSAL_SCHEMA_VERSION,
  type ApplyCaptureProposalOptions,
  type ApplyCaptureProposalResult,
  type CaptureAction,
  type CaptureDuplicateCandidate,
  type CapturePlanResult,
  type CaptureProposal,
  type CaptureProposalPreview,
  type CaptureProposalSummary,
  type PlanCaptureInput,
  type ProposedCaptureNote,
} from "./types.js";

const PROPOSAL_DIRECTORY = ".gke/capture-proposals";
const PROPOSAL_ID_PATTERN = /^capture-[a-z0-9-]{12,100}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIMILARITY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "into",
  "when",
  "what",
  "where",
  "which",
  "how",
  "why",
  "are",
  "was",
  "were",
  "can",
  "use",
  "using",
  "local",
  "domain",
  "note",
  "topic",
  "term",
]);

export class CaptureConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureConflictError";
  }
}

export async function planCapture(input: PlanCaptureInput): Promise<CapturePlanResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const workspace = input.workspace;
  const domainProfile = workspace?.domain ?? DEFAULT_DOMAIN_PROFILE;
  const deterministicPath = resolveCapturePath(input.kind, input.title);
  const routing = await resolveCaptureRoute({
    repoRoot,
    kind: input.kind,
    requestedPath: input.requestedPath,
    track: input.track,
    module: input.module,
    projectId: input.projectId,
    evidence: input.evidenceRoutes,
    defaults: {
      path: deterministicPath,
      ...(input.kind === "topic"
        ? {
            track: domainProfile.captureDefaults.track,
            module: domainProfile.captureDefaults.module,
          }
        : {}),
      ...input.routingDefaults,
    },
    evidenceConsensus: input.evidenceConsensus,
  });
  const proposedPath = resolveCapturePath(
    input.kind,
    input.title,
    routing.fields.path.value || deterministicPath,
  );
  const absTarget = await resolveSafeWorkspacePath(repoRoot, proposedPath, true, workspace);
  const targetExists = await exists(absTarget);
  const baseContentHash = targetExists ? await sha256File(absTarget) : null;
  const duplicateCandidates = input.requestedPath
    ? []
    : await findDuplicateCandidates(
        repoRoot,
        input.kind,
        input.title,
        input.body,
        proposedPath,
        workspace,
      );
  const proposedAction = normalizeProposedAction(input.proposedAction, targetExists);
  if (proposedAction === "delete" && !input.ingestionCandidate) {
    throw new Error("Delete proposals are reserved for source-ingestion candidates.");
  }
  const reviewReasons = buildReviewReasons({
    targetExists,
    proposedAction,
    duplicateCandidates,
    routingReasons: routing.reviewReasons,
  });
  const createdAt = new Date().toISOString();
  const proposalId = buildProposalId(createdAt, proposedPath, input.title);
  const proposal: CaptureProposal = {
    schemaVersion: CAPTURE_PROPOSAL_SCHEMA_VERSION,
    proposalId,
    createdAt,
    sourceOperation: input.sourceOperation,
    proposedAction,
    proposedNote: normalizeProposedNote(input, proposedPath, routing),
    duplicateCandidates,
    baseContentHash,
    evidenceCitations: normalizeCitations(input.evidenceCitations || []),
    groundedConfidence: input.groundedConfidence || null,
    routing,
    ...(input.ingestionCandidate ? { ingestionCandidate: input.ingestionCandidate } : {}),
    requiresReview: reviewReasons.length > 0,
    reviewReasons,
  };

  let proposalPath: string | null = null;
  if (input.persist !== false && proposal.requiresReview) {
    proposalPath = await persistCaptureProposal(repoRoot, proposal, workspace);
  }
  return { proposal, proposalPath, targetExists };
}

export async function persistCaptureProposal(
  repoRootInput: string,
  proposal: CaptureProposal,
  workspace?: WorkspaceContext,
): Promise<string> {
  const repoRoot = path.resolve(repoRootInput);
  validateCaptureProposal(proposal);
  const relPath = `${PROPOSAL_DIRECTORY}/${proposal.proposalId}.json`;
  const absPath = await resolveSafeWorkspacePath(repoRoot, relPath, true, workspace);
  await ensureSafeDirectory(repoRoot, path.dirname(absPath), workspace);
  const handle = await fs.open(absPath, "wx", 0o600);
  try {
    await handle.writeFile(serializeCaptureProposal(proposal), "utf8");
  } finally {
    await handle.close();
  }
  return relPath;
}

export async function listCaptureProposals(
  repoRootInput: string,
  workspace?: WorkspaceContext,
): Promise<CaptureProposal[]> {
  const repoRoot = path.resolve(repoRootInput);
  const directory = await resolveSafeWorkspacePath(repoRoot, PROPOSAL_DIRECTORY, false, workspace);
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const proposals: CaptureProposal[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const proposalId = entry.name.slice(0, -5);
    proposals.push(await getCaptureProposal(repoRoot, proposalId, workspace));
  }
  return proposals.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.proposalId.localeCompare(b.proposalId),
  );
}

export async function listCaptureProposalSummaries(
  repoRootInput: string,
  workspace?: WorkspaceContext,
): Promise<CaptureProposalSummary[]> {
  return (await listCaptureProposals(repoRootInput, workspace)).map((proposal) => ({
    proposalId: proposal.proposalId,
    createdAt: proposal.createdAt,
    sourceOperation: proposal.sourceOperation,
    proposedAction: proposal.proposedAction,
    title: proposal.proposedNote.title,
    path: proposal.proposedNote.path,
    track: proposal.proposedNote.track,
    module: proposal.proposedNote.module,
    projectId: proposal.proposedNote.projectId,
    requiresReview: proposal.requiresReview,
    reviewReasons: proposal.reviewReasons,
    duplicateCandidateCount: proposal.duplicateCandidates.length,
    evidenceCitationCount: proposal.evidenceCitations.length,
    routingStatus: proposal.routing?.status || null,
  }));
}

export async function getCaptureProposal(
  repoRootInput: string,
  proposalIdInput: string,
  workspace?: WorkspaceContext,
): Promise<CaptureProposal> {
  const repoRoot = path.resolve(repoRootInput);
  const proposalId = normalizeProposalId(proposalIdInput);
  const relPath = `${PROPOSAL_DIRECTORY}/${proposalId}.json`;
  const absPath = await resolveSafeWorkspacePath(repoRoot, relPath, false, workspace);
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Capture proposal not found: ${proposalId}`);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Capture proposal is malformed JSON: ${proposalId}`);
  }
  validateCaptureProposal(parsed);
  if (parsed.proposalId !== proposalId) {
    throw new Error(`Capture proposal ID does not match its filename: ${proposalId}`);
  }
  return parsed;
}

export async function previewCaptureProposal(
  repoRootInput: string,
  proposalIdInput: string,
  workspace?: WorkspaceContext,
): Promise<CaptureProposalPreview> {
  const repoRoot = path.resolve(repoRootInput);
  const proposal = await getCaptureProposal(repoRoot, proposalIdInput, workspace);
  const absTarget = await resolveSafeWorkspacePath(
    repoRoot,
    proposal.proposedNote.path,
    false,
    workspace,
  );
  const targetExists = await exists(absTarget);
  const currentBytes = targetExists ? await fs.readFile(absTarget) : Buffer.alloc(0);
  const currentContentHash = targetExists ? sha256(currentBytes) : null;
  return {
    proposal,
    targetExists,
    currentContent: currentBytes.toString("utf8"),
    proposedContent: renderCaptureNote(proposal.proposedNote, workspace?.domain),
    currentContentHash,
    stale: Boolean(proposal.baseContentHash && currentContentHash !== proposal.baseContentHash),
  };
}

export async function applyCaptureProposal(
  options: ApplyCaptureProposalOptions,
): Promise<ApplyCaptureProposalResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const proposal = await getCaptureProposal(repoRoot, options.proposalId, options.workspace);
  const lockPath = await acquireProposalLock(repoRoot, proposal.proposalId, options.workspace);
  try {
    return await applyCaptureProposalValue(options, repoRoot, proposal);
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

async function applyCaptureProposalValue(
  options: ApplyCaptureProposalOptions,
  repoRoot: string,
  proposal: CaptureProposal,
): Promise<ApplyCaptureProposalResult> {
  const action = options.action || proposal.proposedAction;
  assertActionAllowed(action);
  if (proposal.ingestionCandidate && options.action && options.action !== proposal.proposedAction) {
    throw new Error("Ingestion candidate proposals must use their planned action.");
  }
  if (action === "delete" && proposal.proposedAction !== "delete") {
    throw new Error("Delete may only apply an explicit deletion proposal.");
  }
  if (proposal.ingestionCandidate) {
    if (!options.workspace) {
      throw new Error("Ingestion candidate resolution requires a workspace context.");
    }
    await assertCandidateProposalReady(
      repoRoot,
      proposal.ingestionCandidate.candidateId,
      proposal.proposalId,
      options.workspace,
    );
  }
  const targetPath = proposal.proposedNote.path;
  const absTarget = await resolveSafeWorkspacePath(repoRoot, targetPath, true, options.workspace);
  const targetExists = await exists(absTarget);
  const currentBytes = targetExists ? await fs.readFile(absTarget) : Buffer.alloc(0);
  const currentContent = currentBytes.toString("utf8");
  const currentHash = targetExists ? sha256(currentBytes) : null;
  const rendered = renderCaptureNote(proposal.proposedNote, options?.workspace?.domain);
  const renderedHash = sha256(rendered);

  if (action === "delete" && !targetExists && proposal.baseContentHash) {
    const recovered: ApplyCaptureProposalResult = {
      proposalId: proposal.proposalId,
      action: "deleted",
      path: targetPath,
      dryRun: Boolean(options.dryRun),
      contentHash: proposal.baseContentHash,
    };
    if (!options.dryRun) {
      if (options.refresh) await options.refresh();
      await resolveIngestionCandidate(repoRoot, proposal, "applied", options.workspace);
      await removeProposalFile(repoRoot, proposal.proposalId, options.workspace);
    }
    return recovered;
  }

  if (
    targetExists &&
    currentHash === renderedHash &&
    (action === "create" || action === "replace")
  ) {
    const recovered: ApplyCaptureProposalResult = {
      proposalId: proposal.proposalId,
      action: action === "create" ? "created" : "replaced",
      path: targetPath,
      dryRun: Boolean(options.dryRun),
      contentHash: renderedHash,
    };
    if (!options.dryRun) {
      if (options.refresh) await options.refresh();
      await resolveIngestionCandidate(repoRoot, proposal, "applied", options.workspace);
      await removeProposalFile(repoRoot, proposal.proposalId, options.workspace);
    }
    return recovered;
  }

  let nextContent: string;
  let resultAction: ApplyCaptureProposalResult["action"];
  if (action === "create") {
    if (targetExists) {
      throw new CaptureConflictError(`Capture target already exists: ${targetPath}`);
    }
    nextContent = rendered;
    resultAction = "created";
  } else if (action === "append") {
    assertMatchingBaseHash(proposal, currentHash, targetExists);
    nextContent = `${currentContent.trimEnd()}\n\n---\n\n${rendered.trim()}\n`;
    resultAction = "appended";
  } else if (action === "replace") {
    assertMatchingBaseHash(proposal, currentHash, targetExists);
    nextContent = rendered;
    resultAction = "replaced";
  } else if (action === "delete") {
    assertMatchingBaseHash(proposal, currentHash, targetExists);
    const result: ApplyCaptureProposalResult = {
      proposalId: proposal.proposalId,
      action: "deleted",
      path: targetPath,
      dryRun: Boolean(options.dryRun),
      contentHash: currentHash as string,
    };
    if (options.dryRun) return result;
    if (options.workspace) await authorizeWorkspaceWrite(options.workspace, absTarget);
    await fs.rm(absTarget);
    if (options.refresh) await options.refresh();
    await resolveIngestionCandidate(repoRoot, proposal, "applied", options.workspace);
    await removeProposalFile(repoRoot, proposal.proposalId, options.workspace);
    return result;
  } else {
    if (targetPath !== "kb/open_questions.md") {
      throw new Error("Open-question proposals must target kb/open_questions.md.");
    }
    if (targetExists && proposal.baseContentHash) {
      assertMatchingBaseHash(proposal, currentHash, targetExists);
    }
    nextContent = targetExists
      ? `${currentContent.trimEnd()}\n\n${proposal.proposedNote.body.trim()}\n`
      : `# Open Questions\n\n${proposal.proposedNote.body.trim()}\n`;
    resultAction = "opened_question";
  }

  const normalizedContent = ensureTrailingNewline(nextContent);
  const result: ApplyCaptureProposalResult = {
    proposalId: proposal.proposalId,
    action: resultAction,
    path: targetPath,
    dryRun: Boolean(options.dryRun),
    contentHash: sha256(normalizedContent),
  };
  if (options.dryRun) return result;

  await atomicWrite(repoRoot, absTarget, normalizedContent, action === "create", options.workspace);
  if (options.refresh) await options.refresh();
  await resolveIngestionCandidate(repoRoot, proposal, "applied", options.workspace);
  await removeProposalFile(repoRoot, proposal.proposalId, options.workspace);
  return result;
}

export async function rejectCaptureProposal(
  repoRootInput: string,
  proposalIdInput: string,
  dryRun = false,
  workspace?: WorkspaceContext,
): Promise<{ proposalId: string; rejected: boolean; dryRun: boolean }> {
  const repoRoot = path.resolve(repoRootInput);
  const proposal = await getCaptureProposal(repoRoot, proposalIdInput, workspace);
  if (!dryRun) {
    const lockPath = await acquireProposalLock(repoRoot, proposal.proposalId, workspace);
    try {
      await resolveIngestionCandidate(repoRoot, proposal, "rejected", workspace);
      await removeProposalFile(repoRoot, proposal.proposalId, workspace);
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }
  return { proposalId: proposal.proposalId, rejected: true, dryRun };
}

export async function applyUnreviewedCapture(
  repoRootInput: string,
  proposal: CaptureProposal,
  options: { dryRun?: boolean; refresh?: () => Promise<void>; workspace?: WorkspaceContext } = {},
): Promise<ApplyCaptureProposalResult> {
  validateCaptureProposal(proposal);
  if (proposal.requiresReview || proposal.proposedAction !== "create") {
    throw new Error("Only an unreviewed create plan can be applied immediately.");
  }
  const repoRoot = path.resolve(repoRootInput);
  const absTarget = await resolveSafeWorkspacePath(
    repoRoot,
    proposal.proposedNote.path,
    true,
    options.workspace,
  );
  if (await exists(absTarget)) {
    throw new CaptureConflictError(`Capture target already exists: ${proposal.proposedNote.path}`);
  }
  const content = renderCaptureNote(proposal.proposedNote, options?.workspace?.domain);
  const result: ApplyCaptureProposalResult = {
    proposalId: proposal.proposalId,
    action: "created",
    path: proposal.proposedNote.path,
    dryRun: Boolean(options.dryRun),
    contentHash: sha256(content),
  };
  if (!options.dryRun) {
    await atomicWrite(repoRoot, absTarget, content, true, options.workspace);
    if (options.refresh) await options.refresh();
  }
  return result;
}

export async function isCaptureProposalUnchanged(
  repoRootInput: string,
  proposal: CaptureProposal,
  workspace?: WorkspaceContext,
): Promise<boolean> {
  validateCaptureProposal(proposal);
  const repoRoot = path.resolve(repoRootInput);
  const absTarget = await resolveSafeWorkspacePath(
    repoRoot,
    proposal.proposedNote.path,
    true,
    workspace,
  );
  if (!(await exists(absTarget))) return false;
  return (
    (await sha256File(absTarget)) ===
    sha256(renderCaptureNote(proposal.proposedNote, workspace?.domain))
  );
}

export async function hashCaptureTarget(
  repoRootInput: string,
  relPath: string,
  workspace?: WorkspaceContext,
): Promise<string | null> {
  const repoRoot = path.resolve(repoRootInput);
  const absPath = await resolveSafeWorkspacePath(repoRoot, relPath, false, workspace);
  return (await exists(absPath)) ? sha256File(absPath) : null;
}

export function renderCaptureNote(
  note: ProposedCaptureNote,
  domain: DomainProfile = DEFAULT_DOMAIN_PROFILE,
): string {
  const body = note.body.trim();
  if (note.kind === "term") {
    return ensureTrailingNewline(body.startsWith("# ") ? body : `# ${note.title}\n\n${body}`);
  }
  if (body.startsWith("---\n")) return ensureTrailingNewline(body);
  const frontmatter = [
    "---",
    `module: ${note.module || domain.captureDefaults.module}`,
    `track: ${note.track || "domain"}`,
    ...(note.projectId ? [`project_id: ${note.projectId}`] : []),
    `status: ${note.status || "draft"}`,
    `type: ${note.type || "concept"}`,
    `owner: ${note.owner || "kb-mcp-server"}`,
    `updated: ${note.updated}`,
    `tags: ${note.tags.join(", ") || domain.captureDefaults.tags.join(", ")}`,
    "---",
    "",
  ].join("\n");
  const heading = body.startsWith("# ") ? "" : `# ${note.title}\n\n`;
  return ensureTrailingNewline(`${frontmatter}${heading}${body}`);
}

export function validateCaptureProposal(value: unknown): asserts value is CaptureProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture proposal must be a JSON object.");
  }
  const proposal = value as Partial<CaptureProposal>;
  if (proposal.schemaVersion !== CAPTURE_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported capture proposal schema version: ${String(proposal.schemaVersion)}`,
    );
  }
  normalizeProposalId(proposal.proposalId || "");
  if (!proposal.createdAt || Number.isNaN(Date.parse(proposal.createdAt))) {
    throw new Error("Capture proposal has an invalid createdAt value.");
  }
  if (
    !proposal.sourceOperation ||
    !["answer", "ingest", "upsert"].includes(proposal.sourceOperation)
  ) {
    throw new Error("Capture proposal has an invalid sourceOperation.");
  }
  assertActionAllowed(proposal.proposedAction || "");
  if (!proposal.proposedNote || typeof proposal.proposedNote !== "object") {
    throw new Error("Capture proposal is missing proposedNote.");
  }
  const note = proposal.proposedNote as Partial<ProposedCaptureNote>;
  if (note.kind !== "topic" && note.kind !== "term") {
    throw new Error("Capture proposal note kind must be topic or term.");
  }
  if (!note.title || !note.body || !note.updated) {
    throw new Error("Capture proposal note requires title, body, and updated.");
  }
  const normalizedPath = resolveCapturePath(note.kind, note.title, note.path);
  if (normalizedPath !== note.path)
    throw new Error("Capture proposal target path is not normalized.");
  if (proposal.baseContentHash !== null && !SHA256_PATTERN.test(proposal.baseContentHash || "")) {
    throw new Error("Capture proposal baseContentHash must be a SHA-256 digest or null.");
  }
  if (!Array.isArray(proposal.duplicateCandidates) || !Array.isArray(proposal.evidenceCitations)) {
    throw new Error("Capture proposal candidates and citations must be arrays.");
  }
  if (!Array.isArray(proposal.reviewReasons) || typeof proposal.requiresReview !== "boolean") {
    throw new Error("Capture proposal review metadata is invalid.");
  }
  if (proposal.ingestionCandidate) {
    const candidate = proposal.ingestionCandidate;
    if (
      !/^ingest-[a-z0-9-]{12,120}$/.test(candidate.candidateId || "") ||
      !/^[a-z0-9][a-z0-9-]{1,110}$/.test(candidate.sourceId || "") ||
      !["changed", "removed", "conflicting-create"].includes(candidate.changeKind)
    ) {
      throw new Error("Capture proposal ingestion candidate metadata is invalid.");
    }
  }
}

function normalizeProposedNote(
  input: PlanCaptureInput,
  proposedPath: string,
  routing: NonNullable<CaptureProposal["routing"]>,
): ProposedCaptureNote {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.updated || "")
    ? (input.updated as string)
    : new Date().toISOString().slice(0, 10);
  return {
    kind: input.kind,
    title: input.title.trim(),
    path: proposedPath,
    track: routing.fields.track.value,
    module: routing.fields.module.value,
    projectId: routing.fields.projectId.value,
    type: input.type?.trim() || (input.kind === "topic" ? "concept" : null),
    status: input.status?.trim() || (input.kind === "topic" ? "draft" : null),
    tags: [...new Set((input.tags || []).map((tag) => tag.trim()).filter(Boolean))],
    owner: input.owner?.trim() || null,
    updated: today,
    body: input.body.trim(),
  };
}

function buildReviewReasons(options: {
  targetExists: boolean;
  proposedAction: CaptureAction;
  duplicateCandidates: CaptureDuplicateCandidate[];
  routingReasons: string[];
}): string[] {
  const reasons: string[] = [...options.routingReasons];
  if (options.duplicateCandidates.length) reasons.push("fuzzy-duplicate-candidate");
  if (options.targetExists) reasons.push("existing-target");
  if (
    options.proposedAction === "append" ||
    options.proposedAction === "replace" ||
    options.proposedAction === "delete"
  ) {
    reasons.push(`consequential-${options.proposedAction}`);
  }
  return [...new Set(reasons)];
}

function normalizeProposedAction(
  action: CaptureAction | undefined,
  targetExists: boolean,
): CaptureAction {
  if (!targetExists && action === "delete") {
    throw new CaptureConflictError("Cannot propose deletion for a missing capture target.");
  }
  if (!targetExists && action && action !== "open_question") return "create";
  if (action) {
    assertActionAllowed(action);
    return action;
  }
  return targetExists ? "replace" : "create";
}

function assertActionAllowed(action: string): asserts action is CaptureAction {
  if (!["create", "append", "replace", "delete", "open_question"].includes(action)) {
    throw new Error(`Unsupported capture action: ${action}`);
  }
}

function assertMatchingBaseHash(
  proposal: CaptureProposal,
  currentHash: string | null,
  targetExists: boolean,
): void {
  if (!targetExists || !currentHash) {
    throw new CaptureConflictError(
      `Capture target no longer exists: ${proposal.proposedNote.path}`,
    );
  }
  if (!proposal.baseContentHash) {
    throw new CaptureConflictError("Existing-target capture requires a base-content hash.");
  }
  if (proposal.baseContentHash !== currentHash) {
    throw new CaptureConflictError(
      `Capture target changed after proposal creation: ${proposal.proposedNote.path}`,
    );
  }
}

async function findDuplicateCandidates(
  repoRoot: string,
  kind: "topic" | "term",
  title: string,
  body: string,
  plannedPath: string,
  workspace?: WorkspaceContext,
): Promise<CaptureDuplicateCandidate[]> {
  const relDirectory = kind === "term" ? "kb/terms" : "kb/topics";
  const directory = await resolveSafeWorkspacePath(repoRoot, relDirectory, true, workspace);
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const titleTokens = tokenize(title);
  const bodyTokens = tokenize(body).slice(0, 140);
  const normalizedTitle = normalizeForSimilarity(title);
  const candidates: CaptureDuplicateCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const relPath = `${relDirectory}/${entry.name}`;
    if (normalizeForSimilarity(relPath) === normalizeForSimilarity(plannedPath)) continue;
    const absPath = await resolveSafeWorkspacePath(repoRoot, relPath, false, workspace);
    const raw = await fs.readFile(absPath, "utf8");
    const docTitle = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(entry.name, ".md");
    const docBase = path.basename(entry.name, ".md");
    const titleScore = tokenOverlapScore(titleTokens, tokenize(docTitle));
    const bodyScore = tokenOverlapScore(bodyTokens, tokenize(raw).slice(0, 140));
    const sameSlug =
      slugify(docBase) === slugify(title) || normalizeForSimilarity(docBase) === normalizedTitle;
    const score = sameSlug ? 1 : Number((0.72 * titleScore + 0.28 * bodyScore).toFixed(3));
    const threshold = kind === "term" ? 0.74 : 0.7;
    if (!sameSlug && score < threshold) continue;
    candidates.push({
      path: relPath,
      title: docTitle,
      matchReason: sameSlug ? "slug-or-title-match" : "title-body-overlap",
      score,
      titleScore: Number(titleScore.toFixed(3)),
      bodyScore: Number(bodyScore.toFixed(3)),
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 5);
}

function resolveCapturePath(kind: "topic" | "term", title: string, requestedPath?: string): string {
  const requested = sanitizeRelativePath(requestedPath || "");
  const relPath =
    requested ||
    (kind === "topic" ? `kb/topics/${slugify(title)}.md` : `kb/terms/${termFileName(title)}`);
  if (!relPath.endsWith(".md")) throw new Error("Capture target path must end with .md.");
  const expectedPrefix = kind === "topic" ? "kb/topics/" : "kb/terms/";
  if (!relPath.startsWith(expectedPrefix)) {
    throw new Error(
      `${kind === "topic" ? "Topic" : "Term"} notes must be written under ${expectedPrefix}`,
    );
  }
  return relPath;
}

function sanitizeRelativePath(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new Error("Capture paths must be workspace-relative.");
  }
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Capture path traversal is not allowed.");
  }
  return normalized;
}

async function resolveSafeWorkspacePath(
  repoRoot: string,
  relPath: string,
  allowMissing: boolean,
  workspace?: WorkspaceContext,
): Promise<string> {
  const normalized = sanitizeRelativePath(relPath);
  const rootReal = await fs.realpath(repoRoot);
  const absPath = path.resolve(rootReal, normalized);
  assertContained(rootReal, absPath);
  if (await exists(absPath)) {
    if (workspace) await authorizeWorkspaceOperationalRead(workspace, absPath);
    const targetReal = await fs.realpath(absPath);
    assertContained(rootReal, targetReal);
    return absPath;
  }
  if (!allowMissing) return absPath;
  if (workspace) await authorizeWorkspaceWrite(workspace, absPath);
  let ancestor = path.dirname(absPath);
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const ancestorReal = await fs.realpath(ancestor);
  assertContained(rootReal, ancestorReal);
  return absPath;
}

function assertContained(rootReal: string, candidate: string): void {
  const relative = path.relative(rootReal, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error("Resolved capture path is outside the workspace root.");
}

async function ensureSafeDirectory(
  repoRoot: string,
  directory: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  if (workspace) await authorizeWorkspaceWrite(workspace, directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const rootReal = await fs.realpath(repoRoot);
  const directoryReal = await fs.realpath(directory);
  assertContained(rootReal, directoryReal);
}

async function atomicWrite(
  repoRoot: string,
  target: string,
  content: string,
  mustNotExist = false,
  workspace?: WorkspaceContext,
): Promise<void> {
  if (workspace) await authorizeWorkspaceWrite(workspace, target);
  await ensureSafeDirectory(repoRoot, path.dirname(target), workspace);
  const rootReal = await fs.realpath(repoRoot);
  if (await exists(target)) assertContained(rootReal, await fs.realpath(target));
  const tempPath = `${target}.gke-tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const handle = await fs.open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (mustNotExist) {
      await fs.link(tempPath, target);
      await fs.rm(tempPath);
    } else {
      await fs.rename(tempPath, target);
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CaptureConflictError(
        `Capture target was created concurrently: ${path.relative(repoRoot, target)}`,
      );
    }
    throw error;
  }
}

async function acquireProposalLock(
  repoRoot: string,
  proposalId: string,
  workspace?: WorkspaceContext,
): Promise<string> {
  const normalized = normalizeProposalId(proposalId);
  const relPath = `${PROPOSAL_DIRECTORY}/${normalized}.lock`;
  const lockPath = await resolveSafeWorkspacePath(repoRoot, relPath, true, workspace);
  await ensureSafeDirectory(repoRoot, path.dirname(lockPath), workspace);
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CaptureConflictError(`Capture proposal is already being applied: ${normalized}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return lockPath;
}

async function removeProposalFile(
  repoRoot: string,
  proposalId: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  const normalized = normalizeProposalId(proposalId);
  const relPath = `${PROPOSAL_DIRECTORY}/${normalized}.json`;
  const absPath = await resolveSafeWorkspacePath(repoRoot, relPath, false, workspace);
  if (workspace) await authorizeWorkspaceWrite(workspace, absPath);
  await fs.rm(absPath);
}

function serializeCaptureProposal(proposal: CaptureProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}

function normalizeProposalId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PROPOSAL_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid capture proposal ID.");
  }
  return normalized;
}

function buildProposalId(createdAt: string, relPath: string, title: string): string {
  const timestamp = createdAt.replace(/[-:.TZ]/g, "").toLowerCase();
  const digest = sha256(
    `${createdAt}\n${relPath}\n${title}\n${crypto.randomBytes(8).toString("hex")}`,
  ).slice(0, 12);
  return `capture-${timestamp}-${digest}`;
}

function normalizeCitations(
  citations: PlanCaptureInput["evidenceCitations"],
): NonNullable<PlanCaptureInput["evidenceCitations"]> {
  return (citations || [])
    .filter((citation) => citation && typeof citation.path === "string")
    .map((citation) => ({
      path: sanitizeRelativePath(citation.path),
      ...(Number.isFinite(citation.line) ? { line: citation.line } : {}),
      ...(Number.isFinite(citation.score) ? { score: citation.score } : {}),
    }));
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256(await fs.readFile(filePath));
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function resolveIngestionCandidate(
  repoRoot: string,
  proposal: CaptureProposal,
  resolution: "applied" | "rejected",
  workspace?: WorkspaceContext,
): Promise<void> {
  if (!proposal.ingestionCandidate) return;
  if (!workspace) throw new Error("Ingestion candidate resolution requires a workspace context.");
  await resolveCandidateProposal(
    repoRoot,
    proposal.ingestionCandidate.candidateId,
    proposal.proposalId,
    resolution,
    workspace,
  );
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "note"
  );
}

function termFileName(title: string): string {
  const cleaned = title.trim();
  if (/^[A-Z0-9/_-]{2,24}$/.test(cleaned)) {
    return `${cleaned.replace(/[^A-Z0-9-]+/g, "-")}.md`;
  }
  const base = cleaned
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("-");
  return `${base || "Term"}.md`;
}

function normalizeForSimilarity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeForSimilarity(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SIMILARITY_STOPWORDS.has(token));
}

function tokenOverlapScore(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  return intersection / Math.max(leftSet.size, rightSet.size);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
