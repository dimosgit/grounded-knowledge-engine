#!/usr/bin/env node
/**
 * Document ingestion CLI for the Grounded Knowledge Engine.
 *
 *   npm run ingest -- <folder> [--module <key>] [--project [name]] [--dry-run] [--no-scrub] [--max-chars <n>]
 *
 * Walks a folder, extracts text from PDF/DOCX/XLSX/Markdown/text files,
 * normalizes + scrubs it, and captures each document as a KB topic note via the
 * real kb.upsert_note write path (spawning the MCP server). Once a document is a
 * Markdown note in kb/, grounding and the cockpit graph pick it up unchanged.
 * With --project, the captured notes are also wrapped in a canonical project
 * record (created if missing) and linked as its key documents.
 *
 * No network, no external API — all extraction is local.
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectFormat,
  extractText,
  getCurrentConverterVersion,
  getIngestConverter,
  isSupported,
  type ExtractResult,
} from "./extractors.js";
import { normalizeDocument } from "./normalize.js";
import { normalizeProjectId } from "../projects/project-manifest.js";
import { createProject, getProject, linkProjectSource } from "../projects/project-service.js";
import { loadWorkspaceContext } from "../workspaces/config.js";
import type { DomainProfile } from "../workspaces/types.js";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
  isContained,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  applyUnreviewedCapture,
  persistCaptureProposal,
  planCapture,
  renderCaptureNote,
} from "../capture/capture-service.js";
import { refreshCaptureRetrievalState } from "../capture/capture-application-service.js";
import type { CaptureProposal, ProposedCaptureNote } from "../capture/types.js";
import {
  buildCandidateId,
  discardCandidateRun,
  persistCandidateRun,
  type IngestionCandidateRun,
} from "./candidate-state.js";
import {
  DEFAULT_INGEST_MAX_CHARS,
  INGEST_PIPELINE_VERSION,
  deriveSourceId,
  hashExtractionSettings,
  normalizeIngestRelativePath,
  readSourceRecord,
  writeSourceRecord,
  type ExtractionProvenance,
  type GeneratedSourceNote,
  type SourceRecord,
} from "./source-record.js";

export interface IngestOptions {
  folder: string;
  module: string;
  dryRun: boolean;
  scrub: boolean;
  maxChars?: number;
  /** Project name/ID to create from the ingested notes; "" derives it from the folder name. */
  project?: string;
  logger?: (line: string) => void;
  /** Test seam used to prove unchanged sources skip conversion. */
  extractor?: (filePath: string) => Promise<ExtractResult>;
  workspace?: WorkspaceContext;
  now?: () => Date;
}

export interface IngestSummary {
  filesProcessed: number;
  notesWritten: number;
  unchangedSources: number;
  immediateCreates: number;
  pendingProposals: number;
  removedChunks: number;
  finalizedSourceRecords: number;
  redactions: number;
  warnings: string[];
  skipped: string[];
  failures: string[];
  projectId?: string;
  projectPath?: string;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".cache", "content"]);

/** Slugify a relative source path (extension included) into a unique note basename. */
export function slugifySource(relToRoot: string): string {
  return (
    relToRoot
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "document"
  );
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs);
      } else if (entry.isFile() && isSupported(abs)) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

