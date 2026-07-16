#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { validateAllProjects } from "./project-service.js";
import type { ProjectValidationResult } from "./types.js";

/**
 * Generalized, byte-preserving workspace exporter.
 *
 * Unlike the public demo exporter (which regenerates project records through the
 * CLI), this copies the selected scan roots verbatim so private notes are never
 * silently rewritten. It produces a self-contained, data-only workspace that a
 * local GKE engine can point `KB_MCP_REPO_ROOT` at.
 */

export const EXPORT_MARKER = ".gke-workspace-export";
export const EXPORT_MANIFEST = "export-manifest.json";
export const EXPORT_WORKSPACE_DOC = "WORKSPACE.md";
// Used only when neither --scan-root nor a workspace configuration provides roots.
export const FALLBACK_EXPORT_ROOTS = ["kb"];

// Never copied, regardless of where they appear under a selected scan root.
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", "dist", ".cache", "content"]);
const EXCLUDED_FILE_NAMES = new Set([".DS_Store"]);
const SECRET_FILE_PATTERN = /^\.env(\..*)?$|\.(pem|key|p12|pfx)$|(^|[._-])secret/i;

// Generated files that describe the export but are not source data. Excluded
// from source-vs-export content comparisons.
export const GENERATED_FILES = new Set([EXPORT_MARKER, EXPORT_MANIFEST, EXPORT_WORKSPACE_DOC]);

export interface ExportWorkspaceOptions {
  repoRoot?: string;
  output: string;
  scanRoots?: string[];
  workspaceId?: string;
  sourceCommit?: string;
  dryRun?: boolean;
  force?: boolean;
  now?: () => Date;
}

export interface ExportedFile {
  relPath: string;
  size: number;
  sha256: string;
}

export interface ExportManifest {
  schemaVersion: number;
  workspaceId: string;
  sourceCommit: string;
  exportedAt: string;
  includedRoots: string[];
  fileCount: number;
  totalBytes: number;
  files: ExportedFile[];
}

export interface ExportWorkspaceResult {
  output: string;
  relativeOutput: string;
  dryRun: boolean;
  includedRoots: string[];
  fileCount: number;
  totalBytes: number;
  manifest: ExportManifest;
  projectValidation: ProjectValidationResult[];
  warnings: string[];
}

