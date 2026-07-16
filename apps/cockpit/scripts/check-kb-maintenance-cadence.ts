import fs from "node:fs/promises";
import path from "node:path";
import { getPaths } from "./sync-lib.js";

type Frontmatter = Record<string, string>;

interface ParsedDoc {
  fm: Frontmatter;
  body: string;
}

interface OwnershipFile {
  owners?: Record<string, string>;
}

const { repoRoot } = getPaths();
const topicsDir = path.join(repoRoot, "kb", "topics");
const modulesDir = path.join(repoRoot, "kb", "modules");
const openQuestionsPath = path.join(repoRoot, "kb", "open_questions.md");
const ownershipPath = path.join(modulesDir, "topic-ownership.json");

const mergedStaleDays = 60;
const openQuestionStaleDays = 30;
const minimumTopicsPerModule = 2;
const today = new Date();

function quoteList(list: string[]): string {
  return list.map((item) => `- ${item}`).join("\n");
}

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function parseFrontmatter(raw: string): ParsedDoc {
  if (!raw.startsWith("---\n")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, body: raw };

  const header = raw.slice(4, end).trim();
  const body = raw.slice(end + 5);
  const fm: Frontmatter = {};
  for (const line of header.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;
    fm[key] = value;
  }
  return { fm, body };
}

function parseISODate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(date: Date): number {
  return Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

async function getTopicFiles(): Promise<string[]> {
  const entries = await fs.readdir(topicsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

async function checkMergedStubCadence(topicFiles: string[], warnings: string[]): Promise<void> {
  for (const topicFile of topicFiles) {
    const raw = await readUtf8(path.join(topicsDir, topicFile));
    const { fm, body } = parseFrontmatter(raw);
    if (fm.status !== "merged") continue;
    const looksLikeStub =
      /was merged into the canonical/i.test(body) || /\(Merged Note\)/i.test(body);
    if (!looksLikeStub) continue;

    const updatedDate = parseISODate(fm.updated);
    if (!updatedDate) {
      warnings.push(
        `Merged stub ${topicFile} is missing a parseable updated date for cadence tracking.`,
      );
      continue;
    }

    const age = daysSince(updatedDate);
    if (age > mergedStaleDays) {
      warnings.push(
        `Merged stub ${topicFile} is ${age} days old (threshold ${mergedStaleDays}); consider archive cleanup.`,
      );
    }
  }
}

async function checkOpenQuestionsCadence(warnings: string[]): Promise<void> {
  let raw: string;
  try {
    raw = await readUtf8(openQuestionsPath);
  } catch {
    // Workspaces without an open-questions log have nothing to triage.
    return;
  }
  const hasAnyOpenQuestion = /status:\s*open/im.test(raw);
  const markerMatch = raw.match(/last review:\s*(\d{4}-\d{2}-\d{2})/i);

  if (!hasAnyOpenQuestion) return;
  if (!markerMatch) {
    warnings.push(`open_questions.md has open questions but no 'last review: YYYY-MM-DD' marker.`);
    return;
  }

  const reviewDate = parseISODate(markerMatch[1]);
  if (!reviewDate) {
    warnings.push(`open_questions.md has an invalid last review marker: ${markerMatch[1]}`);
    return;
  }

  const age = daysSince(reviewDate);
  if (age > openQuestionStaleDays) {
    warnings.push(
      `open_questions.md last review is ${age} days old (threshold ${openQuestionStaleDays}); refresh triage notes.`,
    );
  }
}

async function checkModuleCoverage(warnings: string[]): Promise<void> {
  let ownershipRaw: string;
  try {
    ownershipRaw = await readUtf8(ownershipPath);
  } catch {
    // No ownership map — coverage is governed only in workspaces that opt in.
    return;
  }
  const ownership: OwnershipFile = JSON.parse(ownershipRaw);
  const owners = ownership.owners || {};

  const topicCountByModule = new Map<string, number>();
  for (const moduleName of Object.values(owners)) {
    topicCountByModule.set(moduleName, (topicCountByModule.get(moduleName) || 0) + 1);
  }

  const moduleEntries = await fs.readdir(modulesDir, { withFileTypes: true });
  const moduleKeys = moduleEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => entry.name.replace(/\.md$/i, ""))
    .sort();

  for (const moduleKey of moduleKeys) {
    const count = topicCountByModule.get(moduleKey) || 0;
    if (count < minimumTopicsPerModule) {
      warnings.push(
        `Module ${moduleKey} has sparse topic coverage (${count} topics; threshold ${minimumTopicsPerModule}).`,
      );
    }
  }
}

async function main(): Promise<void> {
  const warnings: string[] = [];
  let topicFiles: string[];
  try {
    topicFiles = await getTopicFiles();
  } catch {
    console.log(
      "Topics folder absent (kb/topics) — maintenance cadence checks skipped for this workspace.",
    );
    return;
  }

  await checkMergedStubCadence(topicFiles, warnings);
  await checkOpenQuestionsCadence(warnings);
  await checkModuleCoverage(warnings);

  if (warnings.length) {
    console.log("Warnings:");
    console.log(quoteList(warnings));
  }

  console.log(`Maintenance cadence check complete for ${topicFiles.length} topics.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
