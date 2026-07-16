import fs from "node:fs/promises";
import path from "node:path";
import { getPaths } from "./sync-lib.js";

type Frontmatter = Record<string, string>;

interface TopicDoc {
  raw: string;
  body: string;
  fm: Frontmatter;
}

interface OwnershipFile {
  tracks?: Record<string, unknown>;
  owners?: Record<string, string>;
  moduleTracks?: Record<string, string>;
}

const { repoRoot } = getPaths();
const modulesDir = path.join(repoRoot, "kb", "modules");
const topicsDir = path.join(repoRoot, "kb", "topics");
const kbIndexPath = path.join(repoRoot, "kb", "index.md");
const ownershipPath = path.join(modulesDir, "topic-ownership.json");
const requiredFrontmatter = ["module", "track", "status", "type", "owner", "updated", "tags"];
const allowedStatus = new Set(["draft", "canonical", "merged", "deprecated"]);
const allowedType = new Set(["concept", "howto", "project", "redirect", "history"]);
const softMaxTopicLines = 350;
const minTokenSetForSimilarity = 80;
const duplicateSimilarityThreshold = 0.82;
// Workspace-specific taxonomy vocabulary comes from the optional `governance`
// block of topic-ownership.json; without it these checks stay silent.
interface GovernanceConfig {
  namingPrefixes?: string[];
  namingLegacyAllowlist?: string[];
  changeLogTopics?: string[];
  trackPrefixes?: Record<string, string>;
}
let governance: GovernanceConfig = {};
const requiredProjectSections = ["Current status", "Next 3 actions", "Blockers"];
const projectSectionPattern = /^(##+)\s+(.+)$/gm;
const projectRunningNotesPattern =
  /^##\s*(Current (implementation )?status snapshot|Current focus|Task\s+\d+)/im;

function quoteList(list: string[]): string {
  return list.map((item) => `- ${item}`).join("\n");
}

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function getTopicFiles(): Promise<string[]> {
  const entries = await fs.readdir(topicsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
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

async function getTopicDocs(topicFiles: string[]): Promise<Map<string, TopicDoc>> {
  const map = new Map<string, TopicDoc>();
  for (const topic of topicFiles) {
    const raw = await readUtf8(path.join(topicsDir, topic));
    const { fm, body } = parseFrontmatter(raw);
    map.set(topic, { raw, body, fm });
  }
  return map;
}

function isMergedTopic(doc: TopicDoc | undefined): boolean {
  if (!doc) return false;
  if (doc.fm?.status === "merged") return true;
  const titleLine = doc.body.match(/^#\s+(.+)$/m)?.[1] || "";
  return /\(Merged Note\)/i.test(titleLine) || /was merged into the canonical/i.test(doc.body);
}

function validateFrontmatter(
  topic: string,
  ownerModule: string,
  ownerTrack: string,
  doc: TopicDoc | undefined,
  failures: string[],
  warnings: string[],
  allowedTracks: Set<string>,
): void {
  const fm = doc?.fm || {};

  for (const field of requiredFrontmatter) {
    if (!fm[field]) {
      failures.push(`Topic ${topic} is missing frontmatter field: ${field}`);
    }
  }

  if (fm.module && fm.module !== ownerModule) {
    failures.push(
      `Topic ${topic} frontmatter module (${fm.module}) does not match ownership map (${ownerModule})`,
    );
  }

  if (fm.track && !allowedTracks.has(fm.track)) {
    failures.push(`Topic ${topic} has invalid frontmatter track: ${fm.track}`);
  }

  if (fm.track && ownerTrack && fm.track !== ownerTrack) {
    failures.push(
      `Topic ${topic} frontmatter track (${fm.track}) does not match owner module track (${ownerTrack})`,
    );
  }

  if (fm.status && !allowedStatus.has(fm.status)) {
    failures.push(`Topic ${topic} has invalid frontmatter status: ${fm.status}`);
  }

  if (fm.type && !allowedType.has(fm.type)) {
    failures.push(`Topic ${topic} has invalid frontmatter type: ${fm.type}`);
  }

  if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated)) {
    failures.push(`Topic ${topic} has invalid frontmatter updated value: ${fm.updated}`);
  }

  if (fm.status === "merged" && fm.type && fm.type !== "redirect") {
    warnings.push(`Topic ${topic} is merged but type is ${fm.type} (expected redirect)`);
  }

  for (const [prefix, expectedTrack] of Object.entries(governance.trackPrefixes ?? {})) {
    if (topic.startsWith(prefix) && fm.track && fm.track !== expectedTrack) {
      failures.push(
        `Topic ${topic} uses ${prefix}* filename prefix but track is ${fm.track}; rename or move to the ${expectedTrack} track.`,
      );
    }
  }
}

function hasExpectedTaxonomyPrefix(topic: string): boolean {
  const prefixes = governance.namingPrefixes ?? [];
  if (!prefixes.length) return true;
  if ((governance.namingLegacyAllowlist ?? []).includes(topic)) return true;
  return prefixes.some((prefix) => topic.startsWith(prefix));
}

function collectH2Sections(body: string): string[] {
  const sections: string[] = [];
  for (const match of body.matchAll(projectSectionPattern)) {
    if (match[1] === "##") {
      sections.push(match[2].trim().toLowerCase());
    }
  }
  return sections;
}

function validateStructureWarnings(
  topic: string,
  doc: TopicDoc | undefined,
  warnings: string[],
): void {
  const type = doc?.fm?.type;
  const body = doc?.body || "";
  if (!type) return;

  if (type === "concept" && projectRunningNotesPattern.test(body)) {
    warnings.push(
      `Topic ${topic} is type concept but includes project-running-note sections; consider splitting or retyping.`,
    );
  }

  if (type === "project") {
    const availableSections = new Set(collectH2Sections(body));
    for (const requiredSection of requiredProjectSections) {
      if (!availableSections.has(requiredSection.toLowerCase())) {
        warnings.push(`Topic ${topic} is type project but missing section: ## ${requiredSection}`);
      }
    }
  }

  if ((governance.changeLogTopics ?? []).includes(topic) && !/^##\s+Change log\b/im.test(body)) {
    warnings.push(`Topic ${topic} is canonical/high-traffic and is missing section: ## Change log`);
  }
}

function topicLineCount(body: string): number {
  return body.split(/\r?\n/).length;
}

function tokenizeForSimilarity(body: string): Set<string> {
  const cleaned = body
    .toLowerCase()
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter(
      (token) =>
        ![
          "this",
          "that",
          "with",
          "from",
          "into",
          "have",
          "your",
          "what",
          "when",
          "where",
          "will",
          "were",
        ].includes(token),
    );
  return new Set(tokens);
}

function similarity(setA: Set<string>, setB: Set<string>): number {
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  for (const value of setA) {
    if (setB.has(value)) overlap += 1;
  }
  return overlap / Math.min(setA.size, setB.size);
}

async function getModuleDocs(): Promise<Map<string, string>> {
  const entries = await fs.readdir(modulesDir, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith(".md") && entry.name !== "index.md",
    )
    .map((entry) => entry.name)
    .sort();
  const docs = new Map<string, string>();
  for (const file of files) {
    docs.set(file, await readUtf8(path.join(modulesDir, file)));
  }
  return docs;
}

function moduleFilename(moduleKey: string): string {
  return `${moduleKey}.md`;
}

function hasTopicLink(markdown: string, topicFile: string, scope: "module" | "index"): boolean {
  const needle = scope === "module" ? `(../topics/${topicFile})` : `(./topics/${topicFile})`;
  return markdown.includes(needle);
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];

  const requireOwnership = process.argv.includes("--require-ownership");
  if (!(await exists(ownershipPath)) || !(await exists(topicsDir))) {
    if (requireOwnership) {
      console.error(
        `Ownership check failed: required governance inputs are missing (${ownershipPath}).`,
      );
      process.exit(1);
    }
    console.log(
      "Ownership file absent (kb/modules/topic-ownership.json) — ownership checks skipped for this workspace.",
    );
    return;
  }

  const topics = await getTopicFiles();
  const ownershipRaw = await readUtf8(ownershipPath);
  const ownership: OwnershipFile = JSON.parse(ownershipRaw);
  governance = (ownership as { governance?: GovernanceConfig }).governance ?? {};
  const tracks = ownership.tracks || {};
  const allowedTracks = new Set(Object.keys(tracks));
  const owners = ownership.owners || {};
  const moduleTracks = ownership.moduleTracks || {};

  const moduleDocs = await getModuleDocs();
  const kbIndex = await readUtf8(kbIndexPath);
  const topicDocs = await getTopicDocs(topics);

  const topicsSet = new Set(topics);
  const ownerKeys = Object.keys(owners).sort();
  const moduleKeysFromDocs = new Set(
    [...moduleDocs.keys()].map((file) => file.replace(/\.md$/i, "")),
  );

  if (!allowedTracks.size) {
    failures.push("Ownership file is missing a non-empty tracks map.");
  }

  for (const moduleKey of moduleKeysFromDocs) {
    const track = moduleTracks[moduleKey];
    if (!track) {
      failures.push(
        `Module ${moduleKey} is missing track assignment in topic-ownership.json (moduleTracks).`,
      );
      continue;
    }
    if (!allowedTracks.has(track)) {
      failures.push(`Module ${moduleKey} has invalid track assignment: ${track}`);
    }
  }

  for (const [moduleKey, track] of Object.entries(moduleTracks)) {
    if (!moduleKeysFromDocs.has(moduleKey)) {
      failures.push(`moduleTracks references missing module file: ${moduleKey}.md`);
    }
    if (!allowedTracks.has(track)) {
      failures.push(`moduleTracks entry ${moduleKey} uses unknown track: ${track}`);
    }
  }

  for (const ownedTopic of ownerKeys) {
    if (!topicsSet.has(ownedTopic)) {
      failures.push(`Ownership map references missing topic file: ${ownedTopic}`);
    }
  }

  for (const topic of topics) {
    const owner = owners[topic];
    if (!owner) {
      failures.push(`No owner module assigned for topic: ${topic}`);
      continue;
    }
    const ownerTrack = moduleTracks[owner];
    if (!ownerTrack) {
      failures.push(
        `Owner module ${owner} for topic ${topic} has no track assignment in moduleTracks.`,
      );
      continue;
    }

    const moduleFile = moduleFilename(owner);
    const moduleMarkdown = moduleDocs.get(moduleFile);
    if (!moduleMarkdown) {
      failures.push(`Owner module does not exist for topic ${topic}: ${moduleFile}`);
      continue;
    }

    if (!hasTopicLink(moduleMarkdown, topic, "module")) {
      failures.push(`Owner module ${moduleFile} does not link topic ${topic}`);
    }

    validateFrontmatter(
      topic,
      owner,
      ownerTrack,
      topicDocs.get(topic),
      failures,
      warnings,
      allowedTracks,
    );
    validateStructureWarnings(topic, topicDocs.get(topic), warnings);

    if (!hasExpectedTaxonomyPrefix(topic)) {
      warnings.push(
        `Topic ${topic} does not follow preferred naming prefixes (${(governance.namingPrefixes ?? []).join(", ")}); legacy exception may be needed.`,
      );
    }

    const mergedTopic = isMergedTopic(topicDocs.get(topic));
    if (!mergedTopic && !hasTopicLink(kbIndex, topic, "index")) {
      failures.push(`KB index does not link topic ${topic}`);
    }
  }

  const canonicalTopics = topics.filter((topic) => topicDocs.get(topic)?.fm?.status !== "merged");
  const tokenMap = new Map<string, Set<string>>();
  for (const topic of canonicalTopics) {
    const doc = topicDocs.get(topic);
    const lines = topicLineCount(doc?.body || "");
    if (lines > softMaxTopicLines) {
      warnings.push(
        `Topic ${topic} has ${lines} lines (soft limit ${softMaxTopicLines}); consider splitting.`,
      );
    }
    tokenMap.set(topic, tokenizeForSimilarity(doc?.body || ""));
  }

  for (let i = 0; i < canonicalTopics.length; i += 1) {
    for (let j = i + 1; j < canonicalTopics.length; j += 1) {
      const left = canonicalTopics[i];
      const right = canonicalTopics[j];
      const leftTokens = tokenMap.get(left) ?? new Set<string>();
      const rightTokens = tokenMap.get(right) ?? new Set<string>();
      const minSize = Math.min(leftTokens.size, rightTokens.size);
      if (minSize < minTokenSetForSimilarity) continue;
      const score = similarity(leftTokens, rightTokens);
      if (score >= duplicateSimilarityThreshold) {
        warnings.push(
          `Potential duplicate pair: ${left} <-> ${right} (similarity ${score.toFixed(2)}). Consider canonical merge.`,
        );
      }
    }
  }

  for (const topic of topics) {
    const moduleHits: string[] = [];
    for (const [moduleFile, content] of moduleDocs.entries()) {
      if (hasTopicLink(content, topic, "module")) {
        moduleHits.push(moduleFile);
      }
    }
    if (moduleHits.length > 1) {
      warnings.push(`Topic ${topic} is cross-linked in multiple modules: ${moduleHits.join(", ")}`);
    }
  }

  if (warnings.length) {
    console.log("Warnings:");
    console.log(quoteList(warnings));
  }

  if (failures.length) {
    console.error("Ownership check failed:");
    console.error(quoteList(failures));
    process.exit(1);
  }

  console.log(`Ownership check passed for ${topics.length} topics.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
