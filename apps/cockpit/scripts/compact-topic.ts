import fs from "node:fs";
import path from "node:path";

type Args = Record<string, string>;

interface SplitDoc {
  frontmatter: string;
  body: string;
}

interface Section {
  title: string;
  chunk: string;
}

interface Sectionized {
  preamble: string;
  sections: Section[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = val;
  }
  return out;
}

function splitFrontmatter(src: string): SplitDoc {
  if (!src.startsWith("---\n")) return { frontmatter: "", body: src };
  const end = src.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: src };
  return {
    frontmatter: src.slice(0, end + 5),
    body: src.slice(end + 5),
  };
}

function sectionize(body: string): Sectionized {
  const lines = body.split(/\r?\n/);
  const h2: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) h2.push(i);
  }
  if (h2.length === 0) {
    return { preamble: body.trimEnd() + "\n", sections: [] };
  }

  const preamble = lines.slice(0, h2[0]).join("\n").trimEnd() + "\n\n";
  const sections: Section[] = [];
  for (let i = 0; i < h2.length; i += 1) {
    const start = h2[i];
    const end = i + 1 < h2.length ? h2[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join("\n").trimEnd() + "\n";
    const title = lines[start].replace(/^##\s+/, "").trim();
    sections.push({ title, chunk });
  }
  return { preamble, sections };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const args = parseArgs(process.argv.slice(2));
const file = args.file;
if (!file) {
  console.error("Missing required --file");
  process.exit(1);
}

const absFile = path.resolve(file);
if (!fs.existsSync(absFile)) {
  console.error(`File not found: ${absFile}`);
  process.exit(1);
}

const keepRaw = args.keep || "";
const keepMatchers = keepRaw
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => new RegExp(s, "i"));

if (keepMatchers.length === 0) {
  console.error("Provide keep-section patterns via --keep with | separators.");
  process.exit(1);
}

const archiveDir = path.resolve(
  args["archive-dir"] || path.join(path.dirname(absFile), "..", "archive"),
);
const reason = args.reason || "Archived sections removed from active note during compaction.";

const raw = fs.readFileSync(absFile, "utf8");
const { frontmatter, body } = splitFrontmatter(raw);
const { preamble, sections } = sectionize(body);

const kept: Section[] = [];
const dropped: Section[] = [];
for (const sec of sections) {
  if (keepMatchers.some((rx) => rx.test(sec.title))) kept.push(sec);
  else dropped.push(sec);
}

if (dropped.length === 0) {
  console.log("No sections dropped. Nothing to archive.");
  process.exit(0);
}

fs.mkdirSync(archiveDir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const base = slug(path.basename(absFile, path.extname(absFile)));
let archiveName = `${base}-archive-${day}.md`;
let idx = 2;
while (fs.existsSync(path.join(archiveDir, archiveName))) {
  archiveName = `${base}-archive-${day}-${idx}.md`;
  idx += 1;
}
const archivePath = path.join(archiveDir, archiveName);

const sourceRelFromArchive = path.relative(path.dirname(archivePath), absFile).replace(/\\/g, "/");
const archiveSections = dropped.map((s) => s.chunk).join("\n");
const archiveDoc = [
  `# Archive: ${path.basename(absFile)}`,
  "",
  `- Source: \`${sourceRelFromArchive}\``,
  `- Created: ${day}`,
  `- Reason: ${reason}`,
  "",
  "## Archived Sections",
  "",
  archiveSections.trimEnd(),
  "",
].join("\n");
fs.writeFileSync(archivePath, archiveDoc, "utf8");

let fm = frontmatter;
if (fm && /^updated:\s*\d{4}-\d{2}-\d{2}$/m.test(fm)) {
  fm = fm.replace(/^updated:\s*\d{4}-\d{2}-\d{2}$/m, `updated: ${day}`);
}

const relArchiveFromTopic = path.relative(path.dirname(absFile), archivePath).replace(/\\/g, "/");
const existingArchiveRefs: string[] = [];
const keptWithoutArchiveRefs: Section[] = [];
for (const sec of kept) {
  if (/^archive references$/i.test(sec.title)) {
    const lines = sec.chunk.split(/\r?\n/).slice(1);
    for (const line of lines) {
      const cleaned = line.trim();
      if (/^- /.test(cleaned)) existingArchiveRefs.push(cleaned);
    }
    continue;
  }
  keptWithoutArchiveRefs.push(sec);
}

const newArchiveRef = `- ${day}: [${archiveName}](${relArchiveFromTopic}) - ${reason}`;
const mergedArchiveRefs: string[] = [];
for (const line of [...existingArchiveRefs, newArchiveRef]) {
  if (!mergedArchiveRefs.includes(line)) mergedArchiveRefs.push(line);
}

const outBody = [
  preamble.trimEnd(),
  "",
  ...keptWithoutArchiveRefs.map((s) => s.chunk.trimEnd()),
  "",
  "## Archive references",
  ...mergedArchiveRefs,
  "",
].join("\n");

const out = `${fm}${outBody.endsWith("\n") ? outBody : `${outBody}\n`}`;
fs.writeFileSync(absFile, out, "utf8");

console.log(`Compacted: ${absFile}`);
console.log(`Archived sections: ${dropped.length}`);
console.log(`Archive file: ${archivePath}`);
