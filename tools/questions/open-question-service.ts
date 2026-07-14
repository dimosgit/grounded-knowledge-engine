import crypto from "node:crypto";
import path from "node:path";
import {
  OPEN_QUESTIONS_PATH,
  OpenQuestionRepository,
  type OpenQuestionDocument,
} from "./open-question-repository.js";
import type {
  NormalizedOpenQuestionInput,
  OpenQuestionMutationInput,
  OpenQuestionMutationResult,
  OpenQuestionServiceOptions,
  OpenQuestionStatus,
  ParsedOpenQuestionEntry,
} from "./types.js";

const VALID_STATUSES = new Set<OpenQuestionStatus>(["open", "resolved"]);

export async function mutateOpenQuestion(
  input: OpenQuestionMutationInput,
  options: OpenQuestionServiceOptions,
): Promise<OpenQuestionMutationResult> {
  try {
    return await mutateOpenQuestionValue(input, options);
  } catch (error) {
    throw new Error(safeServiceError(error, options));
  }
}

async function mutateOpenQuestionValue(
  input: OpenQuestionMutationInput,
  options: OpenQuestionServiceOptions,
): Promise<OpenQuestionMutationResult> {
  const normalized = normalizeOpenQuestionInput(input);
  const repository = new OpenQuestionRepository(path.resolve(options.repoRoot), options.workspace);
  if (normalized.dryRun) {
    return planMutation(await repository.read(), normalized, options.now?.() ?? new Date()).result;
  }
  if (!options.writesEnabled) {
    throw new Error("Open-question mutation is disabled by the active write gate.");
  }

  const planned = await repository.withMutationLock(async () => {
    const mutation = planMutation(
      await repository.read(),
      normalized,
      options.now?.() ?? new Date(),
    );
    if (mutation.result.action !== "unchanged") {
      await repository.writeAtomic(mutation.nextContent);
    }
    return mutation.result;
  });
  if (planned.action !== "unchanged" && options.refresh) await options.refresh();
  return planned;
}

function safeServiceError(error: unknown, options: OpenQuestionServiceOptions): string {
  let message = error instanceof Error ? error.message : `${error || "Unknown error"}`;
  const roots = new Set([
    path.resolve(options.repoRoot),
    options.workspace.repoRoot,
    options.workspace.realRepoRoot,
  ]);
  for (const root of roots) {
    if (root) message = message.replaceAll(root, "<workspace>");
  }
  return message;
}

export function normalizeOpenQuestionInput(
  input: OpenQuestionMutationInput,
): NormalizedOpenQuestionInput {
  const question = requiredSingleLine(input.question, "question");
  const whyOpen = requiredSingleLine(input.whyOpen, "whyOpen");
  const whatWouldResolve = requiredSingleLine(input.whatWouldResolve, "whatWouldResolve");
  const status = singleLine(input.status || "open").toLowerCase() as OpenQuestionStatus;
  if (!VALID_STATUSES.has(status)) {
    throw new Error("Invalid open-question status. Expected open or resolved.");
  }
  return {
    question,
    normalizedQuestion: normalizeQuestion(question),
    whyOpen,
    whatWouldResolve,
    status,
    resolvedBy: singleLine(input.resolvedBy),
    relatedPath: normalizeRelatedPath(input.relatedPath),
    owner: singleLine(input.owner),
    source: singleLine(input.source),
    dryRun: Boolean(input.dryRun),
  };
}

export function parseOpenQuestionEntries(content: string): ParsedOpenQuestionEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: ParsedOpenQuestionEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*-\s+question:\s*(.+?)\s*$/i);
    if (!match) continue;
    const question = singleLine(match[1]);
    let status: OpenQuestionStatus | null = null;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*-\s+question:/i.test(lines[cursor])) break;
      const statusMatch = lines[cursor].match(/^\s+status:\s*(open|resolved)\s*$/i);
      if (statusMatch) status = statusMatch[1].toLowerCase() as OpenQuestionStatus;
    }
    const normalizedQuestion = normalizeQuestion(question);
    entries.push({
      entryId: buildEntryId(normalizedQuestion),
      question,
      normalizedQuestion,
      status,
      line: index + 1,
    });
  }
  return entries;
}

function planMutation(
  document: OpenQuestionDocument,
  input: NormalizedOpenQuestionInput,
  now: Date,
): { result: OpenQuestionMutationResult; nextContent: string } {
  const existing = parseOpenQuestionEntries(document.content).find(
    (entry) => entry.normalizedQuestion === input.normalizedQuestion,
  );
  if (existing) {
    return {
      result: {
        action: "unchanged",
        entryId: existing.entryId,
        dryRun: input.dryRun,
        path: OPEN_QUESTIONS_PATH,
        status: existing.status || input.status,
        question: existing.question,
        existing: true,
      },
      nextContent: document.content,
    };
  }

  const base = normalizeDocument(document.content);
  const entry = renderEntry(input, now);
  return {
    result: {
      action: document.exists ? "appended" : "created",
      entryId: buildEntryId(input.normalizedQuestion),
      dryRun: input.dryRun,
      path: OPEN_QUESTIONS_PATH,
      status: input.status,
      question: input.question,
      existing: false,
    },
    nextContent: `${base.trimEnd()}\n\n${entry}\n`,
  };
}

function normalizeDocument(content: string): string {
  const normalized = content.trim();
  if (!normalized) return "# Open Questions";
  if (!/^# Open Questions\s*$/m.test(normalized)) {
    throw new Error("Open-question document is missing the expected heading.");
  }
  return normalized;
}

function renderEntry(input: NormalizedOpenQuestionInput, now: Date): string {
  const lines = [
    `- question: ${input.question}`,
    `  why it's open: ${input.whyOpen}`,
    `  what would resolve it: ${input.whatWouldResolve}`,
    `  status: ${input.status}`,
  ];
  if (input.resolvedBy) lines.push(`  resolved by: ${input.resolvedBy}`);
  if (input.relatedPath) lines.push(`  related: ${formatRelatedPath(input.relatedPath)}`);
  if (input.owner) lines.push(`  owner: ${input.owner}`);
  if (input.source) lines.push(`  source: ${input.source}`);
  lines.push(`  added: ${now.toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

function normalizeQuestion(value: string): string {
  return singleLine(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function buildEntryId(normalizedQuestion: string): string {
  return `open-question-${crypto.createHash("sha256").update(normalizedQuestion).digest("hex").slice(0, 16)}`;
}

function requiredSingleLine(value: unknown, field: string): string {
  const normalized = singleLine(value);
  if (!normalized) throw new Error(`Open question requires ${field}.`);
  return normalized;
}

function singleLine(value: unknown): string {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function normalizeRelatedPath(value: unknown): string {
  const raw = singleLine(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!raw) return "";
  if (path.posix.isAbsolute(raw) || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error("Related path must be workspace-relative.");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Related path traversal is not allowed.");
  }
  return normalized;
}

function formatRelatedPath(relatedPath: string): string {
  if (!relatedPath.startsWith("kb/")) return relatedPath;
  return `[${relatedPath}](./${relatedPath.slice(3)})`;
}
