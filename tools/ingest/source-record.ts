import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../grounding/document-core.js";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";

export const INGEST_PIPELINE_VERSION = 1 as const;
export const DEFAULT_INGEST_MAX_CHARS = 12_000;

export interface ExtractionProvenance {
  converter: string;
  converterVersion: string;
  configuredMode: string;
  scrub: boolean;
  maxChars: number;
  pipelineVersion: typeof INGEST_PIPELINE_VERSION;
}

export interface GeneratedSourceNote {
  title: string;
  path: string;
}

export interface SourceRecord {
  sourceId: string;
  workspaceId: string;
  title: string;
  sourceKind: string;
  sourceUri: string;
  sourceHash: string;
  acceptedAt: string;
  projectId: string | null;
  provenance: ExtractionProvenance;
  settingsHash: string;
  generatedNotes: GeneratedSourceNote[];
  warnings: string[];
}

export function normalizeIngestRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Source path must be relative to the ingest root.");
  }
  return normalized;
}

export function deriveSourceId(relativePath: string): string {
  const normalized = normalizeIngestRelativePath(relativePath);
  const slug =
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "source";
  return `${slug}-${sha256(normalized).slice(0, 10)}`;
}

export function sourceRecordPath(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,110}$/.test(sourceId)) throw new Error("Invalid source ID.");
  return `kb/sources/${sourceId}.md`;
}

export function hashExtractionSettings(provenance: ExtractionProvenance): string {
  return sha256(
    JSON.stringify({
      configuredMode: provenance.configuredMode,
      converter: provenance.converter,
      converterVersion: provenance.converterVersion,
      maxChars: provenance.maxChars,
      pipelineVersion: provenance.pipelineVersion,
      scrub: provenance.scrub,
    }),
  );
}

export function renderSourceRecord(record: SourceRecord): string {
  const notePaths = record.generatedNotes.map((note) => note.path).join(", ");
  const projectLine = record.projectId ? [`project_id: ${safeScalar(record.projectId)}`] : [];
  const warningLines = record.warnings.length
    ? record.warnings.map((warning) => `- ${safeBodyLine(warning)}`)
    : ["- None."];
  const noteLines = record.generatedNotes.length
    ? record.generatedNotes.map(
        (note) => `- [${escapeLinkLabel(note.title)}](${sourceRecordLink(note.path)})`,
      )
    : ["- No generated topic notes."];
  return [
    "---",
    "schema_version: 1",
    "record_type: source",
    `workspace_id: ${safeScalar(record.workspaceId)}`,
    `source_id: ${safeScalar(record.sourceId)}`,
    ...projectLine,
    `title: ${safeScalar(record.title)}`,
    `source_kind: ${safeScalar(record.sourceKind)}`,
    `format: ${safeScalar(record.sourceKind)}`,
    `source_uri: ${safeScalar(record.sourceUri)}`,
    `captured_at: ${record.acceptedAt.slice(0, 10)}`,
    `accepted_at: ${record.acceptedAt}`,
    `content_hash: sha256:${record.sourceHash}`,
    `updated: ${record.acceptedAt.slice(0, 10)}`,
    `converter: ${safeScalar(record.provenance.converter)}`,
    `converter_version: ${safeScalar(record.provenance.converterVersion)}`,
    `extraction_mode: ${safeScalar(record.provenance.configuredMode)}`,
    `extraction_settings_hash: sha256:${record.settingsHash}`,
    `extraction_max_chars: ${record.provenance.maxChars}`,
    `extraction_scrub: ${record.provenance.scrub}`,
    `ingest_pipeline_version: ${record.provenance.pipelineVersion}`,
    `generated_note_paths: ${notePaths}`,
    "---",
    "",
    `# ${safeHeading(record.title)}`,
    "",
    "## Provenance",
    "",
    `- Source ID: \`${record.sourceId}\``,
    `- Ingest-root-relative source: \`${record.sourceUri}\``,
    `- Converter: \`${record.provenance.converter}\` \`${record.provenance.converterVersion}\``,
    `- Accepted: ${record.acceptedAt}`,
    "",
    "## Extracted content",
    "",
    ...noteLines,
    "",
    "## Ingestion warnings",
    "",
    ...warningLines,
    "",
  ].join("\n");
}

