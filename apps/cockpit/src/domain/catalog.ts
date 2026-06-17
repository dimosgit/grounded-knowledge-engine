import {
  getDocType,
  getExcerpt,
  getLearningItemType,
  getSection,
  getTag,
  getTitle,
  getTrackKey,
  getTrackLabel,
  matchesTagFilter,
  normalizePath,
  parseFrontmatter,
} from "./docs";
import { buildSearchFields } from "../lib/search";

function shouldIndexDoc(path, frontmatter) {
  // `frontmatter.template === "true"` supports explicit template-marked docs.
  // The path check keeps existing behavior for kb/digests/TEMPLATE.md.
  if (frontmatter && frontmatter.template === "true") return false;
  if (path === "kb/digests/TEMPLATE.md") return false;
  return true;
}

export function buildDocs(markdownModules) {
  return Object.entries(markdownModules)
    .map(([rawPath, content]) => {
      const { body, frontmatter } = parseFrontmatter(content);
      const path = normalizePath(rawPath);
      const title = getTitle(path, body);
      const excerpt = getExcerpt(body);
      const docType = getDocType(path, title, body, frontmatter);
      const track = getTrackKey(path, frontmatter);
      const trackLabel = getTrackLabel(track, frontmatter);
      const learningItemType = getLearningItemType(docType);
      const searchFields = buildSearchFields(
        `${title}\n${path}\n${trackLabel}\n${excerpt}\n${JSON.stringify(frontmatter)}\n${body}`,
      );

      return {
        path,
        section: getSection(path),
        tag: getTag(path),
        docType,
        learningItemType,
        track,
        trackLabel,
        content: body,
        frontmatter,
        title,
        excerpt,
        searchIndex: searchFields.raw,
        searchIndexNormalized: searchFields.normalized,
        searchIndexCompact: searchFields.compact,
      };
    })
    .filter((doc) => shouldIndexDoc(doc.path, doc.frontmatter))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function matchesTrackAndLearningItem(doc, activeTrack, activeItemType) {
  const matchesTrack = activeTrack === "all" || doc.track === activeTrack;
  if (!matchesTrack) return false;
  const matchesLearningItem = activeItemType === "all" || doc.learningItemType === activeItemType;
  return matchesLearningItem;
}

export function getInitialDocPath(docs, activeTag, hideMerged, activeTrack, activeItemType, options: any = {}) {
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
