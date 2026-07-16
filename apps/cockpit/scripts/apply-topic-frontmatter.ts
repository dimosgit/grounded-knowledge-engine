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
  moduleTracks?: Record<string, string>;
}

const { repoRoot } = getPaths();
// Workspace-specific prefix vocabulary from topic-ownership.json's governance block.
let governance: { typePrefixes?: Record<string, string>; tagPrefixes?: Record<string, string> } =
  {};
const topicsDir = path.join(repoRoot, "kb", "topics");
const ownershipPath = path.join(repoRoot, "kb", "modules", "topic-ownership.json");
const today = new Date().toISOString().slice(0, 10);

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
    if (key) fm[key] = value;
  }
  return { fm, body };
}

function serializeFrontmatter(fm: Frontmatter): string {
  const ordered = ["module", "track", "status", "type", "owner", "updated", "tags"];
  const lines = ordered
    .filter((key) => fm[key] !== undefined && fm[key] !== "")
    .map((key) => `${key}: ${fm[key]}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function inferStatus(fileName: string, body: string): string {
  const title = body.match(/^#\s+(.+)$/m)?.[1] || "";
  if (/\(Merged Note\)/i.test(title) || /was merged into the canonical/i.test(body))
    return "merged";
  return "canonical";
}

function inferType(fileName: string, status: string): string {
  if (status === "merged") return "redirect";
  for (const [prefix, type] of Object.entries(governance.typePrefixes ?? {})) {
    if (fileName.startsWith(prefix)) return type;
  }
  if (
    /(guide|process|checklist|workflow|playbook|version-control|deletion|table-change|how-to|howto)/i.test(
      fileName,
    )
  ) {
    return "howto";
  }
  return "concept";
}

function inferUpdated(body: string): string {
  const m = body.match(/## Last updated\s*\n([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return m?.[1] || today;
}

function inferTags(fileName: string, moduleName: string, trackName: string): string {
  const base = fileName.replace(/\.md$/i, "");
  const parts = base.split("-").filter(Boolean);
  const tags = new Set<string>();
  if (trackName === "sap") tags.add("sap");
  if (trackName === "ai") tags.add("ai");
  if (trackName === "business-marketing") tags.add("business");
  if (trackName === "knowledge-ops") tags.add("knowledge-ops");
  if (base.startsWith("rap-")) tags.add("rap");
  if (base.startsWith("sap-")) tags.add("sap");
  for (const [prefix, tag] of Object.entries(governance.tagPrefixes ?? {})) {
    if (base.startsWith(prefix)) tags.add(tag);
  }
  if (parts.includes("workflow") || parts.includes("approval") || parts.includes("approvals"))
    tags.add("workflow");
  if (parts.includes("order") || parts.includes("so") || parts.includes("sales")) tags.add("sales");
  if (moduleName) tags.add(moduleName);
  return [...tags].join(", ");
}

async function main(): Promise<void> {
  const ownershipRaw = await fs.readFile(ownershipPath, "utf8");
  const ownership: OwnershipFile = JSON.parse(ownershipRaw);
  governance =
    (
      ownership as {
        governance?: {
          typePrefixes?: Record<string, string>;
          tagPrefixes?: Record<string, string>;
        };
      }
    ).governance ?? {};
  const owners = ownership.owners || {};
  const moduleTracks = ownership.moduleTracks || {};

  const entries = await fs.readdir(topicsDir, { withFileTypes: true });
  const topicFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  let changed = 0;

  for (const fileName of topicFiles) {
    const topicPath = path.join(topicsDir, fileName);
    const raw = await fs.readFile(topicPath, "utf8");
    const { fm: existing, body } = parseFrontmatter(raw);

    const moduleName = owners[fileName] || existing.module || "unassigned";
    const track = existing.track || moduleTracks[moduleName] || "sap";
    const status = existing.status || inferStatus(fileName, body);
    const type = existing.type || inferType(fileName, status);
    const updated = existing.updated || inferUpdated(body);
    const owner = existing.owner || "kb-curator";
    const tags = existing.tags || inferTags(fileName, moduleName, track);

    const nextFm: Frontmatter = {
      module: moduleName,
      track,
      status,
      type,
      owner,
      updated,
      tags,
    };

    const nextRaw = `${serializeFrontmatter(nextFm)}${body.trimStart()}`;
    if (nextRaw !== raw) {
      await fs.writeFile(topicPath, nextRaw, "utf8");
      changed += 1;
    }
  }

  console.log(`Applied/updated frontmatter for ${changed} topic files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
