import { matchesTagFilter } from "./docs";

function shouldIndexDoc(path, frontmatter) {
  // `frontmatter.template === "true"` supports explicit template-marked docs.
  // The path check keeps existing behavior for kb/digests/TEMPLATE.md.
  if (frontmatter && frontmatter.template === "true") return false;
  if (path === "kb/digests/TEMPLATE.md") return false;
  return true;
}

export function buildDocs(catalogEntries) {
  return catalogEntries
    .map((entry) => ({
      ...entry,
      content: entry.structuralContent || "",
      searchIndexCompact: (entry.searchIndexNormalized || "").replace(/\s+/g, ""),
    }))
    .filter((doc) => shouldIndexDoc(doc.path, doc.frontmatter))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function matchesTrackAndLearningItem(doc, activeTrack, activeItemType) {
  const matchesTrack = activeTrack === "all" || doc.track === activeTrack;
  if (!matchesTrack) return false;
  const matchesLearningItem = activeItemType === "all" || doc.learningItemType === activeItemType;
  return matchesLearningItem;
}

export function getInitialDocPath(
  docs,
  activeTag,
  hideMerged,
  activeTrack,
  activeItemType,
  options: any = {},
) {
  const { fallbackToAnyDoc = true } = options;
  const visible = docs.filter((doc) => {
    if (!matchesTrackAndLearningItem(doc, activeTrack, activeItemType)) return false;
    const matchesTag = matchesTagFilter(doc, activeTag);
    if (!matchesTag) return false;
    if (hideMerged && doc.docType === "merged") return false;
    return true;
  });
  if (visible[0]?.path) return visible[0].path;
  if (!fallbackToAnyDoc) return "";
  return docs[0]?.path || "";
}
