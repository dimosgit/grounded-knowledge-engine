import {
  compareTrackEntries,
  createLearningItemCountMap,
  getTrackDescription,
  matchesTagFilter,
  tagOrder,
  toPrettyLabel,
  trackDisplay,
} from "./docs";
import { matchesSearchFields } from "../lib/search";
import { matchesTrackAndLearningItem } from "./catalog";

export function buildTracks(docs) {
  const map = new Map();

  for (const doc of docs) {
    const existing = map.get(doc.track);
    if (existing) {
      existing.count += 1;
      existing.learningItemCounts.all += 1;
      existing.learningItemCounts[doc.learningItemType] += 1;
      if (
        !trackDisplay[doc.track] &&
        doc.trackLabel &&
        doc.trackLabel !== toPrettyLabel(doc.track)
      ) {
        existing.label = doc.trackLabel;
      }
      continue;
    }

    const learningItemCounts = createLearningItemCountMap(1);
    learningItemCounts[doc.learningItemType] = 1;

    map.set(doc.track, {
      key: doc.track,
      label: doc.trackLabel || trackDisplay[doc.track]?.label || toPrettyLabel(doc.track),
      description: getTrackDescription(doc.track),
      count: 1,
      learningItemCounts,
    });
  }

  return Array.from(map.values()).sort(compareTrackEntries);
}

export function getSelectedTrackKey(tracks, activeTrack) {
  if (!tracks.length) return "all";
  if (activeTrack !== "all" && tracks.some((track) => track.key === activeTrack))
    return activeTrack;
  return tracks[0].key;
}

export function getDisplayTrackLabel(tracks, activeTrack) {
  if (activeTrack === "all") return "All Tracks";
  const match = tracks.find((track) => track.key === activeTrack);
  return match?.label || toPrettyLabel(activeTrack);
}

export function buildTrackFilterOptions(docs, tracks) {
  return [{ key: "all", label: "All Tracks", count: docs.length }, ...tracks];
}

export function getScopedDocs(docs, activeTrack, activeItemType) {
  return docs.filter((doc) => matchesTrackAndLearningItem(doc, activeTrack, activeItemType));
}

export function buildTagCounts(scopedDocs) {
  return scopedDocs.reduce(
    (acc, doc) => {
      acc[doc.tag] = (acc[doc.tag] || 0) + 1;
      return acc;
    },
    { all: scopedDocs.length },
  );
}

export function getVisibleTags(tagCounts) {
  return tagOrder.filter((tag) => tag === "all" || (tagCounts[tag] || 0) > 0);
}

export function buildLibraryItemCounts(docs, activeTrack) {
  const trackScoped = docs.filter((doc) => activeTrack === "all" || doc.track === activeTrack);
  const counts = createLearningItemCountMap(trackScoped.length);
  for (const doc of trackScoped) {
    counts[doc.learningItemType] += 1;
  }
  return counts;
}

export function buildCurationStats(scopedDocs) {
  return scopedDocs.reduce(
    (acc, doc) => {
      acc[doc.docType] = (acc[doc.docType] || 0) + 1;
      return acc;
    },
    { module: 0, client: 0, canonical: 0, merged: 0, term: 0, digest: 0 },
  );
}

export function filterDocs({ docs, scopedDocs, query, activeTag, hideMerged }) {
  const isSearching = query.trim().length > 0;
  const searchableDocs = isSearching ? docs : scopedDocs;

  return searchableDocs.filter((doc) => {
    const matchesTag = isSearching ? true : matchesTagFilter(doc, activeTag);
    if (!matchesTag) return false;
    if (hideMerged && doc.docType === "merged") return false;
    return matchesSearchFields(
      {
        raw: doc.searchIndex,
        normalized: doc.searchIndexNormalized,
        compact: doc.searchIndexCompact,
      },
      query,
    );
  });
}

export function groupDocsBySection(filteredDocs) {
  const sections = filteredDocs.reduce((acc, doc) => {
    if (!acc[doc.section]) acc[doc.section] = [];
    acc[doc.section].push(doc);
    return acc;
  }, {});
  const order = ["kb/modules", "kb/clients", "kb/topics", "kb/terms", "kb/digests", "kb", "root"];
  return Object.entries(sections).sort((a, b) => {
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (av !== bv) return av - bv;
    return a[0].localeCompare(b[0]);
  });
}

export function buildRecentDocs(docs, recentPaths, limit) {
  const docsByPath = new Map<string, any>(docs.map((doc) => [doc.path, doc]));
  const ordered = [];
  const seenPaths = new Set();
  const seenTitles = new Set();

  for (const path of recentPaths) {
    const doc = docsByPath.get(path);
    if (!doc) continue;
    const normalizedTitle = doc.title.trim().toLowerCase();
    if (seenPaths.has(doc.path) || seenTitles.has(normalizedTitle)) continue;
    seenPaths.add(doc.path);
    seenTitles.add(normalizedTitle);
    ordered.push(doc);
    if (ordered.length >= limit) break;
  }

  return ordered;
}
