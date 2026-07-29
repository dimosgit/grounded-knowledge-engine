const BODY_SEARCH_CHARACTER_LIMIT = 2_200;
const STRUCTURAL_CONTENT_LIMIT = 8_000;
const MAX_HEADINGS = 80;
const MAX_LINKS = 80;
const MAX_OPEN_QUESTIONS = 40;
const MAX_TASKS = 100;
const TRACK_LABELS: Record<string, string> = {
  demo: "Demo",
  ai: "AI",
  "business-marketing": "Business & Marketing",
  "knowledge-ops": "Knowledge Ops",
  data: "Data",
  "ai-tools": "AI Tools",
  product: "Product",
  finance: "Finance",
  communication: "Communication",
  general: "General",
};

const PROJECT_SECTION_NAMES = [
  "Outcome",
  "Current status",
  "Current focus",
  "Last meaningful change",
  "Active decisions",
  "Blockers",
  "Open questions",
  "Next actions",
  "Next 3 actions",
  "Key documents",
];

export interface CatalogSource {
  path: string;
  content: string;
}

export function buildCatalogEntries(sources: CatalogSource[]) {
  return sources
    .map(({ path, content }) => buildCatalogEntry(path, content))
    .filter((entry) => shouldIndexDoc(entry.path, entry.frontmatter))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function buildCatalogEntry(path: string, content: string) {
  const { body, frontmatter: parsedFrontmatter } = parseFrontmatter(content);
  const frontmatter = boundFrontmatter(parsedFrontmatter);
  const title = getTitle(path, body);
  const excerpt = getExcerpt(body);
  const docType = getDocType(path, title, body, frontmatter);
  const track = getTrackKey(path, frontmatter);
  const trackLabel = getTrackLabel(track, frontmatter);
  const headings = getHeadings(body);
  const metadataSearch = [
    title,
    path,
    trackLabel,
    excerpt,
    headings.join("\n"),
    JSON.stringify(frontmatter),
  ].join("\n");
  const boundedBodySearch = body.slice(0, BODY_SEARCH_CHARACTER_LIMIT);
  const rawSearch = buildSearchFields(metadataSearch);
  const normalizedSearch = buildSearchFields(`${metadataSearch}\n${boundedBodySearch}`);
  const projectCandidate = isProjectCandidate(path, body, frontmatter);

  return {
    path,
    section: getSection(path),
    tag: getTag(path),
    docType,
    learningItemType: getLearningItemType(docType),
    track,
    trackLabel,
    frontmatter,
    title,
    excerpt,
    headings,
    links: getSectionLinks(body).slice(0, MAX_LINKS),
    metrics: getDocMetrics(body),
    quickRecall: buildQuickRecall(body),
    digestQuickView: buildDigestQuickView(body),
    hubActions: getSectionBullets(getMarkdownSection(body, "Next 3 actions")).slice(0, 5),
    hubBlockers: getSectionBullets(getMarkdownSection(body, "Blockers")).slice(0, 5),
    openQuestionItems:
      path === "kb/open_questions.md" ? getSectionBullets(body).slice(0, MAX_OPEN_QUESTIONS) : [],
    structuralContent: projectCandidate ? buildProjectStructuralContent(body) : "",
    searchIndex: rawSearch.raw,
    searchIndexNormalized: normalizedSearch.normalized,
  };
}

function parseFrontmatter(raw: string): {
  body: string;
  frontmatter: Record<string, string>;
} {
  if (!raw.startsWith("---\n")) return { body: raw, frontmatter: {} };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { body: raw, frontmatter: {} };

  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(4, end).trim().split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    frontmatter[key] = line.slice(separator + 1).trim();
  }
  return { body: raw.slice(end + 5), frontmatter };
}

function boundFrontmatter(frontmatter: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(frontmatter)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 64)
      .map(([key, value]) => [key.slice(0, 120), `${value}`.slice(0, 500)]),
  );
}