export async function runIngest(options: IngestOptions): Promise<IngestSummary> {
  const log = options.logger ?? ((line: string) => console.log(line));
  const summary: IngestSummary = {
    filesProcessed: 0,
    notesWritten: 0,
    unchangedSources: 0,
    immediateCreates: 0,
    pendingProposals: 0,
    removedChunks: 0,
    finalizedSourceRecords: 0,
    redactions: 0,
    warnings: [],
    skipped: [],
    failures: [],
  };
  const workspace = options.workspace ?? (await loadWorkspaceContext());
  if (!options.module) options.module = workspace.domain.captureDefaults.module;
  const repoRoot = workspace.repoRoot;
  const now = options.now ?? (() => new Date());
  const extractor = options.extractor ?? extractText;

  const root = path.resolve(options.folder);
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(root);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Ingest folder not found or not a directory: ${root}`);
  }

  const files = await collectFiles(root);
  if (files.length === 0) {
    log(`No supported documents found in ${root} (looked for pdf, docx, xlsx, md, txt).`);
    return summary;
  }

  log(`Found ${files.length} document(s) to ingest${options.dryRun ? " [dry-run]" : ""}.`);

  let projectId: string | null = null;
  if (options.project !== undefined) {
    const name = options.project || path.basename(root);
    const project = await captureProjectRecord(name, root, [], options.dryRun, log, workspace);
    projectId = project.projectId;
    summary.projectId = project.projectId;
    summary.projectPath = project.path;
  }

  for (const file of files) {
    const sourceUri = normalizeIngestRelativePath(path.relative(root, file));
    const sourceId = deriveSourceId(sourceUri);
    const slug = slugifySource(sourceUri);
    const createdPaths: string[] = [];
    try {
      const rawHash = await hashRawSource(file, workspace);
      const accepted = await readSourceRecord(repoRoot, sourceId, workspace);
      const format = detectFormat(file);
      if (!format) throw new Error("Unsupported source format.");
      const maxChars = options.maxChars ?? DEFAULT_INGEST_MAX_CHARS;
      const configuredMode = getIngestConverter();
      if (accepted) {
        const currentVersion = await getCurrentConverterVersion(
          accepted.provenance.converter,
          format,
        );
        const currentSettings: ExtractionProvenance = {
          converter: accepted.provenance.converter,
          converterVersion: currentVersion,
          configuredMode,
          scrub: options.scrub,
          maxChars,
          pipelineVersion: INGEST_PIPELINE_VERSION,
        };
        if (
          accepted.sourceHash === rawHash &&
          accepted.settingsHash === hashExtractionSettings(currentSettings)
        ) {
          summary.unchangedSources += 1;
          summary.filesProcessed += 1;
          summary.skipped.push(`${sourceUri} (unchanged)`);
          log(`  • unchanged: ${sourceUri}`);
          continue;
        }
      }

      const extracted = await extractor(file);
      const extractionWarnings = extracted.warnings.map((warning) =>
        sanitizeIngestError(warning, file, root),
      );
      for (const warning of extractionWarnings) {
        summary.warnings.push(`${sourceUri}: ${warning}`);
      }
      if (!extracted.text) {
        summary.skipped.push(`${sourceUri} (no extractable text)`);
        continue;
      }
      const acceptedAt = now().toISOString();
      const provenance: ExtractionProvenance = {
        converter: extracted.converter,
        converterVersion: extracted.converterVersion,
        configuredMode,
        scrub: options.scrub,
        maxChars,
        pipelineVersion: INGEST_PIPELINE_VERSION,
      };
      const normalized = normalizeDocument(extracted.text, {
        sourceFile: sourceUri,
        scrub: options.scrub,
        maxChars,
        ingestDate: accepted?.acceptedAt.slice(0, 10) ?? acceptedAt.slice(0, 10),
      });
      summary.redactions += normalized.redactions;
      const desiredNotes: Array<GeneratedSourceNote & { content: string }> = [];
      for (const note of normalized.notes) {
        const suffix = note.chunkIndex > 0 ? `-part-${note.chunkIndex + 1}` : "";
        const notePath = `kb/topics/${slug}${suffix}.md`;
        const existingRaw = await readCanonicalNote(repoRoot, notePath, workspace);
        const proposedNote = buildProposedTopic(workspace.domain, {
          title: note.title,
          body: note.body,
          path: notePath,
          module: options.module,
          projectId: projectId ?? accepted?.projectId ?? null,
          updated: accepted?.acceptedAt.slice(0, 10) ?? acceptedAt.slice(0, 10),
        });
        desiredNotes.push({
          title: note.title,
          path: notePath,
          content: mergeSourceMetadata(
            renderCaptureNote(proposedNote, workspace.domain),
            existingRaw,
            {
              source_id: sourceId,
              source_uri: sourceUri,
              source_chunk: `${note.chunkIndex + 1}`,
            },
          ),
        });
      }

      const record: SourceRecord = {
        sourceId,
        workspaceId: workspace.id,
        title: normalized.notes[0]?.title.replace(/ \(part 1\)$/, "") || sourceId,
        sourceKind: extracted.format,
        sourceUri,
        sourceHash: rawHash,
        acceptedAt,
        projectId: projectId ?? accepted?.projectId ?? null,
        provenance,
        settingsHash: hashExtractionSettings(provenance),
        generatedNotes: desiredNotes.map(({ title, path: notePath }) => ({
          title,
          path: notePath,
        })),
        warnings: extractionWarnings,
      };

      const candidateId = buildCandidateId(sourceId, rawHash, record.settingsHash);
      const immediate: CaptureProposal[] = [];
      const proposals: CaptureProposal[] = [];
      for (const note of desiredNotes) {
        const current = await readCanonicalNote(repoRoot, note.path, workspace);
        if (current === note.content) continue;
        const targetExists = current !== null;
        const plan = await planCapture({
          repoRoot,
          workspace,
          sourceOperation: "ingest",
          kind: "topic",
          title: note.title,
          body: note.content,
          requestedPath: note.path,
          module: options.module,
          projectId: record.projectId ?? undefined,
          proposedAction: targetExists ? "replace" : "create",
          ingestionCandidate: targetExists
            ? {
                candidateId,
                sourceId,
                changeKind: accepted ? "changed" : "conflicting-create",
              }
            : undefined,
          persist: false,
        });
        if (plan.proposal.requiresReview) proposals.push(plan.proposal);
        else immediate.push(plan.proposal);
      }

      const desiredPaths = new Set(desiredNotes.map((note) => note.path));
      for (const removed of accepted?.generatedNotes ?? []) {
        if (desiredPaths.has(removed.path)) continue;
        if ((await readCanonicalNote(repoRoot, removed.path, workspace)) === null) continue;
        const plan = await planCapture({
          repoRoot,
          workspace,
          sourceOperation: "ingest",
          kind: "topic",
          title: removed.title,
          body: `# Removed source chunk\n\nThis source chunk is absent from candidate ${candidateId}.`,
          requestedPath: removed.path,
          proposedAction: "delete",
          ingestionCandidate: { candidateId, sourceId, changeKind: "removed" },
          persist: false,
        });
        proposals.push(plan.proposal);
        summary.removedChunks += 1;
      }

      try {
        for (const proposal of immediate) {
          await applyUnreviewedCapture(repoRoot, proposal, {
            dryRun: options.dryRun,
            workspace,
          });
          createdPaths.push(proposal.proposedNote.path);
        }
      } catch (error) {
        if (!options.dryRun) await rollbackImmediateCreates(repoRoot, createdPaths, workspace);
        throw error;
      }
      summary.immediateCreates += immediate.length;
      summary.notesWritten += immediate.length;

      if (proposals.length) {
        summary.pendingProposals += proposals.length;
        if (!options.dryRun) {
          const candidate: IngestionCandidateRun = {
            schemaVersion: 1,
            candidateId,
            sourceId,
            createdAt: acceptedAt,
            status: "pending",
            proposalIds: proposals.map((proposal) => proposal.proposalId),
            resolutions: {},
            immediateCreates: [...createdPaths],
            removedNotePaths: proposals
              .filter((proposal) => proposal.proposedAction === "delete")
              .map((proposal) => proposal.proposedNote.path),
            sourceRecord: record,
          };
          try {
            await persistCandidateRun(repoRoot, candidate, workspace);
            for (const proposal of proposals) {
              await persistCaptureProposal(repoRoot, proposal, workspace);
            }
          } catch (error) {
            await cleanupCandidateArtifacts(repoRoot, candidate, workspace);
            await rollbackImmediateCreates(repoRoot, createdPaths, workspace);
            summary.immediateCreates -= immediate.length;
            summary.notesWritten -= immediate.length;
            throw error;
          }
        }
      } else if (!options.dryRun) {
        try {
          await finalizeAcceptedSource(repoRoot, record, workspace);
          summary.finalizedSourceRecords += 1;
        } catch (error) {
          await rollbackImmediateCreates(repoRoot, createdPaths, workspace);
          summary.immediateCreates -= immediate.length;
          summary.notesWritten -= immediate.length;
          throw error;
        }
      }

      summary.filesProcessed += 1;
      log(
        `  ✓ ${sourceUri} → ${normalized.notes.length} note(s) [${extracted.format}]${proposals.length ? `, ${proposals.length} pending` : ""}`,
      );
    } catch (error) {
      const message = sanitizeIngestError((error as Error).message, file, root);
      summary.failures.push(`${sourceUri}: ${message}`);
      log(`  ✗ ${sourceUri}: ${message}`);
    }
  }

  if (!options.dryRun && (summary.notesWritten > 0 || summary.finalizedSourceRecords > 0)) {
    await refreshCaptureRetrievalState(repoRoot, workspace);
    log("Refreshed KB index.");
  }

  return summary;
}