export async function exportWorkspace(
  options: ExportWorkspaceOptions,
): Promise<ExportWorkspaceResult> {
  if (!options.output) throw new Error("An output path is required (--output).");
  const repoRoot = await fs.realpath(path.resolve(options.repoRoot || process.cwd()));
  const destination = path.resolve(options.output);
  const relativeOutput = path.relative(process.cwd(), destination).split(path.sep).join("/") || ".";
  let defaultRoots = FALLBACK_EXPORT_ROOTS;
  let workspaceIdDefault = "";
  try {
    const workspace = await loadWorkspaceContext({ repoRoot });
    defaultRoots = [...workspace.scanRoots];
    workspaceIdDefault = workspace.id;
  } catch {
    // No usable workspace configuration; the fallback root plus explicit
    // --scan-root arguments keep the exporter usable on bare repositories.
  }
  const requestedRoots = dedupe(
    (options.scanRoots && options.scanRoots.length ? options.scanRoots : defaultRoots).map(
      normalizeWorkspaceRelativePath,
    ),
  );
  const now = options.now || (() => new Date());
  const warnings: string[] = [];

  // 1. Resolve every scan root, verifying it stays inside the source workspace
  //    (rejecting traversal and symlink escapes) before any file is read.
  const includedRoots: string[] = [];
  const collected: Array<{ absPath: string; relPath: string }> = [];
  for (const root of requestedRoots) {
    const realRoot = await resolveInsideRepo(repoRoot, root);
    if (!realRoot) {
      warnings.push(`Skipped missing scan root: ${root}`);
      continue;
    }
    includedRoots.push(root);
    const stat = await fs.stat(realRoot);
    if (stat.isDirectory()) {
      await collectFiles(realRoot, root, collected);
    } else if (stat.isFile()) {
      collected.push({ absPath: realRoot, relPath: root });
    }
  }
  collected.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // 2. Hash every included file and build the deterministic manifest.
  const files: ExportedFile[] = [];
  let totalBytes = 0;
  for (const file of collected) {
    const data = await fs.readFile(file.absPath);
    totalBytes += data.byteLength;
    files.push({
      relPath: file.relPath,
      size: data.byteLength,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    });
  }
  const manifest: ExportManifest = {
    schemaVersion: 1,
    workspaceId:
      options.workspaceId ||
      process.env.KB_MCP_WORKSPACE_ID ||
      workspaceIdDefault ||
      path.basename(repoRoot),
    sourceCommit: options.sourceCommit || "unknown",
    exportedAt: now().toISOString(),
    includedRoots,
    fileCount: files.length,
    totalBytes,
    files,
  };

  if (options.dryRun) {
    return {
      output: destination,
      relativeOutput,
      dryRun: true,
      includedRoots,
      fileCount: files.length,
      totalBytes,
      manifest,
      projectValidation: [],
      warnings,
    };
  }

  // 3. Stage into a temporary sibling directory so a failure never corrupts a
  //    previous valid export.
  const destinationParent = path.dirname(destination);
  await fs.mkdir(destinationParent, { recursive: true });
  const staging = await fs.mkdtemp(
    path.join(destinationParent, `.${path.basename(destination)}-staging-`),
  );

  try {
    for (const file of collected) {
      const target = path.join(staging, file.relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.absPath, target);
    }

    await fs.writeFile(path.join(staging, EXPORT_MARKER), "generated\n", "utf8");
    await fs.writeFile(
      path.join(staging, EXPORT_MANIFEST),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(staging, EXPORT_WORKSPACE_DOC),
      renderWorkspaceDoc(manifest, destination),
      "utf8",
    );

    // 4. Validate the exported projects from the staged copy before replacing
    //    the destination. Source records should already be valid; if not, fix
    //    them in the source workspace rather than patching the generated copy.
    const projectValidation = await validateAllProjects({ repoRoot: staging, scanRoots: ["kb"] });
    const invalid = projectValidation.filter((result) => !result.valid);
    if (invalid.length) {
      throw new Error(
        `Exported projects failed validation (fix the source records, not the copy): ${invalid
          .map((result) => result.projectId)
          .join(", ")}`,
      );
    }

    // 5. Replace only a destination that proves it was generated by this
    //    exporter (carries the marker), and only when --force is given.
    if (await exists(destination)) {
      const marked = await exists(path.join(destination, EXPORT_MARKER));
      if (!marked) {
        throw new Error(
          `Refusing to replace a destination not generated by this exporter: ${relativeOutput}`,
        );
      }
      if (!options.force) {
        throw new Error(
          `Destination already exists. Re-run with --force to replace it: ${relativeOutput}`,
        );
      }
      await fs.rm(destination, { recursive: true, force: true });
    }
    await fs.rename(staging, destination);

    return {
      output: destination,
      relativeOutput,
      dryRun: false,
      includedRoots,
      fileCount: files.length,
      totalBytes,
      manifest,
      projectValidation,
      warnings,
    };
  } finally {
    if (await exists(staging)) await fs.rm(staging, { recursive: true, force: true });
  }
}

async function resolveInsideRepo(repoRoot: string, relPath: string): Promise<string | null> {
  const target = path.resolve(repoRoot, relPath);
  if (target !== repoRoot && !target.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Scan root escapes the workspace root: ${relPath}`);
  }
  if (!(await exists(target))) return null;
  const realTarget = await fs.realpath(target);
  if (realTarget !== repoRoot && !realTarget.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Scan root resolves outside the workspace through a symlink: ${relPath}`);
  }
  return realTarget;
}

async function collectFiles(
  dir: string,
  relDir: string,
  out: Array<{ absPath: string; relPath: string }>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      await collectFiles(absPath, relPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILE_NAMES.has(entry.name) || SECRET_FILE_PATTERN.test(entry.name)) continue;
    out.push({ absPath, relPath });
  }
}