export async function readSourceRecord(
  repoRoot: string,
  sourceId: string,
  workspace: WorkspaceContext,
): Promise<SourceRecord | null> {
  const target = path.join(repoRoot, sourceRecordPath(sourceId));
  try {
    await authorizeWorkspaceOperationalRead(workspace, target);
    const raw = await fs.readFile(target, "utf8");
    return parseSourceRecord(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeSourceRecord(
  repoRoot: string,
  record: SourceRecord,
  workspace: WorkspaceContext,
): Promise<string> {
  const relPath = sourceRecordPath(record.sourceId);
  const target = path.join(repoRoot, relPath);
  await atomicWrite(target, renderSourceRecord(record), workspace);
  return relPath;
}

export function parseSourceRecord(raw: string): SourceRecord {
  const { frontmatter } = parseFrontmatter(raw);
  if (frontmatter.schema_version !== "1" || frontmatter.record_type !== "source") {
    throw new Error("Canonical source record has an unsupported schema.");
  }
  const sourceHash = stripHashPrefix(frontmatter.content_hash);
  const settingsHash = stripHashPrefix(frontmatter.extraction_settings_hash);
  const acceptedAt = required(frontmatter.accepted_at, "accepted_at");
  if (Number.isNaN(Date.parse(acceptedAt)))
    throw new Error("Source record accepted_at is invalid.");
  return {
    sourceId: required(frontmatter.source_id, "source_id"),
    workspaceId: required(frontmatter.workspace_id, "workspace_id"),
    title: required(frontmatter.title, "title"),
    sourceKind: required(frontmatter.source_kind, "source_kind"),
    sourceUri: required(frontmatter.source_uri, "source_uri"),
    sourceHash,
    acceptedAt,
    projectId: frontmatter.project_id?.trim() || null,
    provenance: {
      converter: required(frontmatter.converter, "converter"),
      converterVersion: required(frontmatter.converter_version, "converter_version"),
      configuredMode: required(frontmatter.extraction_mode, "extraction_mode"),
      scrub: frontmatter.extraction_scrub === "true",
      maxChars: positiveInteger(frontmatter.extraction_max_chars, "extraction_max_chars"),
      pipelineVersion: INGEST_PIPELINE_VERSION,
    },
    settingsHash,
    generatedNotes: splitCsv(frontmatter.generated_note_paths).map((notePath) => ({
      title: path.basename(notePath, ".md"),
      path: notePath,
    })),
    warnings: [],
  };
}

async function atomicWrite(
  target: string,
  content: string,
  workspace: WorkspaceContext,
): Promise<void> {
  await authorizeWorkspaceWrite(workspace, target);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await authorizeWorkspaceWrite(workspace, target);
  const temporary = `${target}.gke-tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
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

function stripHashPrefix(value: unknown): string {
  const hash = required(value, "hash").replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Source record contains an invalid hash.");
  return hash;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number.parseInt(required(value, field), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Source record ${field} is invalid.`);
  return parsed;
}

function required(value: unknown, field: string): string {
  const normalized = `${value || ""}`.trim();
  if (!normalized) throw new Error(`Source record is missing ${field}.`);
  return normalized;
}

function splitCsv(value: unknown): string[] {
  return `${value || ""}`
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeScalar(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/:/g, "-")
    .trim();
}

function safeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function safeBodyLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeLinkLabel(value: string): string {
  return safeBodyLine(value).replace(/[[\]]/g, "");
}

function sourceRecordLink(notePath: string): string {
  return `../../${normalizeIngestRelativePath(notePath)}`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