function getHeadings(body: string): string[] {
  return [...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .slice(0, MAX_HEADINGS)
    .map((match) => match[1].trim().slice(0, 180));
}

function isProjectCandidate(
  path: string,
  body: string,
  frontmatter: Record<string, string>,
): boolean {
  if (frontmatter.record_type === "project" || frontmatter.type === "project") return true;
  if (/^kb\/projects\/[^/]+\/project\.md$/.test(path)) return true;
  return PROJECT_SECTION_NAMES.some((heading) =>
    new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(body),
  );
}

function buildProjectStructuralContent(body: string): string {
  const sections = PROJECT_SECTION_NAMES.flatMap((heading) => {
    const section = getMarkdownSection(body, heading).trim();
    if (!section) return [];
    return [`## ${heading}`, section.slice(0, 1_600)];
  });
  const tasks = body
    .split("\n")
    .filter((line) => /^\s*-\s+\[[ xX]\]\s+/.test(line))
    .slice(0, MAX_TASKS)
    .map((line) => line.slice(0, 500));

  if (tasks.length) sections.push("## Project task list", ...tasks);
  return sections.join("\n\n").slice(0, STRUCTURAL_CONTENT_LIMIT);
}

function shouldIndexDoc(path: string, frontmatter: Record<string, string>): boolean {
  if (frontmatter.template === "true") return false;
  return path !== "kb/digests/TEMPLATE.md";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPrettyLabel(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeScalar(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^['"]|['"]$/g, "") : "";
}

function getTitle(path: string, body: string): string {
  const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (firstHeading) return firstHeading;
  return toPrettyLabel(path.split("/").pop()?.replace(/\.md$/i, "") || path);
}

function getExcerpt(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find(
      (item) => item && !item.startsWith("#") && !item.startsWith("- ") && !item.startsWith("* "),
    );
  if (!line) return "No summary line found.";
  return line.length > 130 ? `${line.slice(0, 127)}...` : line;
}

function getTag(path: string): string {
  if (path.startsWith("kb/modules/")) return "modules";
  if (path.startsWith("kb/clients/")) return "clients";
  if (path.startsWith("kb/projects/")) return "projects";
  if (path.startsWith("kb/sources/")) return "sources";
  if (path.startsWith("kb/terms/")) return "terms";
  if (path.startsWith("kb/topics/")) return "topics";
  if (path.startsWith("kb/digests/")) return "digests";
  if (path === "readme.md") return "readme";
  if (path.startsWith("kb/")) return "kb";
  return "other";
}

function getSection(path: string): string {
  if (path.startsWith("kb/modules/")) return "kb/modules";
  if (path.startsWith("kb/clients/")) return "kb/clients";
  if (path.startsWith("kb/projects/")) return "kb/projects";
  if (path.startsWith("kb/sources/")) return "kb/sources";
  if (path.startsWith("kb/topics/")) return "kb/topics";
  if (path.startsWith("kb/terms/")) return "kb/terms";
  if (path.startsWith("kb/digests/")) return "kb/digests";
  return path.startsWith("kb/") ? "kb" : "root";
}

function getDocType(
  path: string,
  title: string,
  body: string,
  frontmatter: Record<string, string>,
): string {
  if (frontmatter.record_type === "project" || /^kb\/projects\/[^/]+\/project\.md$/.test(path)) {
    return "project";
  }
  if (frontmatter.record_type === "source" || path.startsWith("kb/sources/")) return "source";
  if (path.startsWith("kb/modules/")) return "module";
  if (path.startsWith("kb/clients/")) return "client";
  if (path.startsWith("kb/topics/")) {
    if (frontmatter.status === "merged") return "merged";
    if (frontmatter.status === "canonical") return "canonical";
    if (/\(Merged Note\)/i.test(title) || /was merged into the canonical/i.test(body)) {
      return "merged";
    }
    return "canonical";
  }
  if (path.startsWith("kb/terms/")) return "term";
  if (path.startsWith("kb/digests/")) return "digest";
  return "reference";
}

function getLearningItemType(docType: string): string {
  if (docType === "module" || docType === "client") return "module";
  if (docType === "canonical") return "canonical";
  if (docType === "term") return "concept";
  if (docType === "digest") return "review";
  if (docType === "merged") return "archive";
  return "reference";
}

function getTrackKey(path: string, frontmatter: Record<string, string>): string {
  const explicitTrack = normalizeScalar(frontmatter.track);
  if (explicitTrack) return toSlug(explicitTrack) || "general";
  if (path.startsWith("kb/") || path === "readme.md") return "general";
  return toSlug(path.split("/")[0] || "general") || "general";
}

function getTrackLabel(trackKey: string, frontmatter: Record<string, string>): string {
  const explicitLabel = normalizeScalar(frontmatter.track_label);
  if (explicitLabel) return explicitLabel;
  const explicitTrack = normalizeScalar(frontmatter.track);
  if (explicitTrack) return TRACK_LABELS[trackKey] || toPrettyLabel(explicitTrack);
  return TRACK_LABELS[trackKey] || toPrettyLabel(trackKey);
}

function getDocMetrics(content: string) {
  const words = content.split(/\s+/).filter((part) => part.trim()).length;
  const headings = (content.match(/^#{1,6}\s+/gm) || []).length;
  return { words, headings, readMinutes: Math.max(1, Math.round(words / 220)) };
}

function getMarkdownSection(content: string, heading: string): string {
  const matches = [...content.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index][1].trim() !== heading) continue;
    const start = (matches[index].index || 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    return content.slice(start, end);
  }
  return "";
}

function getMarkdownSubsection(content: string, heading: string): string {
  const matches = [...content.matchAll(/^###\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index][1].trim() !== heading) continue;
    const start = (matches[index].index || 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    return content.slice(start, end);
  }
  return "";
}

function getSectionBullets(content: string): string[] {
  const marker = /^([-*]|\d+[.)])\s+/;
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => marker.test(line))
    .map((line) => line.replace(marker, "").trim())
    .filter(Boolean);
}

function getSectionLinks(content: string): Array<{ label: string; href: string }> {
  return [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1].trim(),
    href: match[2].trim(),
  }));
}

function buildQuickRecall(content: string) {
  const section = getMarkdownSection(content, "Quick recall");
  if (!section) return null;
  const atGlance = getSectionBullets(getMarkdownSubsection(section, "At a glance")).slice(0, 4);
  const nextSteps = getSectionBullets(getMarkdownSubsection(section, "Next starting point")).slice(
    0,
    3,
  );
  return atGlance.length || nextSteps.length ? { atGlance, nextSteps } : null;
}

function buildDigestQuickView(content: string) {
  const weekAtGlance = getSectionBullets(getMarkdownSection(content, "Week at a glance")).slice(
    0,
    5,
  );
  const nextSteps = getSectionBullets(
    getMarkdownSection(content, "Next session starting point"),
  ).slice(0, 3);
  const fastLinks = getSectionLinks(getMarkdownSection(content, "Fast links")).slice(0, 10);
  return weekAtGlance.length || nextSteps.length || fastLinks.length
    ? { weekAtGlance, nextSteps, fastLinks }
    : null;
}

function buildSearchFields(value: string) {
  const raw = `${value || ""}`.toLowerCase();
  const normalized = raw
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, normalized };
}
