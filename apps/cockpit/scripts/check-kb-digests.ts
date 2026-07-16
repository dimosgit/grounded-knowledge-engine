import fs from "node:fs/promises";
import path from "node:path";
import { getPaths } from "./sync-lib.js";

const { repoRoot } = getPaths();
const digestsDir = path.join(repoRoot, "kb", "digests");
const digestFilePattern = /^\d{4}-\d{2}\.md$/;

const requiredSections = [
  "Week at a glance",
  "Outcomes you can reuse",
  "Decisions to remember",
  "Weekly Consolidation",
  "Next session starting point",
  "Fast links",
];

interface OutcomeBlock {
  title: string;
  body: string;
}

function quoteList(list: string[]): string {
  return list.map((item) => `- ${item}`).join("\n");
}

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function collectSections(markdown: string): Map<string, string> {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  const sections = new Map<string, string>();

  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index][1].trim();
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    sections.set(heading, markdown.slice(start, end));
  }

  return sections;
}

function countBullets(markdown: string): number {
  return (markdown.match(/^\s*-\s+/gm) || []).length;
}

function withoutQuickRecall(markdown: string): string {
  const sections = collectSections(markdown);
  const quickRecall = sections.get("Quick recall");
  if (!quickRecall) return markdown;

  return markdown.replace(/^##\s+Quick recall\s*$[\s\S]*?(?=^##\s+)/im, "");
}

function extractOutcomeBlocks(markdown: string): OutcomeBlock[] {
  const matches = [...markdown.matchAll(/^###\s+(.+)$/gm)];
  const blocks: OutcomeBlock[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const title = matches[index][1].trim();
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    blocks.push({ title, body: markdown.slice(start, end) });
  }

  return blocks;
}

function validateDigest(
  raw: string,
  fileName: string,
  failures: string[],
  warnings: string[],
): void {
  const fileStem = fileName.replace(/\.md$/i, "");
  const h1 = raw.match(/^#\s+Weekly Digest\s+\(([^)]+)\)\s*$/m);
  const expectedDigestId = fileStem.replace(/^(\d{4})-(\d{2})$/, "$1-W$2");

  if (!h1) {
    failures.push(`${fileName}: missing H1 '# Weekly Digest (YYYY-WW)'`);
  } else if (h1[1] !== expectedDigestId) {
    failures.push(
      `${fileName}: H1 digest id ${h1[1]} does not match filename (${expectedDigestId})`,
    );
  }

  const sections = collectSections(raw);
  for (const heading of requiredSections) {
    if (!sections.has(heading)) {
      failures.push(`${fileName}: missing required section '## ${heading}'`);
    }
  }

  const digestBody = withoutQuickRecall(raw);
  const lineCount = digestBody.split(/\r?\n/).length;
  if (lineCount > 120) {
    warnings.push(`${fileName}: ${lineCount} lines (recommended <= 120)`);
  }

  const totalBullets = countBullets(digestBody);
  if (totalBullets > 40) {
    warnings.push(`${fileName}: ${totalBullets} bullets (recommended <= 40)`);
  }

  const weekAtGlance = sections.get("Week at a glance");
  if (weekAtGlance) {
    const bullets = countBullets(weekAtGlance);
    if (bullets > 5) {
      warnings.push(`${fileName}: 'Week at a glance' has ${bullets} bullets (recommended <= 5)`);
    }
  }

  const outcomesSection = sections.get("Outcomes you can reuse");
  if (outcomesSection) {
    const blocks = extractOutcomeBlocks(outcomesSection);
    if (blocks.length < 2 || blocks.length > 6) {
      warnings.push(`${fileName}: outcomes count is ${blocks.length} (recommended 2-6)`);
    }

    for (const block of blocks) {
      if (!/^\s*-\s+What changed:/m.test(block.body)) {
        failures.push(`${fileName}: outcome '${block.title}' is missing '- What changed:'`);
      }
      if (!/^\s*-\s+Why it matters:/m.test(block.body)) {
        failures.push(`${fileName}: outcome '${block.title}' is missing '- Why it matters:'`);
      }
      if (!/^\s*-\s+Go back to:/m.test(block.body)) {
        failures.push(`${fileName}: outcome '${block.title}' is missing '- Go back to:'`);
      }
      const links = (block.body.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
      if (links < 1) {
        warnings.push(`${fileName}: outcome '${block.title}' has no markdown links`);
      }
    }
  }

  const decisionsSection = sections.get("Decisions to remember");
  if (decisionsSection) {
    const tableRows = (decisionsSection.match(/^\|.+\|\s*$/gm) || []).length;
    if (tableRows < 3) {
      failures.push(
        `${fileName}: 'Decisions to remember' must include a markdown table with at least one decision row`,
      );
    }
  }

  const nextSection = sections.get("Next session starting point");
  if (nextSection) {
    const bullets = countBullets(nextSection);
    if (bullets > 3) {
      warnings.push(
        `${fileName}: 'Next session starting point' has ${bullets} bullets (recommended <= 3)`,
      );
    }
  }

  const linksSection = sections.get("Fast links");
  if (linksSection) {
    const links = (linksSection.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
    if (links < 3) {
      failures.push(`${fileName}: 'Fast links' should contain at least 3 links`);
    }
    if (links > 12) {
      warnings.push(`${fileName}: 'Fast links' has ${links} links (recommended <= 12)`);
    }
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(digestsDir, { withFileTypes: true });
  } catch {
    console.log("Digest folder absent (kb/digests) — digest checks skipped for this workspace.");
    return;
  }
  const digestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .filter((name) => name !== "TEMPLATE.md");

  for (const fileName of digestFiles) {
    if (!digestFilePattern.test(fileName)) {
      failures.push(`Digest filename must match YYYY-WW.md: ${fileName}`);
      continue;
    }
    const raw = await readUtf8(path.join(digestsDir, fileName));
    validateDigest(raw, fileName, failures, warnings);
  }

  if (warnings.length) {
    console.log("Warnings:");
    console.log(quoteList(warnings));
  }

  if (failures.length) {
    console.error("Digest check failed:");
    console.error(quoteList(failures));
    process.exit(1);
  }

  console.log(`Digest check passed for ${digestFiles.length} files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
