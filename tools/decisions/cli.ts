#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { createDecisionApplicationService } from "./decision-application-service.js";
import type {
  DecisionConfidence,
  DecisionEvidenceInput,
  DecisionEvidenceReviewInput,
  DecisionRecord,
  DecisionReviewState,
  DecisionStatus,
} from "./types.js";

interface CliOptions {
  values: Map<string, string[]>;
  positionals: string[];
}

export async function runDecisionCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const [command, ...rest] = argv.filter((argument) => argument !== "--");
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  const parsed = parseArgs(rest);
  assertKnownOptions(command, parsed);
  const repoRoot = path.resolve(first(parsed, "repo-root") || cwd);
  const requestedScanRoots = all(parsed, "scan-root");
  const workspace = await loadWorkspaceContext({
    repoRoot,
    ...(requestedScanRoots.length ? { scanRoots: requestedScanRoots } : {}),
  });
  const scanRoots = [...workspace.scanRoots];
  const decisions = createDecisionApplicationService({ repoRoot, workspace, scanRoots });
  const json = has(parsed, "json");

  if (command === "create") {
    if (parsed.positionals.length > 1) {
      throw new Error("Usage: gke decisions create [decision-id] [options]");
    }
    const result = await decisions.record({
      decisionId: parsed.positionals[0],
      workspaceId: first(parsed, "workspace"),
      projectId: first(parsed, "project"),
      title: first(parsed, "title") || "",
      status: first(parsed, "status") as DecisionStatus | undefined,
      owner: first(parsed, "owner") || "",
      decidedAt: first(parsed, "decided-at") || "",
      evidenceCheckedAt: first(parsed, "evidence-checked-at") || "",
      reviewAfter: first(parsed, "review-after") || "",
      confidence: first(parsed, "confidence") as DecisionConfidence,
      tags: all(parsed, "tag"),
      question: first(parsed, "question") || "",
      recommendation: first(parsed, "recommendation") || "",
      alternatives: all(parsed, "alternative"),
      rationale: first(parsed, "rationale") || "",
      assumptions: all(parsed, "assumption"),
      risks: all(parsed, "risk"),
      evidence: all(parsed, "evidence").map(parseEvidence),
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.dryRun ? "Would create" : "Created"} decision ${result.decisionId}`);
      console.log(`Decision record: ${result.path}`);
      console.log(`Review state: ${result.reviewState}`);
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "get") {
    const identifier = parsed.positionals[0];
    if (!identifier || parsed.positionals.length > 1) {
      throw new Error("Usage: gke decisions get <decision-id|path|title> [options]");
    }
    const result = await decisions.get({
      identifier,
      asOf: first(parsed, "as-of"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (has(parsed, "raw")) {
      const raw = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(repoRoot, result.path), "utf8"),
      );
      console.log(raw.trimEnd());
    } else {
      printDecision(result);
    }
    return 0;
  }

  if (command === "list") {
    if (parsed.positionals.length) throw new Error("Usage: gke decisions list [options]");
    const results = await decisions.list({
      projectId: first(parsed, "project"),
      status: first(parsed, "status") as DecisionStatus | undefined,
      reviewState: first(parsed, "review-state") as DecisionReviewState | undefined,
      owner: first(parsed, "owner"),
      tag: first(parsed, "tag"),
      asOf: first(parsed, "as-of"),
    });
    if (json) console.log(JSON.stringify(results, null, 2));
    else if (!results.length) console.log("No decisions found.");
    else {
      for (const result of results) {
        console.log(
          `${result.decisionId}\t${result.status}\t${result.reviewState}\t${result.title}\t${result.path}`,
        );
      }
    }
    return 0;
  }

  if (command === "review") {
    const decisionId = parsed.positionals[0];
    if (!decisionId || parsed.positionals.length > 1) {
      throw new Error("Usage: gke decisions review <decision-id> [options]");
    }
    const result = await decisions.review({
      decisionId,
      reviewedAt: first(parsed, "reviewed-at") || "",
      reviewAfter: first(parsed, "review-after") || "",
      reviewer: first(parsed, "reviewer") || "",
      recommendationSupported: parseSupported(first(parsed, "supported")),
      assumptionsNeedingValidation: all(parsed, "assumption"),
      evidence: all(parsed, "evidence").map(parseReviewEvidence),
      notes: first(parsed, "notes"),
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.dryRun ? "Would review" : "Reviewed"} decision ${result.decisionId}`);
      for (const change of result.changes) {
        const evidence = change.current || change.previous;
        console.log(`${change.classification}\t${evidence?.path}:${evidence?.line}`);
      }
      if (result.dryRun) console.log(`\n${result.content}`);
    }
    return 0;
  }

  if (command === "supersede") {
    const [decisionId, replacementId] = parsed.positionals;
    if (!decisionId || !replacementId || parsed.positionals.length > 2) {
      throw new Error("Usage: gke decisions supersede <decision-id> <replacement-id> [options]");
    }
    const result = await decisions.supersede({
      decisionId,
      replacementId,
      supersededAt: first(parsed, "superseded-at") || "",
      reason: first(parsed, "reason") || "",
      dryRun: has(parsed, "dry-run"),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.dryRun ? "Would supersede" : "Superseded"} ${decisionId} with ${replacementId}`,
      );
    }
    return 0;
  }

  throw new Error(`Unknown decision command: ${command}`);
}

function printDecision(decision: DecisionRecord): void {
  console.log(`${decision.title} (${decision.decisionId})`);
  console.log(`Path: ${decision.path}`);
  console.log(`Status: ${decision.status}`);
  console.log(`Review state: ${decision.reviewState}`);
  console.log(`Review after: ${decision.reviewAfter}`);
  console.log(`Confidence: ${decision.confidence}`);
  console.log(`Recommendation: ${decision.recommendation}`);
  if (decision.reviewState !== "current") {
    console.log(`Warning: decision evidence review is ${decision.reviewState}.`);
  }
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  const booleanFlags = new Set(["json", "raw", "dry-run"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [name, inlineValue] = argument.slice(2).split("=", 2);
    if (booleanFlags.has(name)) {
      values.set(name, ["true"]);
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    values.set(name, [...(values.get(name) || []), value]);
  }
  return { values, positionals };
}

function assertKnownOptions(command: string, options: CliOptions): void {
  const global = ["repo-root", "scan-root", "json"];
  const commands: Record<string, string[]> = {
    create: [
      "workspace",
      "project",
      "title",
      "status",
      "owner",
      "decided-at",
      "evidence-checked-at",
      "review-after",
      "confidence",
      "tag",
      "question",
      "recommendation",
      "alternative",
      "rationale",
      "assumption",
      "risk",
      "evidence",
      "dry-run",
    ],
    get: ["as-of", "raw"],
    list: ["project", "status", "review-state", "owner", "tag", "as-of"],
    review: [
      "reviewed-at",
      "review-after",
      "reviewer",
      "supported",
      "assumption",
      "evidence",
      "notes",
      "dry-run",
    ],
    supersede: ["superseded-at", "reason", "dry-run"],
  };
  if (!(command in commands)) return;
  const allowed = new Set([...global, ...commands[command]]);
  const unknown = [...options.values.keys()].find((name) => !allowed.has(name));
  if (unknown) throw new Error(`Unknown option for '${command}': --${unknown}`);
}

function parseEvidence(value: string): DecisionEvidenceInput {
  const match = value.trim().match(/^(.+):([1-9]\d*)$/);
  if (!match) throw new Error(`Decision evidence must use path:line syntax: ${value}`);
  return { path: match[1], line: Number.parseInt(match[2], 10) };
}

function parseReviewEvidence(value: string): DecisionEvidenceReviewInput {
  const match = value
    .trim()
    .match(/^(.+):([1-9]\d*)(?:@(unchanged|strengthened|weakened|contradicted|new))?$/);
  if (!match) {
    throw new Error(
      `Reviewed evidence must use path:line or path:line@classification syntax: ${value}`,
    );
  }
  return {
    path: match[1],
    line: Number.parseInt(match[2], 10),
    ...(match[3]
      ? { classification: match[3] as DecisionEvidenceReviewInput["classification"] }
      : {}),
  };
}

function parseSupported(value: string | undefined): boolean | "uncertain" {
  if (value === "yes" || value === "true") return true;
  if (value === "no" || value === "false") return false;
  if (value === "uncertain") return "uncertain";
  throw new Error("--supported must be yes, no, or uncertain.");
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

function printHelp(): void {
  console.log(`GKE decision administration

Usage:
  gke decisions create [decision-id] [options]
  gke decisions get <decision-id|path|title> [--as-of <date>] [--raw|--json]
  gke decisions list [filters] [--json]
  gke decisions review <decision-id> [options]
  gke decisions supersede <decision-id> <replacement-id> [options]

Create options:
  --title <title>                    required; also derives the ID when omitted
  --workspace <workspace-id>         default: active workspace
  --project <project-id>             optional canonical project
  --status <status>                  proposed, active, superseded, or rejected
  --owner <owner>                    required
  --decided-at <YYYY-MM-DD>          required
  --evidence-checked-at <date>       required
  --review-after <YYYY-MM-DD>        required
  --confidence <low|medium|high>     required
  --tag <tag>                        repeatable
  --question <text>                  required
  --recommendation <text>            required
  --alternative <text>               repeatable
  --rationale <text>                 required
  --assumption <text>                repeatable
  --risk <text>                      repeatable
  --evidence <path:line>             repeatable; project-scoped when project is set
  --dry-run

List filters:
  --project <project-id>
  --status <status>
  --review-state <current|due|overdue>
  --owner <owner>
  --tag <tag>
  --as-of <YYYY-MM-DD>

Review options:
  --reviewed-at <YYYY-MM-DD>          required evidence-check date
  --review-after <YYYY-MM-DD>         required next review date
  --reviewer <name>                   required
  --supported <yes|no|uncertain>      required recommendation assessment
  --assumption <text>                 repeatable human-validation item
  --evidence <path:line@class>        repeatable; class suffix is optional
  --notes <text>
  --dry-run

Supersede options:
  --superseded-at <YYYY-MM-DD>        required
  --reason <text>                     required
  --dry-run

Global options:
  --repo-root <path>
  --scan-root <path>                 repeatable; default: active workspace roots
  --json`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runDecisionCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
