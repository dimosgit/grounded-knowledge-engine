#!/usr/bin/env node
/**
 * Document ingestion CLI for the Grounded Knowledge Engine.
 *
 *   npm run ingest -- <folder> [--module <key>] [--dry-run] [--no-scrub] [--max-chars <n>]
 *
 * Walks a folder, extracts text from PDF/DOCX/XLSX/Markdown/text files,
 * normalizes + scrubs it, and captures each document as a KB topic note via the
 * real kb.upsert_note write path (spawning the MCP server). Once a document is a
 * Markdown note in kb/, grounding and the cockpit graph pick it up unchanged.
 *
 * No network, no external API — all extraction is local.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFormat, extractText, isSupported } from "./extractors.js";
import { normalizeDocument } from "./normalize.js";
import { spawnKbServer } from "../kb-mcp-server/mcp-client.js";

export interface IngestOptions {
  folder: string;
  module: string;
  dryRun: boolean;
  scrub: boolean;
  maxChars?: number;
  logger?: (line: string) => void;
}

export interface IngestSummary {
  filesProcessed: number;
  notesWritten: number;
  redactions: number;
  warnings: string[];
  skipped: string[];
  failures: string[];
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".cache", "content"]);

/** Slugify a relative source path (extension included) into a unique note basename. */
export function slugifySource(relToRoot: string): string {
  return relToRoot
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "document";
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

  log(`Found ${files.length} document(s) to ingest from ${root}${options.dryRun ? " [dry-run]" : ""}.`);

  // Build all notes first (extraction can warn / skip) before touching the KB.
  type PendingNote = { title: string; body: string; sourceRel: string; path: string };
  const pending: PendingNote[] = [];

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
      const normalized = normalizeDocument(extracted.text, { sourceFile: rel, scrub: options.scrub, maxChars: options.maxChars });
      summary.redactions += normalized.redactions;
      for (const note of normalized.notes) {
        // Deterministic, source-derived path so distinct files never collide
        // (e.g. report.pdf vs report.docx) and re-ingesting is idempotent.
        const suffix = note.chunkCount > 1 ? `-part-${note.chunkIndex + 1}` : "";
        pending.push({ title: note.title, body: note.body, sourceRel: rel, path: `kb/topics/${slug}${suffix}.md` });
      }
      summary.filesProcessed += 1;
      log(`  • ${rel} → ${normalized.notes.length} note(s)${detectFormat(file) ? ` [${detectFormat(file)}]` : ""}`);
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
    KB_MCP_ENABLE_WRITES: options.dryRun ? "false" : "true",
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
      log(`  ✓ ${sc?.action ?? "captured"}${options.dryRun ? " (dry-run)" : ""}: ${sc?.path ?? note.title}`);
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

function parseArgs(argv: string[]): IngestOptions {
  const opts: IngestOptions = { folder: "./inbox", module: "general", dryRun: false, scrub: true };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-scrub") opts.scrub = false;
    else if (arg === "--module") opts.module = argv[++i];
    else if (arg === "--max-chars") opts.maxChars = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run ingest -- <folder> [--module <key>] [--dry-run] [--no-scrub] [--max-chars <n>]",
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
  if (summary.skipped.length) console.log(`  Skipped: ${summary.skipped.length}\n    - ${summary.skipped.join("\n    - ")}`);
  if (summary.warnings.length) console.log(`  Warnings: ${summary.warnings.length}\n    - ${summary.warnings.join("\n    - ")}`);
  if (summary.failures.length) console.log(`  Failures: ${summary.failures.length}\n    - ${summary.failures.join("\n    - ")}`);
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
