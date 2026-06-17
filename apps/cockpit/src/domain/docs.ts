export const tagLabels = {
  all: "All",
  modules: "Modules",
  clients: "Clients",
  terms: "Terms",
  topics: "Topics",
  digests: "Digests",
  kb: "KB",
  readme: "Readme",
  other: "Other",
};

export const learningItemLabels = {
  all: "All Items",
  module: "Modules",
  canonical: "Canonical Notes",
  concept: "Concepts",
  review: "Reviews",
  reference: "References",
  archive: "Archive",
};

export const learningItemDescriptions = {
  module: "Module-level pages that organize learning progression.",
  canonical: "Canonical topic notes used as your primary learning units.",
  concept: "Term files for definitions and quick conceptual recall.",
  review: "Digest files focused on reflection and consolidation.",
  reference: "Supporting notes and project artifacts.",
  archive: "Merged or historical items kept for traceability.",
};

export const trackDisplay = {
  demo: {
    label: "Demo",
    description: "Demo knowledge base used to exercise the grounded engine.",
  },
  ai: {
    label: "AI",
    description: "LLMs, RAG, embeddings, and AI application patterns.",
  },
  "business-marketing": {
    label: "Business & Marketing",
    description: "Growth, outreach, metrics, finance, and entrepreneur operating systems.",
  },
  "knowledge-ops": {
    label: "Knowledge Ops",
    description: "KB information architecture, curation workflows, and consolidation rules.",
  },
  data: {
    label: "Data",
    description: "Data modeling, SQL, pipelines, and analytics.",
  },
  "ai-tools": {
    label: "AI Tools",
    description: "Prompting, automation, and agent workflows.",
  },
  product: {
    label: "Product",
    description: "Roadmapping, discovery, and product execution.",
  },
  finance: {
    label: "Finance",
    description: "Planning, controls, and financial decision-making.",
  },
  communication: {
    label: "Communication",
    description: "Writing, influence, and stakeholder updates.",
  },
  general: {
    label: "General",
    description: "Cross-domain notes without a dedicated track.",
  },
};

export const tagOrder = ["all", "modules", "clients", "terms", "topics", "digests", "kb", "readme", "other"];
export const learningItemOrder = ["all", "module", "canonical", "concept", "review", "reference", "archive"];
export const trackOrder = [
  "demo",
  "ai",
  "business-marketing",
  "knowledge-ops",
  "data",
  "ai-tools",
  "product",
  "finance",
  "communication",
  "general",
];

export function toPrettyLabel(value) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTitle(path, body) {
  const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (firstHeading) return firstHeading;
  const fileName = path.split("/").pop()?.replace(/\.md$/i, "") || path;
  return toPrettyLabel(fileName);
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { body: raw, frontmatter: {} };
  }

  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { body: raw, frontmatter: {} };
  }

  const header = raw.slice(4, end).trim();
  const body = raw.slice(end + 5);
  const frontmatter = {};

  for (const line of header.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }

  return { body, frontmatter };
}

export function getExcerpt(body) {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find(
      (item) =>
        item &&
        !item.startsWith("#") &&
        !item.startsWith("- ") &&
        !item.startsWith("* "),
    );

  if (!line) return "No summary line found.";
  return line.length > 130 ? `${line.slice(0, 127)}...` : line;
}