function buildProposedTopic(
  domain: DomainProfile,
  options: {
    title: string;
    body: string;
    path: string;
    module: string;
    projectId: string | null;
    updated: string;
  },
): ProposedCaptureNote {
  return {
    kind: "topic",
    title: options.title,
    path: options.path,
    track: domain.captureDefaults.track,
    module: options.module,
    projectId: options.projectId,
    type: "concept",
    status: "draft",
    tags: ["ingested"],
    owner: "kb-ingest",
    updated: options.updated,
    body: options.body,
  };
}

export function mergeSourceMetadata(
  generatedRaw: string,
  existingRaw: string | null,
  sourceMetadata: Record<string, string>,
): string {
  const generated = splitFrontmatter(generatedRaw);
  const existing = existingRaw ? splitFrontmatter(existingRaw) : null;
  const order: string[] = [];
  const values = new Map<string, string>();
  for (const [key, value] of existing?.fields ?? []) {
    order.push(key);
    values.set(key, value);
  }
  for (const [key, value] of [...generated.fields, ...Object.entries(sourceMetadata)]) {
    if (!values.has(key)) order.push(key);
    values.set(key, value);
  }
  const header = order.map((key) => `${key}: ${values.get(key) ?? ""}`).join("\n");
  return `---\n${header}\n---\n${generated.body}`;
}

