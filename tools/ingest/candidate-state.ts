import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { linkProjectSource } from "../projects/project-service.js";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { writeSourceRecord, type SourceRecord } from "./source-record.js";

const CANDIDATE_DIRECTORY = ".gke/ingest-candidates";
const CANDIDATE_ID_PATTERN = /^ingest-[a-z0-9-]{12,120}$/;

export type CandidateResolution = "applied" | "rejected";
export type CandidateStatus = "pending" | "finalized" | "rejected" | "partially_rejected";

export interface IngestionCandidateRun {
  schemaVersion: 1;
  candidateId: string;
  sourceId: string;
  createdAt: string;
  status: CandidateStatus;
  proposalIds: string[];
  resolutions: Record<string, CandidateResolution>;
  immediateCreates: string[];
  removedNotePaths: string[];
  sourceRecord: SourceRecord;
}

export function buildCandidateId(
  sourceId: string,
  sourceHash: string,
  settingsHash: string,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${sourceId}\n${sourceHash}\n${settingsHash}\n${Date.now()}\n${crypto.randomBytes(8)}`)
    .digest("hex")
    .slice(0, 16);
  return `ingest-${sourceId.slice(0, 80)}-${digest}`;
}

export async function persistCandidateRun(
  repoRoot: string,
  candidate: IngestionCandidateRun,
  workspace: WorkspaceContext,
): Promise<string> {
  validateCandidate(candidate);
  const relPath = candidatePath(candidate.candidateId);
  const target = path.join(repoRoot, relPath);
  await authorizeWorkspaceWrite(workspace, target);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await authorizeWorkspaceWrite(workspace, target);
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await handle.writeFile(serialize(candidate), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return relPath;
}

export async function readCandidateRun(
  repoRoot: string,
  candidateId: string,
  workspace: WorkspaceContext,
): Promise<IngestionCandidateRun> {
  const target = path.join(repoRoot, candidatePath(candidateId));
  await authorizeWorkspaceOperationalRead(workspace, target);
  const parsed = JSON.parse(await fs.readFile(target, "utf8")) as unknown;
  validateCandidate(parsed);
  return parsed;
}

export async function discardCandidateRun(
  repoRoot: string,
  candidateId: string,
  workspace: WorkspaceContext,
): Promise<void> {
  const target = path.join(repoRoot, candidatePath(candidateId));
  await authorizeWorkspaceWrite(workspace, target);
  await fs.rm(target, { force: true });
}

export async function assertCandidateProposalReady(
  repoRoot: string,
  candidateId: string,
  proposalId: string,
  workspace: WorkspaceContext,
): Promise<void> {
  const candidate = await readCandidateRun(repoRoot, candidateId, workspace);
  if (!candidate.proposalIds.includes(proposalId)) {
    throw new Error("Capture proposal is not associated with its ingestion candidate.");
  }
  if (candidate.resolutions[proposalId] === "rejected") {
    throw new Error("Ingestion candidate proposal was already rejected.");
  }
}

export async function resolveCandidateProposal(
  repoRoot: string,
  candidateId: string,
  proposalId: string,
  resolution: CandidateResolution,
  workspace: WorkspaceContext,
): Promise<IngestionCandidateRun> {
  const lockPath = await acquireCandidateLock(repoRoot, candidateId, workspace);
  try {
    const candidate = await readCandidateRun(repoRoot, candidateId, workspace);
    if (!candidate.proposalIds.includes(proposalId)) {
      throw new Error("Capture proposal is not associated with its ingestion candidate.");
    }
    const previous = candidate.resolutions[proposalId];
    if (previous && previous !== resolution) {
      throw new Error("Ingestion candidate proposal already has a different resolution.");
    }
    candidate.resolutions[proposalId] = resolution;
    const allResolved = candidate.proposalIds.every((id) => candidate.resolutions[id]);
    if (allResolved) {
      const values = candidate.proposalIds.map((id) => candidate.resolutions[id]);
      if (values.every((value) => value === "applied")) {
        await finalizeCandidate(repoRoot, candidate, workspace);
        candidate.status = "finalized";
      } else {
        candidate.status = values.every((value) => value === "rejected")
          ? "rejected"
          : "partially_rejected";
      }
    }
    await replaceCandidateFile(repoRoot, candidate, workspace);
    return candidate;
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

async function finalizeCandidate(
  repoRoot: string,
  candidate: IngestionCandidateRun,
  workspace: WorkspaceContext,
): Promise<void> {
  for (const note of candidate.sourceRecord.generatedNotes) {
    const target = path.join(repoRoot, note.path);
    await authorizeWorkspaceOperationalRead(workspace, target);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("Accepted source note path is not a file.");
  }
  const projectId = candidate.sourceRecord.projectId;
  if (projectId) {
    for (const note of candidate.sourceRecord.generatedNotes) {
      await linkProjectSource({
        repoRoot,
        projectId,
        sourcePath: note.path,
        label: note.title,
        workspace,
      });
    }
  }
  await writeSourceRecord(repoRoot, candidate.sourceRecord, workspace);
}

async function replaceCandidateFile(
  repoRoot: string,
  candidate: IngestionCandidateRun,
  workspace: WorkspaceContext,
): Promise<void> {
  validateCandidate(candidate);
  const target = path.join(repoRoot, candidatePath(candidate.candidateId));
  await authorizeWorkspaceWrite(workspace, target);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serialize(candidate), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function acquireCandidateLock(
  repoRoot: string,
  candidateId: string,
  workspace: WorkspaceContext,
): Promise<string> {
  const lockPath = path.join(repoRoot, `${candidatePath(candidateId)}.lock`);
  await authorizeWorkspaceWrite(workspace, lockPath);
  try {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.close();
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Ingestion candidate is already being resolved.");
    }
    throw error;
  }
}

function candidatePath(candidateId: string): string {
  const normalized = candidateId.trim().toLowerCase();
  if (!CANDIDATE_ID_PATTERN.test(normalized)) throw new Error("Invalid ingestion candidate ID.");
  return `${CANDIDATE_DIRECTORY}/${normalized}.json`;
}

function validateCandidate(value: unknown): asserts value is IngestionCandidateRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ingestion candidate must be an object.");
  }
  const candidate = value as Partial<IngestionCandidateRun>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported ingestion candidate schema.");
  candidatePath(candidate.candidateId || "");
  if (
    !candidate.sourceId ||
    !candidate.createdAt ||
    Number.isNaN(Date.parse(candidate.createdAt))
  ) {
    throw new Error("Ingestion candidate identity is invalid.");
  }
  if (!Array.isArray(candidate.proposalIds) || !candidate.proposalIds.length) {
    throw new Error("Ingestion candidate requires at least one proposal.");
  }
  if (!candidate.resolutions || typeof candidate.resolutions !== "object") {
    throw new Error("Ingestion candidate resolutions are invalid.");
  }
  if (!candidate.sourceRecord || candidate.sourceRecord.sourceId !== candidate.sourceId) {
    throw new Error("Ingestion candidate source record is invalid.");
  }
  if (!Array.isArray(candidate.immediateCreates) || !Array.isArray(candidate.removedNotePaths)) {
    throw new Error("Ingestion candidate path metadata is invalid.");
  }
  if (
    !candidate.status ||
    !["pending", "finalized", "rejected", "partially_rejected"].includes(candidate.status)
  ) {
    throw new Error("Ingestion candidate status is invalid.");
  }
  if (
    candidate.proposalIds.some((proposalId) => !/^capture-[a-z0-9-]{12,100}$/.test(proposalId)) ||
    new Set(candidate.proposalIds).size !== candidate.proposalIds.length
  ) {
    throw new Error("Ingestion candidate proposal IDs are invalid.");
  }
  for (const [proposalId, resolution] of Object.entries(candidate.resolutions)) {
    if (
      !candidate.proposalIds.includes(proposalId) ||
      (resolution !== "applied" && resolution !== "rejected")
    ) {
      throw new Error("Ingestion candidate resolution is invalid.");
    }
  }
}

function serialize(candidate: IngestionCandidateRun): string {
  return `${JSON.stringify(candidate, null, 2)}\n`;
}