export function normalizePath(rawPath) {
  return rawPath.replace(/^\.\.\/content\//, "");
}

export function getTag(path) {
  if (path.startsWith("kb/modules/")) return "modules";
  if (path.startsWith("kb/clients/")) return "clients";
  if (path.startsWith("kb/terms/")) return "terms";
  if (path.startsWith("kb/topics/")) return "topics";
  if (path.startsWith("kb/digests/")) return "digests";
  if (path === "readme.md") return "readme";
  if (path.startsWith("kb/")) return "kb";
  return "other";
}

export function getSection(path) {
  if (path.startsWith("kb/modules/")) return "kb/modules";
  if (path.startsWith("kb/clients/")) return "kb/clients";
  if (path.startsWith("kb/terms/")) return "kb/terms";
  if (path.startsWith("kb/topics/")) return "kb/topics";
  if (path.startsWith("kb/digests/")) return "kb/digests";
  if (path.startsWith("kb/")) return "kb";
  return "root";
}

export function getDocType(path, title, content, frontmatter: any = {}) {
  if (path.startsWith("kb/modules/")) return "module";
  if (path.startsWith("kb/clients/")) return "client";
  if (path.startsWith("kb/topics/")) {
    if (frontmatter.status === "merged") return "merged";
    if (frontmatter.status === "canonical") return "canonical";
    if (/\(Merged Note\)/i.test(title) || /was merged into the canonical/i.test(content)) {
      return "merged";
    }
    return "canonical";
  }
  if (path.startsWith("kb/terms/")) return "term";
  if (path.startsWith("kb/digests/")) return "digest";
  return "reference";
}

export function getLearningItemType(docType) {
  if (docType === "module") return "module";
  if (docType === "client") return "module";
  if (docType === "canonical") return "canonical";
  if (docType === "term") return "concept";
  if (docType === "digest") return "review";
  if (docType === "merged") return "archive";
  return "reference";
}

export function normalizeFrontmatterScalar(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function getTrackKey(path, frontmatter: any = {}) {
  const explicitTrack = normalizeFrontmatterScalar(frontmatter.track);
  if (explicitTrack) {
    return toSlug(explicitTrack) || "general";
  }

  if (path.startsWith("kb/") || path === "readme.md") {
    return "general";
  }

  const rootSegment = path.split("/")[0];
  return toSlug(rootSegment || "general") || "general";
}

export function getTrackLabel(trackKey, frontmatter: any = {}) {
  const explicitLabel = normalizeFrontmatterScalar(frontmatter.track_label);
  if (explicitLabel) return explicitLabel;

  const explicitTrack = normalizeFrontmatterScalar(frontmatter.track);
  if (explicitTrack) {
    if (trackDisplay[trackKey]) return trackDisplay[trackKey].label;
    return toPrettyLabel(explicitTrack);
  }

  if (trackDisplay[trackKey]) return trackDisplay[trackKey].label;
  return toPrettyLabel(trackKey);
}

export function getTrackDescription(trackKey) {
  return trackDisplay[trackKey]?.description || "Custom learning track loaded from markdown files.";
}

export function getDocBadge(docType) {
  if (docType === "module") return "Module";
  if (docType === "client") return "Client";
  if (docType === "canonical") return "Canonical";
  if (docType === "merged") return "Merged";
  if (docType === "term") return "Term";
  if (docType === "digest") return "Digest";
  return "Doc";
}

export function getDocGuidance(docType) {
  if (docType === "module") return "Module page: use this as your navigation and consolidation hub.";
  if (docType === "client") return "Client page: use this as the client-specific navigation hub.";
  if (docType === "canonical") return "Canonical note: this is the primary source for this topic.";
  if (docType === "merged") return "Merged stub: historical note, redirected to a canonical page.";
  if (docType === "digest") return "Weekly digest: progress and consolidation outcomes.";
  return "Reference note.";
}

export function getSectionLabel(section) {
  if (section === "kb/modules") return "Modules";
  if (section === "kb/clients") return "Clients";
  if (section === "kb/topics") return "Topics";
  if (section === "kb/terms") return "Terms";
  if (section === "kb/digests") return "Digests";
  if (section === "kb") return "KB";
  if (section === "root") return "Root";
  return section;
}

export function matchesTagFilter(doc, tag) {
  if (tag === "all") return true;
  return doc.tag === tag;
}

export function createLearningItemCountMap(all = 0) {
  return learningItemOrder.reduce(
    (acc, itemType) => ({
      ...acc,
      [itemType]: itemType === "all" ? all : 0,
    }),
    {},
  );
}

export function compareTrackEntries(a, b) {
  const ai = trackOrder.indexOf(a.key);
  const bi = trackOrder.indexOf(b.key);
  const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
  const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
  if (av !== bv) return av - bv;
  return a.label.localeCompare(b.label);
}

export function getPrimaryModuleDoc(doc, docs) {
  if (!doc) return null;
  if (doc.docType === "module") return doc;
  const moduleKey = normalizeFrontmatterScalar(doc.frontmatter?.module);
  if (!moduleKey) return null;
  const modulePath = `kb/modules/${moduleKey}.md`;
  return docs.find((item) => item.path === modulePath) || null;
}

export function getModuleDocForDoc(doc, docs, moduleContextByPath) {
  if (!doc) return null;
  if (doc.docType === "module") return doc;

  const contextualModulePath = moduleContextByPath[doc.path];
  if (contextualModulePath) {
    const contextualModuleDoc = docs.find((item) => item.path === contextualModulePath);
    if (contextualModuleDoc?.docType === "module") {
      return contextualModuleDoc;
    }
  }

  return getPrimaryModuleDoc(doc, docs);
}

export function buildBreadcrumbs(doc, docs, moduleDoc) {
  if (!doc) return [];

  const crumbs = [];
  const kbIndexDoc = docs.find((item) => item.path === "kb/index.md");
  const modulesIndexDoc = docs.find((item) => item.path === "kb/modules/index.md");
  const clientsIndexDoc = docs.find((item) => item.path === "kb/clients/index.md");
  const sectionLabel = getSectionLabel(doc.section);

  if (doc.path.startsWith("kb/")) {
    crumbs.push({
      key: "crumb-kb",
      label: "KB",
      path: kbIndexDoc?.path || null,
      current: false,
    });
  }

  if (sectionLabel && sectionLabel !== "KB" && sectionLabel !== "Root") {
    crumbs.push({
      key: `crumb-section-${doc.section}`,
      label: sectionLabel,
      path:
        doc.section === "kb/modules"
          ? modulesIndexDoc?.path || null
          : doc.section === "kb/clients"
            ? clientsIndexDoc?.path || null
            : null,
      current: false,
    });
  }

  if (moduleDoc && moduleDoc.path !== doc.path) {
    crumbs.push({
      key: `crumb-module-${moduleDoc.path}`,
      label: moduleDoc.title,
      path: moduleDoc.path,
      current: false,
    });
  }

  crumbs.push({
    key: `crumb-doc-${doc.path}`,
    label: doc.title,
    path: null,
    current: true,
  });

  return crumbs;
}

export function getDocMetrics(content) {
  const words = content
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const headings = (content.match(/^#{1,6}\s+/gm) || []).length;
  const readMinutes = Math.max(1, Math.round(words / 220));
  return { words, headings, readMinutes };
}

export function getMarkdownSection(content, heading) {
  const headingMatches = [...content.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const currentHeading = headingMatches[index][1].trim();
    if (currentHeading !== heading) continue;
    const start = headingMatches[index].index + headingMatches[index][0].length;
    const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : content.length;
    return content.slice(start, end);
  }
  return "";
}

// Matches the leading marker of a markdown list item: a dash/asterisk bullet
// (`- `, `* `) or an ordered-list number (`1. `, `2) `). Authors write the
// project handoff sections (Next 3 actions, etc.) as numbered lists, so the
// board must treat those as bullets too — not just dash bullets.
const LIST_ITEM_MARKER = /^([-*]|\d+[.)])\s+/;

export function getSectionBullets(sectionContent) {
  return sectionContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => LIST_ITEM_MARKER.test(line))
    .map((line) => line.replace(LIST_ITEM_MARKER, "").trim())
    .filter(Boolean);
}

export function getSectionLinks(sectionContent) {
  return [...sectionContent.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1].trim(),
    href: match[2].trim(),
  }));
}