function renderWorkspaceDoc(manifest: ExportManifest, destination: string): string {
  return `# ${manifest.workspaceId} — standalone GKE workspace

This is a data-only knowledge workspace exported by the Grounded Knowledge
Engine workspace exporter. It contains only canonical Markdown/source data — no engine code, build
output, caches, secrets, or version-control metadata.

Connect a local Grounded Knowledge Engine to it by pointing the MCP server at
this directory:

\`\`\`bash
export KB_MCP_REPO_ROOT="${destination}"
export KB_MCP_SCAN_ROOTS="${manifest.includedRoots.join(",")}"
npm run dev:mcp
\`\`\`

You can also drive the deterministic project CLI against it:

\`\`\`bash
npm run project -- list --repo-root "${destination}"
npm run project -- validate --repo-root "${destination}"
\`\`\`

## Export provenance

- Workspace ID: \`${manifest.workspaceId}\`
- Source commit: \`${manifest.sourceCommit}\`
- Included roots: ${manifest.includedRoots.map((root) => `\`${root}\``).join(", ")}
- Files: ${manifest.fileCount} (${manifest.totalBytes} bytes)

\`${EXPORT_MANIFEST}\` lists every included file with its SHA-256 hash for
integrity verification. \`${EXPORT_MARKER}\` marks this directory as exporter-owned
so re-exports can safely replace it.
`;
}

function normalizeWorkspaceRelativePath(value: string): string {
  const normalized = `${value ?? ""}`
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) throw new Error("Scan root path is required.");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Unsafe scan root path: ${value}`);
  }
  return normalized;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// --- Thin CLI wrapper (testable: import exportWorkspace directly elsewhere) ---

export async function runExportWorkspaceCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const args = parseExportArgs(argv);
  const output = args.values.get("output")?.[0];
  if (!output) {
    console.error(
      "Usage: export:workspace --output <path> [--scan-root <path>]... [--dry-run] [--force] [--json]",
    );
    return 1;
  }
  const repoRoot = path.resolve(args.values.get("repo-root")?.[0] || cwd);
  const scanRoots = args.values.get("scan-root") || [];
  const json = args.values.has("json");
  const result = await exportWorkspace({
    repoRoot,
    output: path.isAbsolute(output) ? output : path.resolve(cwd, output),
    scanRoots: scanRoots.length ? scanRoots : undefined,
    workspaceId: args.values.get("workspace-id")?.[0],
    sourceCommit: args.values.get("source-commit")?.[0] || resolveGitCommit(repoRoot),
    dryRun: args.values.has("dry-run"),
    force: args.values.has("force"),
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = result.dryRun ? "Would export" : "Exported";
    console.log(
      `${verb} ${result.fileCount} files (${result.totalBytes} bytes) to ${result.output}`,
    );
    console.log(`Included roots: ${result.includedRoots.join(", ")}`);
    for (const warning of result.warnings) console.log(`Warning: ${warning}`);
    if (!result.dryRun) {
      console.log(
        `Validated projects: ${result.projectValidation.map((r) => r.projectId).join(", ") || "(none)"}`,
      );
    }
  }
  return 0;
}

interface ParsedExportArgs {
  values: Map<string, string[]>;
}

function parseExportArgs(argv: string[]): ParsedExportArgs {
  const values = new Map<string, string[]>();
  const booleanFlags = new Set(["dry-run", "force", "json"]);
  const known = new Set([
    "output",
    "scan-root",
    "repo-root",
    "workspace-id",
    "source-commit",
    ...booleanFlags,
  ]);
  const list = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (!known.has(name)) throw new Error(`Unknown option: --${name}`);
    if (booleanFlags.has(name)) {
      values.set(name, ["true"]);
      continue;
    }
    const value = inlineValue ?? list[++index];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for --${name}`);
    values.set(name, [...(values.get(name) || []), value]);
  }
  return { values };
}

function resolveGitCommit(repoRoot: string): string {
  try {
    const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
    const commit = `${result.stdout || ""}`.trim();
    return commit || "unknown";
  } catch {
    return "unknown";
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runExportWorkspaceCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
