import path from "node:path";
import process from "node:process";
import {
  getCaptureProposal,
  listCaptureProposals,
  rejectCaptureProposal,
} from "./capture-service.js";
import type { CaptureAction } from "./types.js";
import { applyCaptureProposalAndRefresh } from "./capture-application-service.js";
import { loadWorkspaceContext } from "../workspaces/config.js";

interface CaptureCliOptions {
  values: Map<string, string>;
  flags: Set<string>;
  positionals: string[];
}

export async function runCaptureCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const [command, ...rest] = argv.filter((arg) => arg !== "--");
  const options = parseCaptureArgs(rest);
  const repoRoot = path.resolve(options.values.get("repo-root") || cwd);
  const json = options.flags.has("json");
  const dryRun = options.flags.has("dry-run");
  assertKnownCaptureOptions(command, options);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printCaptureHelp();
    return 0;
  }

  const workspace = await loadWorkspaceContext({ repoRoot });

  if (command === "list") {
    const proposals = await listCaptureProposals(repoRoot, workspace);
    if (json) console.log(JSON.stringify(proposals, null, 2));
    else if (!proposals.length) console.log("No pending capture proposals.");
    else {
      for (const proposal of proposals) {
        console.log(
          `${proposal.proposalId}\t${proposal.proposedAction}\t${proposal.proposedNote.path}\t${proposal.reviewReasons.join(",")}`,
        );
      }
    }
    return 0;
  }

  if (command === "show") {
    const proposalId = requireProposalId(options, "show");
    const proposal = await getCaptureProposal(repoRoot, proposalId, workspace);
    if (json) console.log(JSON.stringify(proposal, null, 2));
    else {
      console.log(`${proposal.proposalId} (${proposal.proposedAction})`);
      console.log(`Created: ${proposal.createdAt}`);
      console.log(`Target: ${proposal.proposedNote.path}`);
      if (proposal.routing) {
        console.log(`Routing: ${proposal.routing.status}`);
        console.log(
          `Context: track=${proposal.routing.fields.track.value || "unresolved"}, module=${proposal.routing.fields.module.value || "unresolved"}, project=${proposal.routing.fields.projectId.value || "none"}`,
        );
      }
      console.log(`Review: ${proposal.reviewReasons.join(", ") || "not required"}`);
      console.log(`Candidates: ${proposal.duplicateCandidates.length}`);
      for (const candidate of proposal.duplicateCandidates) {
        console.log(`  ${candidate.path} (${candidate.matchReason}, score=${candidate.score})`);
      }
    }
    return 0;
  }

  if (command === "apply") {
    const proposalId = requireProposalId(options, "apply");
    const actionValue = options.values.get("action");
    if (!actionValue) {
      throw new Error(
        "Capture apply requires --action <create|append|replace|delete|open-question>.",
      );
    }
    const action = normalizeAction(actionValue);
    const result = await applyCaptureProposalAndRefresh({
      repoRoot,
      workspace,
      proposalId,
      action,
      dryRun,
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${dryRun ? "Would apply" : "Applied"} ${result.proposalId}`);
      console.log(`Action: ${result.action}`);
      console.log(`Target: ${result.path}`);
      console.log(`Content hash: ${result.contentHash}`);
    }
    return 0;
  }

  if (command === "reject") {
    const proposalId = requireProposalId(options, "reject");
    const result = await rejectCaptureProposal(repoRoot, proposalId, dryRun, workspace);
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${dryRun ? "Would reject" : "Rejected"} ${result.proposalId}`);
    return 0;
  }

  throw new Error(`Unknown capture command: ${command}`);
}

function parseCaptureArgs(argv: string[]): CaptureCliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  const booleanFlags = new Set(["json", "dry-run"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (booleanFlags.has(name)) {
      flags.add(name);
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    values.set(name, value);
  }
  return { values, flags, positionals };
}

function requireProposalId(options: CaptureCliOptions, command: string): string {
  const proposalId = options.positionals[0];
  if (!proposalId) throw new Error(`Usage: gke capture ${command} <proposal-id>`);
  return proposalId;
}

function normalizeAction(value: string): CaptureAction {
  const normalized = value.replace("-", "_") as CaptureAction;
  if (!["create", "append", "replace", "delete", "open_question"].includes(normalized)) {
    throw new Error(`Invalid capture action: ${value}`);
  }
  return normalized;
}

function assertKnownCaptureOptions(command: string | undefined, options: CaptureCliOptions): void {
  const known = new Set(["repo-root", ...(command === "apply" ? ["action"] : [])]);
  for (const option of options.values.keys()) {
    if (!known.has(option)) throw new Error(`Unknown option for capture ${command}: --${option}`);
  }
}

function printCaptureHelp(): void {
  console.log(`GKE capture proposal review

Usage:
  gke capture list [--json]
  gke capture show <proposal-id> [--json]
  gke capture apply <proposal-id> [--action <create|append|replace|delete|open-question>] [--dry-run] [--json]
  gke capture reject <proposal-id> [--dry-run] [--json]

Global options:
  --repo-root <path>`);
}