function getMarkdownSubsection(content, heading) {
  const headingMatches = [...content.matchAll(/^###\s+(.+)$/gm)];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const currentHeading = headingMatches[index][1].trim();
    if (currentHeading !== heading) continue;
    const start = headingMatches[index].index + headingMatches[index][0].length;
    const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : content.length;
    return content.slice(start, end);
  }
  return "";
}

export function buildQuickRecall(content) {
  const quickRecall = getMarkdownSection(content, "Quick recall");
  if (!quickRecall) return null;

  const atGlance = getSectionBullets(getMarkdownSubsection(quickRecall, "At a glance")).slice(0, 4);
  const nextSteps = getSectionBullets(getMarkdownSubsection(quickRecall, "Next starting point")).slice(0, 3);

  if (!atGlance.length && !nextSteps.length) return null;
  return { atGlance, nextSteps };
}

export function stripMarkdownSection(content, heading) {
  const headingMatches = [...content.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const currentHeading = headingMatches[index][1].trim();
    if (currentHeading !== heading) continue;
    const start = headingMatches[index].index;
    const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : content.length;
    return `${content.slice(0, start)}${content.slice(end)}`.replace(/\n{3,}/g, "\n\n");
  }
  return content;
}

export function buildDigestQuickView(content) {
  const weekAtGlance = getSectionBullets(getMarkdownSection(content, "Week at a glance")).slice(0, 5);
  const nextSteps = getSectionBullets(getMarkdownSection(content, "Next session starting point")).slice(0, 3);
  const fastLinks = getSectionLinks(getMarkdownSection(content, "Fast links")).slice(0, 10);

  if (!weekAtGlance.length && !nextSteps.length && !fastLinks.length) {
    return null;
  }

  return { weekAtGlance, nextSteps, fastLinks };
}

export function normalizeDocPath(path) {
  const segments = path.split("/");
  const output = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }

  return output.join("/");
}

export function resolveMarkdownDocPath(currentPath, href) {
  if (!href) return null;
  if (href.startsWith("#")) return null;

  const cleanHref = href.split("#")[0].split("?")[0];
  if (!cleanHref.endsWith(".md")) return null;

  const currentDir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/") + 1) : "";

  if (cleanHref.startsWith("/")) {
    const absolute = normalizeDocPath(cleanHref.slice(1));
    if (absolute.startsWith("kb/")) {
      return absolute;
    }
    return normalizeDocPath(`kb/${absolute}`);
  }

  return normalizeDocPath(`${currentDir}${cleanHref}`);
}

export function isExternalResource(target) {
  return /^https?:\/\//i.test(target) || /^\/\//.test(target) || target.startsWith("data:") || target.startsWith("blob:");
}

export function resolveMarkdownAssetPath(currentPath, src) {
  if (!src) return src;
  if (isExternalResource(src)) return src;

  const currentDir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/") + 1) : "";

  if (src.startsWith("/")) {
    const absolute = normalizeDocPath(src.slice(1));
    if (absolute.startsWith("content/")) return `/${absolute}`;
    if (absolute.startsWith("assets/")) return `/content/kb/${absolute}`;
    if (absolute.startsWith("kb/") || absolute === "readme.md") {
      return `/content/${absolute}`;
    }
    return src;
  }

  const resolved = normalizeDocPath(`${currentDir}${src}`);
  return `/content/${resolved}`;
}
