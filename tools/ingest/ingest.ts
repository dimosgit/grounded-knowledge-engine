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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFormat, extractText, isSupported } from "./extractors.js";
import { normalizeDocument } from "./normalize.js";
import { spawnKbServer } from "../kb-mcp-server/mcp-client.js";
import { normalizeProjectId } from "../projects/project-manifest.js";
import { createProject, getProject, linkProjectSource } from "../projects/project-service.js";

export interface IngestOptions {
  folder: string;
  module: string;
  dryRun: boolean;
  scrub: boolean;
  maxChars?: number;
  /** Project name/ID to create from the ingested notes; "" derives it from the folder name. */
  project?: string;
  logger?: (line: string) => void;
}

export interface IngestSummary {
  filesProcessed: number;
  notesWritten: number;
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
    redactions: 0,
    warnings: [],
    skipped: [],
    failures: [],
  };

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

  log(
    `Found ${files.length} document(s) to ingest from ${root}${options.dryRun ? " [dry-run]" : ""}.`,
  );

  // Build all notes first (extraction can warn / skip) before touching the KB.
  type PendingNote = { title: string; body: string; sourceRel: string; path: string };
  const pending: PendingNote[] = [];
  const captured: Array<{ title: string; path: string }> = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const slug = slugifySource(path.relative(root, file));
    try {
      const extracted = await extractText(file);
      for (const w of extracted.warnings) summary.warnings.push(`${rel}: ${w}`);
      if (!extracted.text) {
        summary.skipped.push(`${rel} (no extractable text)`);
        continue;
      }
      const normalized = normalizeDocument(extracted.text, {
        sourceFile: rel,
        scrub: options.scrub,
        maxChars: options.maxChars,
      });
      summary.redactions += normalized.redactions;
      for (const note of normalized.notes) {
        // Deterministic, source-derived path so distinct files never collide
        // (e.g. report.pdf vs report.docx) and re-ingesting is idempotent.
        const suffix = note.chunkCount > 1 ? `-part-${note.chunkIndex + 1}` : "";
        pending.push({
          title: note.title,
          body: note.body,
          sourceRel: rel,
          path: `kb/topics/${slug}${suffix}.md`,
        });
      }
      summary.filesProcessed += 1;
      log(
        `  • ${rel} → ${normalized.notes.length} note(s)${detectFormat(file) ? ` [${detectFormat(file)}]` : ""}`,
      );
    } catch (error) {
      summary.failures.push(`${rel}: ${(error as Error).message}`);
      log(`  ✗ ${rel}: ${(error as Error).message}`);
    }
  }

  if (pending.length === 0) {
    log("Nothing to capture.");
    return summary;
  }

  const { child, client } = spawnKbServer({
    KB_MCP_ENABLE_WRITES: "true",
    KB_MCP_PROFILE: "full",
    KB_MCP_LOG_LEVEL: "error",
  });

  try {
    await client.initialize("kb-ingest-cli");
    for (const note of pending) {
      const result = await client.callTool("kb.upsert_note", {
        kind: "topic",
        title: note.title,
        body: note.body,
        path: note.path,
        module: options.module,
        type: "concept",
        status: "draft",
        tags: ["ingested"],
        owner: "kb-ingest",
        dryRun: options.dryRun,
      });
      if (result.isError) {
        const msg = result.content?.[0]?.text || "unknown error";
        summary.failures.push(`${note.sourceRel} → ${note.title}: ${msg}`);
        log(`  ✗ capture failed: ${note.title}: ${msg}`);
        continue;
      }
      summary.notesWritten += 1;
      const sc = result.structuredContent;
      captured.push({ title: note.title, path: sc?.path ?? note.path });
      log(
        `  ✓ ${sc?.action ?? "captured"}${options.dryRun ? " (dry-run)" : ""}: ${sc?.path ?? note.title}`,
      );
    }

    if (options.project !== undefined && captured.length > 0) {
      const name = options.project || path.basename(root);
      try {
        const project = await captureProjectRecord(name, root, captured, options.dryRun, log);
        summary.projectId = project.projectId;
        summary.projectPath = project.path;
      } catch (error) {
        summary.failures.push(`project '${name}': ${(error as Error).message}`);
        log(`  ✗ project capture failed: ${(error as Error).message}`);
      }
    }

    if (!options.dryRun && summary.notesWritten > 0) {
      await client.callTool("kb.refresh", {});
      log("Refreshed KB index.");
    }
  } finally {
    child.kill("SIGTERM");
  }

  return summary;
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
): Promise<{ projectId: string; path: string }> {
  const projectId = normalizeProjectId(name);
  if (!projectId) throw new Error(`Cannot derive a project ID from '${name}'.`);
  const repoRoot = process.cwd();
  const relRoot = path.relative(repoRoot, root).split(path.sep).join("/");
  const insideWorkspace =
    Boolean(relRoot) && !relRoot.startsWith("..") && !path.isAbsolute(relRoot);

  let projectPath: string;
  try {
    const existing = await getProject(projectId, { repoRoot });
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
    });
    projectPath = created.path;
    log(`  ✓ created${dryRun ? " (dry-run)" : ""} project: ${projectId} (${projectPath})`);
  }

  if (dryRun) {
    log(`  • dry-run: skipped linking ${notes.length} note(s) to ${projectId}`);
  } else {
    for (const note of notes) {
      await linkProjectSource({ repoRoot, projectId, sourcePath: note.path, label: note.title });
      log(`  ✓ linked to ${projectId}: ${note.path}`);
    }
  }
  return { projectId, path: projectPath };
}

function parseArgs(argv: string[]): IngestOptions {
  const opts: IngestOptions = { folder: "./inbox", module: "general", dryRun: false, scrub: true };
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