function splitFrontmatter(raw: string): {
  fields: Array<[string, string]>;
  body: string;
} {
  if (!raw.startsWith("---\n")) return { fields: [], body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { fields: [], body: raw };
  const fields: Array<[string, string]> = [];
  for (const line of raw.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    fields.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return { fields, body: raw.slice(end + 5) };
}

async function hashRawSource(filePath: string, workspace: WorkspaceContext): Promise<string> {
  const logical = path.resolve(filePath);
  const real = await fs.realpath(logical);
  if (isContained(workspace.repoRoot, logical)) {
    if (!isContained(workspace.realRepoRoot, real)) {
      throw new Error("Ingest source resolves outside the active workspace.");
    }
    const isConfiguredRoot =
      workspace.realScanRoots.some((root) => isContained(root, real)) ||
      workspace.realWriteRoots.some((root) => isContained(root, real));
    if (isConfiguredRoot) await authorizeWorkspaceOperationalRead(workspace, logical);
  }
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(real))
    .digest("hex");
}

async function readCanonicalNote(
  repoRoot: string,
  relPath: string,
  workspace: WorkspaceContext,
): Promise<string | null> {
  const target = path.join(repoRoot, relPath);
  try {
    await authorizeWorkspaceOperationalRead(workspace, target);
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function finalizeAcceptedSource(
  repoRoot: string,
  record: SourceRecord,
  workspace: WorkspaceContext,
): Promise<void> {
  if (record.projectId) {
    for (const note of record.generatedNotes) {
      await linkProjectSource({
        repoRoot,
        projectId: record.projectId,
        sourcePath: note.path,
        label: note.title,
        workspace,
      });
    }
  }
  await writeSourceRecord(repoRoot, record, workspace);
}

async function rollbackImmediateCreates(
  repoRoot: string,
  relPaths: string[],
  workspace: WorkspaceContext,
): Promise<void> {
  for (const relPath of [...relPaths].reverse()) {
    const target = path.join(repoRoot, relPath);
    await authorizeWorkspaceWrite(workspace, target);
    await fs.rm(target, { force: true });
  }
}

async function cleanupCandidateArtifacts(
  repoRoot: string,
  candidate: IngestionCandidateRun,
  workspace: WorkspaceContext,
): Promise<void> {
  for (const proposalId of candidate.proposalIds) {
    const target = path.join(repoRoot, ".gke", "capture-proposals", `${proposalId}.json`);
    await authorizeWorkspaceWrite(workspace, target);
    await fs.rm(target, { force: true });
  }
  await discardCandidateRun(repoRoot, candidate.candidateId, workspace);
}

/**
 * Create (or reuse) a canonical project record for an ingest run and link the
 * captured notes as its key documents. Membership stays explicit: the ingest
 * folder becomes a source root when it lives inside the workspace, and every
 * note is linked individually.
 */
async function captureProjectRecord(
  name: string,
  root: string,
  notes: Array<{ title: string; path: string }>,
  dryRun: boolean,
  log: (line: string) => void,
  workspace: WorkspaceContext,
): Promise<{ projectId: string; path: string }> {
  const projectId = normalizeProjectId(name);
  if (!projectId) throw new Error(`Cannot derive a project ID from '${name}'.`);
  const repoRoot = workspace.repoRoot;
  const relRoot = path.relative(repoRoot, root).split(path.sep).join("/");
  const insideWorkspace =
    Boolean(relRoot) && !relRoot.startsWith("..") && !path.isAbsolute(relRoot);

  let projectPath: string;
  try {
    const existing = await getProject(projectId, { repoRoot, workspace });
    projectPath = existing.path;
    log(`  • project exists: ${projectId} (${projectPath})`);
  } catch {
    const created = await createProject({
      repoRoot,
      projectId,
      title: name,
      sourceRoots: insideWorkspace ? [relRoot] : undefined,
      createSourceDirectory: !insideWorkspace,
      dryRun,
      workspace,
    });
    projectPath = created.path;
    log(`  ✓ created${dryRun ? " (dry-run)" : ""} project: ${projectId} (${projectPath})`);
  }

  if (dryRun) {
    log(`  • dry-run: skipped linking ${notes.length} note(s) to ${projectId}`);
  } else {
    for (const note of notes) {
      await linkProjectSource({
        repoRoot,
        projectId,
        sourcePath: note.path,
        label: note.title,
        workspace,
      });
      log(`  ✓ linked to ${projectId}: ${note.path}`);
    }
  }
  return { projectId, path: projectPath };
}

function parseArgs(argv: string[]): IngestOptions {
  const opts: IngestOptions = { folder: "./inbox", module: "", dryRun: false, scrub: true };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-scrub") opts.scrub = false;
    else if (arg === "--module") opts.module = argv[++i];
    else if (arg === "--max-chars") opts.maxChars = Number(argv[++i]);
    else if (arg === "--project") {
      const next = argv[i + 1];
      opts.project = next && !next.startsWith("-") ? argv[++i] : "";
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run ingest -- <folder> [--module <key>] [--project [name]] [--dry-run] [--no-scrub] [--max-chars <n>]",
      );
      process.exit(0);
    } else if (!arg.startsWith("-")) positionals.push(arg);
  }
  if (positionals[0]) opts.folder = positionals[0];
  return opts;
}

function printSummary(summary: IngestSummary): void {
  console.log("");
  console.log("Ingestion summary:");
  console.log(`  Files processed: ${summary.filesProcessed}`);
  console.log(`  Notes captured:  ${summary.notesWritten}`);
  console.log(`  Unchanged sources: ${summary.unchangedSources}`);
  console.log(`  Immediate creates: ${summary.immediateCreates}`);
  console.log(`  Pending proposals: ${summary.pendingProposals}`);
  console.log(`  Removed chunks: ${summary.removedChunks}`);
  console.log(`  Finalized source records: ${summary.finalizedSourceRecords}`);
  console.log(`  Secrets redacted: ${summary.redactions}`);
  if (summary.projectId) console.log(`  Project: ${summary.projectId} (${summary.projectPath})`);
  if (summary.skipped.length)
    console.log(`  Skipped: ${summary.skipped.length}\n    - ${summary.skipped.join("\n    - ")}`);
  if (summary.warnings.length)
    console.log(
      `  Warnings: ${summary.warnings.length}\n    - ${summary.warnings.join("\n    - ")}`,
    );
  if (summary.failures.length)
    console.log(
      `  Failures: ${summary.failures.length}\n    - ${summary.failures.join("\n    - ")}`,
    );
}

function sanitizeIngestError(message: string, filePath: string, ingestRoot: string): string {
  return message
    .replaceAll(filePath, path.basename(filePath))
    .replaceAll(ingestRoot, "<ingest-root>")
    .replaceAll(process.cwd(), "<workspace>");
}

// Only run as a CLI when invoked directly (not when imported by tests).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  runIngest(options)
    .then((summary) => {
      printSummary(summary);
      process.exit(summary.failures.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
