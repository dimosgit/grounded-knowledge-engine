#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadWorkspaceContext } from "../workspaces/config.js";
import type { CheckpointEvidenceInput } from "./checkpoint-service.js";
import { createProjectApplicationService } from "./project-application-service.js";

interface CliOptions {
  values: Map<string, string[]>;
  positionals: string[];
}

export async function runProjectCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const [command, ...rest] = argv.filter((arg) => arg !== "--");
  const parsed = parseArgs(rest);
  assertKnownOptions(command, parsed);
  const repoRoot = path.resolve(first(parsed, "repo-root") || cwd);
  const json = has(parsed, "json");

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  const requestedScanRoots = all(parsed, "scan-root");
  const workspace = await loadWorkspaceContext({
    repoRoot,
    ...(requestedScanRoots.length ? { scanRoots: requestedScanRoots } : {}),
  });
  const scanRoots = [...workspace.scanRoots];
  const projectService = createProjectApplicationService({ repoRoot, workspace, scanRoots });

  if (command === "checkpoint") {
    const projectId = parsed.positionals[0];
    if (!projectId || parsed.positionals.length > 1) {
      throw new Error("Usage: gke checkpoint <project-id> [options]");
    }
    const result = await projectService.createCheckpoint({
      projectId,
      checkpointId: first(parsed, "id"),
      title: first(parsed, "title") || "",
      createdAt: first(parsed, "created-at"),
      author: first(parsed, "author"),
      whatChanged: first(parsed, "what-changed") || "",
      completed: all(parsed, "completed"),
      currentBlocker: first(parsed, "blocker"),
      nextStartingPoint: first(parsed, "next-start") || "",
      evidence: all(parsed, "evidence").map(parseCheckpointEvidence),
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.dryRun ? "Would create" : "Created"} checkpoint ${result.checkpointId}`,
      );
      console.log(`Checkpoint record: ${result.path}`);
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "create") {
    const projectId = parsed.positionals[0];
    if (!projectId) throw new Error("Usage: gke create <project-id> [options]");
    const result = await projectService.create({
      projectId,
      title: first(parsed, "title"),
      workspaceId: first(parsed, "workspace"),
      status: first(parsed, "status"),
      lifecycle: first(parsed, "lifecycle"),
      owner: first(parsed, "owner"),
      track: first(parsed, "track"),
      startedAt: first(parsed, "started-at"),
      updated: first(parsed, "updated"),
      reviewAfter: first(parsed, "review-after"),
      tags: all(parsed, "tag"),
      sourceRoots: all(parsed, "source-root"),
      createSourceDirectory: !has(parsed, "no-source-dir"),
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.dryRun ? "Would create" : "Created"} project ${result.projectId}`);
      console.log(`Project record: ${result.path}`);
      for (const sourceRoot of result.sourceDirectories) console.log(`Source root: ${sourceRoot}`);
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "list") {
    const projects = await projectService.list();
    if (json) console.log(JSON.stringify(projects, null, 2));
    else if (!projects.length) console.log("No projects found.");
    else {
      for (const project of projects) {
        console.log(
          `${project.projectId}\t${project.status || "-"}\t${project.title}\t${project.path}`,
        );
      }
    }
    return 0;
  }

  if (command === "review") {
    const projectId = parsed.positionals[0];
    if (parsed.positionals.length > 1) {
      throw new Error("Usage: gke review [project-id] [options]");
    }
    const result = await projectService.review({
      asOf: first(parsed, "as-of"),
      since: first(parsed, "since"),
      projectId,
      state: first(parsed, "state") as "due" | "overdue" | "all" | undefined,
    });
    if (json) console.log(JSON.stringify(result.structured, null, 2));
    else console.log(result.contentText);
    return 0;
  }

  if (command === "show") {
    const projectId = parsed.positionals[0];
    if (!projectId) throw new Error("Usage: gke show <project-id>");
    const project = await projectService.get(projectId);
    if (json) {
      console.log(
        JSON.stringify(
          {
            path: project.path,
            manifest: project.parsed.manifest,
            sections: Object.fromEntries(
              [...project.parsed.sections.entries()].map(([key, section]) => [
                key,
                section.content,
              ]),
            ),
          },
          null,
          2,
        ),
      );
    } else if (has(parsed, "raw")) console.log(project.raw.trimEnd());
    else {
      const manifest = project.parsed.manifest;
      console.log(`${manifest.title} (${manifest.projectId})`);
      console.log(`Path: ${project.path}`);
      console.log(`Status: ${manifest.status || "-"}`);
      console.log(`Owner: ${manifest.owner || "-"}`);
      console.log(`Track: ${manifest.track || "-"}`);
      console.log(`Updated: ${manifest.updated || "-"}`);
      console.log(`Source roots: ${manifest.sourceRoots.join(", ") || "-"}`);
    }
    return 0;
  }

  if (command === "validate") {
    const projectId = parsed.positionals[0];
    const results = projectId
      ? [await projectService.validate(projectId)]
      : await projectService.validateAll();
    if (json) console.log(JSON.stringify(results, null, 2));
    else {
      for (const result of results) {
        console.log(`${result.valid ? "PASS" : "FAIL"} ${result.projectId} (${result.path})`);
        for (const issue of result.issues) {
          console.log(`  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
        }
      }
      if (!results.length) console.log("No projects found.");
    }
    return results.every((result) => result.valid) ? 0 : 1;
  }

  if (command === "update") {
    const projectId = parsed.positionals[0];
    if (!projectId) throw new Error("Usage: gke update <project-id> [options]");
    const result = await projectService.update({
      projectId,
      title: first(parsed, "title"),
      status: first(parsed, "status"),
      lifecycle: first(parsed, "lifecycle"),
      owner: first(parsed, "owner"),
      track: first(parsed, "track"),
      updated: first(parsed, "updated"),
      reviewAfter: first(parsed, "review-after"),
      tags: parsed.values.has("tag") ? all(parsed, "tag") : undefined,
      sourceRoots: parsed.values.has("source-root") ? all(parsed, "source-root") : undefined,
      sections: {
        ...(first(parsed, "outcome") !== undefined ? { outcome: first(parsed, "outcome") } : {}),
        ...(first(parsed, "current-focus") !== undefined
          ? { "current-focus": first(parsed, "current-focus") }
          : {}),
        ...(first(parsed, "last-change") !== undefined
          ? { "last-meaningful-change": first(parsed, "last-change") }
          : {}),
        ...(parsed.values.has("decision") ? { "active-decisions": all(parsed, "decision") } : {}),
        ...(parsed.values.has("blocker") ? { blockers: all(parsed, "blocker") } : {}),
        ...(parsed.values.has("open-question")
          ? { "open-questions": all(parsed, "open-question") }
          : {}),
        ...(parsed.values.has("next-action") ? { "next-actions": all(parsed, "next-action") } : {}),
        ...(parsed.values.has("key-document")
          ? { "key-documents": all(parsed, "key-document") }
          : {}),
      },
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.dryRun ? "Would update" : result.changed ? "Updated" : "No changes for"} project ${result.projectId}`,
      );
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "task") {
    const [subcommand, projectId, ...taskParts] = parsed.positionals;
    if (subcommand !== "add" || !projectId || !taskParts.length) {
      throw new Error(
        "Usage: gke task add <project-id> <text> [--size <XS|S|M|L|XL>] [--status <todo|in-progress|gated|done>]",
      );
    }
    const result = await projectService.addTask({
      projectId,
      text: taskParts.join(" "),
      size: first(parsed, "size") as "XS" | "S" | "M" | "L" | "XL" | undefined,
      status: first(parsed, "status") as "todo" | "in-progress" | "gated" | "done" | undefined,
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.dryRun ? "Would add" : "Added"} task to project ${result.projectId}: ${result.task.markdown}`,
      );
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "link") {
    const [projectId, sourcePath] = parsed.positionals;
    if (!projectId || !sourcePath) throw new Error("Usage: gke link <project-id> <source-path>");
    const result = await projectService.linkSource({
      projectId,
      sourcePath,
      label: first(parsed, "label"),
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.dryRun ? "Would link" : "Linked"} ${sourcePath} to ${result.projectId}`,
      );
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  throw new Error(`Unknown project command: ${command}`);
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  const booleanFlags = new Set(["json", "raw", "dry-run", "no-source-dir"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    if (booleanFlags.has(rawName)) {
      values.set(rawName, ["true"]);
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${rawName}`);
    }
    values.set(rawName, [...(values.get(rawName) || []), value]);
  }
  return { values, positionals };
}

function first(options: CliOptions, name: string): string | undefined {
  return options.values.get(name)?.[0];
}

function all(options: CliOptions, name: string): string[] {
  return options.values.get(name) || [];
}

function has(options: CliOptions, name: string): boolean {
  return options.values.has(name);
}

function assertKnownOptions(command: string | undefined, options: CliOptions): void {
  const globalOptions = ["repo-root", "json"];
  const commandOptions: Record<string, string[]> = {
    create: [
      "title",
      "workspace",
      "status",
      "lifecycle",
      "owner",
      "track",
      "started-at",
      "updated",
      "review-after",
      "tag",
      "source-root",
      "no-source-dir",
      "dry-run",
    ],
    checkpoint: [
      "id",
      "title",
      "created-at",
      "author",
      "what-changed",
      "completed",
      "blocker",
      "next-start",
      "evidence",
      "dry-run",
    ],
    list: [],
    review: ["as-of", "since", "state", "scan-root"],
    show: ["raw"],
    validate: [],
    update: [
      "title",
      "status",
      "lifecycle",
      "owner",
      "track",
      "updated",
      "review-after",
      "tag",
      "source-root",
      "outcome",
      "current-focus",
      "last-change",
      "decision",
      "blocker",
      "open-question",
      "next-action",
      "key-document",
      "dry-run",
    ],
    task: ["size", "status", "dry-run"],
    link: ["label", "dry-run"],
    help: [],
    "--help": [],
    "-h": [],
  };
  if (!command || !(command in commandOptions)) return;
  const allowed = new Set([...globalOptions, ...commandOptions[command]]);
  const unknown = [...options.values.keys()].filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw new Error(`Unknown option for '${command}': --${unknown[0]}`);
  }
}

function printHelp(): void {
  console.log(`GKE project administration

Usage:
  gke create <project-id> [options]
  gke checkpoint <project-id> [options]
  gke list [--json]
  gke review [project-id] [--as-of <date>] [--since <date-or-timestamp>] [--state <state>]
  gke show <project-id> [--raw|--json]
  gke validate [project-id] [--json]
  gke update <project-id> [options]
  gke task add <project-id> <text> [--size M] [--status todo]
  gke link <project-id> <source-path> [--label <label>]

Review options:
  --as-of <YYYY-MM-DD>        date used to compute due and overdue reviews
  --since <ISO date/time>     include explicitly scoped documents changed since this point
  --state <due|overdue|all>   filter review state; default: all
  --scan-root <path>          repeatable; default: demo-kb and kb

Create options:
  --title <title>
  --workspace <workspace-id>
  --status <status>
  --lifecycle <active|next|blocked|completed>
  --owner <owner>
  --track <track>
  --started-at <YYYY-MM-DD>
  --updated <YYYY-MM-DD>
  --review-after <YYYY-MM-DD>
  --tag <tag>                 repeatable
  --source-root <path>        repeatable
  --no-source-dir
  --dry-run

Checkpoint options:
  --id <checkpoint-id>        optional canonical ID; generated when omitted
  --title <title>             required checkpoint label
  --created-at <YYYY-MM-DD>   default: today
  --author <author>           default: project owner
  --what-changed <text>       required
  --completed <text>          repeatable
  --blocker <text>            default: None recorded.
  --next-start <text>         required next starting point
  --evidence <path:line>      repeatable; must be in explicit project scope
  --dry-run

Update options:
  --title <title>
  --status <status>
  --lifecycle <active|next|blocked|completed>
  --owner <owner>
  --track <track>
  --updated <YYYY-MM-DD>
  --review-after <YYYY-MM-DD>
  --tag <tag>                 repeatable; replaces existing tags
  --source-root <path>        repeatable; replaces existing roots
  --outcome <text>
  --current-focus <text>
  --last-change <text>
  --decision <text>           repeatable; replaces the section
  --blocker <text>            repeatable; replaces the section
  --open-question <text>      repeatable; replaces the section
  --next-action <text>        repeatable; replaces the section
  --key-document <text>       repeatable; replaces the section

Task add options:
  --size <XS|S|M|L|XL>       default: M
  --status <status>           todo, in-progress, gated, or done; default: todo
  --dry-run

Global options:
  --repo-root <path>
  --json`);
}

function parseCheckpointEvidence(value: string): CheckpointEvidenceInput {
  const match = value.trim().match(/^(.+):([1-9]\d*)$/);
  if (!match) throw new Error(`Checkpoint evidence must use path:line syntax: ${value}`);
  return { path: match[1], line: Number.parseInt(match[2], 10) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runProjectCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
