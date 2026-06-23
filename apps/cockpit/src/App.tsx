import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  buildBreadcrumbs,
  buildDigestQuickView,
  buildQuickRecall,
  getDocBadge,
  getDocGuidance,
  getDocMetrics,
  getModuleDocForDoc,
  isExternalResource,
  learningItemDescriptions,
  learningItemLabels,
  learningItemOrder,
  matchesTagFilter,
  normalizeDocPath,
  resolveMarkdownAssetPath,
  resolveMarkdownDocPath,
  stripMarkdownSection,
  tagLabels,
} from "./domain/docs";
import { buildDocs, getInitialDocPath, matchesTrackAndLearningItem } from "./domain/catalog";
import {
  buildContextGraph,
  buildMajorContextGraph,
  filterMajorGraphFocusOptions,
  getMajorGraphFocusOption,
} from "./domain/graph";
import { buildHubModuleSummary, countOpenQuestions } from "./domain/hub";
import {
  buildCurationStats,
  buildLibraryItemCounts,
  buildRecentDocs,
  buildTagCounts,
  buildTrackFilterOptions,
  buildTracks,
  filterDocs,
  getDisplayTrackLabel,
  getScopedDocs,
  getSelectedTrackKey,
  getVisibleTags,
  groupDocsBySection,
} from "./domain/library";
import {
  BUCKET_LIFECYCLE,
  buildOpenQuestionItems,
  buildProjectColumns,
  buildProjectLinkedDocs,
  buildProjectSummaries,
  getActiveProject,
} from "./domain/projects";
import {
  getAppRoute,
  getHashPath,
  setHashGraph,
  setHashHub,
  setHashPath,
  setHashProject,
  setHashProjects,
} from "./lib/routes";
import { useRecentPaths } from "./hooks/useRecentPaths";
import { useRouteSync } from "./hooks/useRouteSync";
import { renderHighlighted } from "./components/HighlightedText";
import { HubView } from "./views/HubView";
import { LibraryView } from "./views/LibraryView";
import { ProjectBoardView } from "./views/ProjectBoardView";
import { ProjectDetailView } from "./views/ProjectDetailView";

const ContextGraphView = lazy(() =>
  import("./views/ContextGraphView").then((module) => ({ default: module.ContextGraphView })),
);

export { isExternalResource, normalizeDocPath, resolveMarkdownAssetPath, resolveMarkdownDocPath };

const RECENT_ACTIVITY_COUNT = 3;

const markdownModules = import.meta.glob("../content/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const DEFAULT_ACTIVE_TAG = "modules";
const DEFAULT_HIDE_MERGED = true;
const DEFAULT_ACTIVE_TRACK = "all";
const DEFAULT_ACTIVE_ITEM = "all";

export default function App() {
  const docs = useMemo(() => buildDocs(markdownModules), []);
  const currentYear = new Date().getFullYear();
  const initialHashPath = getHashPath();
  const initialDocFromHash = initialHashPath ? docs.find((doc) => doc.path === initialHashPath) || null : null;
  const initialRoute = getAppRoute();
  const [query, setQuery] = useState("");
  const [activeTrack, setActiveTrack] = useState(initialDocFromHash?.track || DEFAULT_ACTIVE_TRACK);
  const [activeItemType, setActiveItemType] = useState(DEFAULT_ACTIVE_ITEM);
  const [activeTag, setActiveTag] = useState(initialDocFromHash ? "all" : DEFAULT_ACTIVE_TAG);
  const [hideMerged, setHideMerged] = useState(DEFAULT_HIDE_MERGED);
  const [viewMode, setViewMode] = useState(() => {
    const route = initialRoute;
    if (route.mode === "hub") return "hub";
    if (route.mode === "projects") return "projects";
    if (route.mode === "project") return "project";
    if (route.mode === "graph") return "graph";
    return initialDocFromHash ? "library" : "hub";
  });
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [moduleContextByPath, setModuleContextByPath] = useState({});
  const [selectedProjectId, setSelectedProjectId] = useState(initialRoute.projectId || "");
  const [lifecycleOverrides, setLifecycleOverrides] = useState<Record<string, string>>({});
  const [selectedGraphPath, setSelectedGraphPath] = useState(initialRoute.focusPath || "overview");
  const [graphQuery, setGraphQuery] = useState("");
  const [activePath, setActivePath] = useState(() => {
    if (initialDocFromHash) return initialDocFromHash.path;
    return getInitialDocPath(docs, DEFAULT_ACTIVE_TAG, DEFAULT_HIDE_MERGED, DEFAULT_ACTIVE_TRACK, DEFAULT_ACTIVE_ITEM);
  });
  const recentPaths = useRecentPaths(activePath);
  useRouteSync({
    docs,
    setActiveItemType,
    setActivePath,
    setActiveTag,
    setActiveTrack,
    setIsReadingMode,
    setSelectedGraphPath,
    setSelectedProjectId,
    setViewMode,
  });

  const tracks = useMemo(() => buildTracks(docs), [docs]);

  const selectedTrackKey = useMemo(() => getSelectedTrackKey(tracks, activeTrack), [tracks, activeTrack]);

  const selectedTrack = tracks.find((track) => track.key === selectedTrackKey) || null;

  useEffect(() => {
    if (activeTrack === "all") return;
    if (!tracks.length) return;
    if (tracks.some((track) => track.key === activeTrack)) return;
    setActiveTrack(tracks[0].key);
  }, [activeTrack, tracks]);

  useEffect(() => {
    if (activeItemType !== "archive") return;
    if (!hideMerged) return;
    setHideMerged(false);
  }, [activeItemType, hideMerged]);

  const scopedDocs = useMemo(() => getScopedDocs(docs, activeTrack, activeItemType), [docs, activeTrack, activeItemType]);

  const tagCounts = useMemo(() => buildTagCounts(scopedDocs), [scopedDocs]);

  const visibleTags = useMemo(() => getVisibleTags(tagCounts), [tagCounts]);

  useEffect(() => {
    if (activeTag === "all") return;
    if (visibleTags.includes(activeTag)) return;
    setActiveTag("all");
  }, [activeTag, visibleTags]);

  const libraryItemCounts = useMemo(() => buildLibraryItemCounts(docs, activeTrack), [docs, activeTrack]);

  useEffect(() => {
    if (activeItemType === "all") return;
    if ((libraryItemCounts[activeItemType] || 0) > 0) return;
    setActiveItemType("all");
  }, [activeItemType, libraryItemCounts]);

  const curationStats = useMemo(() => buildCurationStats(scopedDocs), [scopedDocs]);

  const filteredDocs = useMemo(
    () => filterDocs({ docs, scopedDocs, query, activeTag, hideMerged }),
    [docs, scopedDocs, query, activeTag, hideMerged],
  );

  const groupedDocs = useMemo(() => groupDocsBySection(filteredDocs), [filteredDocs]);

  useEffect(() => {
    if (!docs.length) return;
    if (viewMode !== "library") return;
    if (docs.some((doc) => doc.path === activePath)) return;
    const fallbackPath = getInitialDocPath(docs, activeTag, hideMerged, activeTrack, activeItemType, {
      fallbackToAnyDoc: false,
    });
    if (!fallbackPath) return;
    setActivePath(fallbackPath);
    setHashPath(fallbackPath);
  }, [docs, viewMode, activePath, activeTag, hideMerged, activeTrack, activeItemType]);

  const activeDoc = docs.find((doc) => doc.path === activePath) || docs[0] || null;
  const activeDocInFilter = activeDoc ? filteredDocs.some((doc) => doc.path === activeDoc.path) : false;
  const activeDocMetrics = activeDoc ? getDocMetrics(activeDoc.content) : null;
  const activeModuleDoc = useMemo(() => {
    if (!activeDoc) return null;
    return getModuleDocForDoc(activeDoc, docs, moduleContextByPath);
  }, [activeDoc, docs, moduleContextByPath]);
  const activeBreadcrumbs = useMemo(() => {
    return buildBreadcrumbs(activeDoc, docs, activeModuleDoc);
  }, [activeDoc, docs, activeModuleDoc]);
  const digestQuickView = useMemo(() => {
    if (!activeDoc || activeDoc.docType !== "digest") return null;
    return buildDigestQuickView(activeDoc.content);
  }, [activeDoc]);
  const quickRecall = useMemo(() => {
    if (!activeDoc) return null;
    return buildQuickRecall(activeDoc.content);
  }, [activeDoc]);
  const readableDocContent = useMemo(() => {
    if (!activeDoc) return "";
    return stripMarkdownSection(activeDoc.content, "Quick recall");
  }, [activeDoc]);

  const trackFilterOptions = useMemo(() => buildTrackFilterOptions(docs, tracks), [docs, tracks]);

  const displayTrackLabel = useMemo(() => getDisplayTrackLabel(tracks, activeTrack), [activeTrack, tracks]);

  function openDoc(path, options: any = {}) {
    const sourcePath = options.sourcePath || activePath;
    const sourceDoc = docs.find((doc) => doc.path === sourcePath) || null;
    const sourceModuleDoc = getModuleDocForDoc(sourceDoc, docs, moduleContextByPath);

    if (sourceModuleDoc?.path && sourceModuleDoc.path !== path) {
      setModuleContextByPath((current) => ({
        ...current,
        [path]: sourceModuleDoc.path,
      }));
    }

    const targetDoc = docs.find((doc) => doc.path === path) || null;
    if (targetDoc?.docType === "module") {
      setModuleContextByPath((current) => ({
        ...current,
        [path]: path,
      }));
    }

    if (targetDoc && activeTrack !== "all" && targetDoc.track !== activeTrack) {
      setActiveTrack(targetDoc.track);
      setActiveItemType("all");
      setActiveTag("all");
    }

    setViewMode("library");
    setActivePath(path);
    setHashPath(path);
  }

  function revealActiveDoc() {
    setQuery("");
    setActiveTrack("all");
    setActiveItemType("all");
    setActiveTag("all");
    if (activeDoc?.docType === "merged") {
      setHideMerged(false);
    }
  }

  function enterLibrary(options: any = {}) {
    const nextTrack = options.trackKey || activeTrack;
    const nextItemType = options.itemType || activeItemType;
    const shouldHideMerged = nextItemType === "archive" ? false : hideMerged;
    const targetTrack = nextTrack === "all" ? null : tracks.find((track) => track.key === nextTrack) || null;
    const requestedItemHasDocs =
      nextItemType === "all" ||
      nextTrack === "all" ||
      ((targetTrack?.learningItemCounts?.[nextItemType] || 0) > 0);

    if (!requestedItemHasDocs) {
      return;
    }

    if (options.trackKey) setActiveTrack(options.trackKey);
    if (options.itemType) setActiveItemType(options.itemType);
    if (!shouldHideMerged) setHideMerged(false);
    setActiveTag("all");
    setViewMode("library");

    if (
      activeDoc &&
      matchesTrackAndLearningItem(activeDoc, nextTrack, nextItemType) &&
      matchesTagFilter(activeDoc, activeTag) &&
      (!shouldHideMerged || activeDoc.docType !== "merged")
    ) {
      setHashPath(activeDoc.path);
      return;
    }

    const nextPath = getInitialDocPath(docs, "all", shouldHideMerged, nextTrack, nextItemType, {
      fallbackToAnyDoc: false,
    });
    if (!nextPath) return;
    setActivePath(nextPath);
    setHashPath(nextPath);
  }

  function goToHub() {
    setIsReadingMode(false);
    setViewMode("hub");
    setHashHub();
  }

  function goToProjects() {
    setIsReadingMode(false);
    setViewMode("projects");
    setHashProjects();
  }

  function goToGraph(focusPath = "") {
    const nextFocusPath = focusPath || selectedGraphPath || "overview";
    if (nextFocusPath) setSelectedGraphPath(nextFocusPath);
    setIsReadingMode(false);
    setViewMode("graph");
    setHashGraph(nextFocusPath);
  }

  function focusGraphPath(path) {
    if (!path) return;
    setSelectedGraphPath(path);
    setIsReadingMode(false);
    setViewMode("graph");
    setHashGraph(path);
  }

  function openGraphNode(node) {
    if (!node) return;
    if (node.kind === "track" && node.trackKey) {
      enterLibrary({ trackKey: node.trackKey, itemType: "all" });
      return;
    }
    if (node.kind === "project" && node.projectId) {
      openProject(node.projectId);
      return;
    }
    if (node.path) {
      openDoc(node.path);
    }
  }

  function openProject(projectId) {
    setIsReadingMode(false);
    setSelectedProjectId(projectId);
    setViewMode("project");
    setHashProject(projectId);
  }

  const activeModuleForHub = useMemo(() => buildHubModuleSummary(docs), [docs]);

  const openQuestionsCount = useMemo(() => countOpenQuestions(docs), [docs]);

  const recentDocs = useMemo(() => buildRecentDocs(docs, recentPaths, RECENT_ACTIVITY_COUNT), [docs, recentPaths]);

  const projectSummaries = useMemo(
    () => buildProjectSummaries(docs, lifecycleOverrides),
    [docs, lifecycleOverrides],
  );
  const activeProject = useMemo(() => getActiveProject(projectSummaries, selectedProjectId), [projectSummaries, selectedProjectId]);
  const projectColumns = useMemo(() => buildProjectColumns(projectSummaries), [projectSummaries]);
  const moveProject = async (projectId, bucket) => {
    const project = projectSummaries.find((item) => item.id === projectId);
    if (!project || project.statusBucket === bucket) return;
    const lifecycle = BUCKET_LIFECYCLE[bucket] ?? "";
    // Optimistic move; the dev write-back + content re-sync makes it durable.
    setLifecycleOverrides((current) => ({ ...current, [projectId]: lifecycle }));
    try {
      const response = await fetch("/__board/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: project.sourceDocPath, lifecycle }),
      });
      if (!response.ok) throw new Error(await response.text());
    } catch (error) {
      // Revert the optimistic move so the board keeps matching the markdown.
      setLifecycleOverrides((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
      console.error("Could not move project lane (is the dev server running?)", error);
    }
  };
  const openQuestionItems = useMemo(() => buildOpenQuestionItems(docs), [docs]);
  const graphFocusOptions = useMemo(
    () => filterMajorGraphFocusOptions(docs, projectSummaries, tracks, graphQuery),
    [docs, graphQuery, projectSummaries, tracks],
  );
  const contextGraph = useMemo(() => buildMajorContextGraph(docs, projectSummaries, tracks, selectedGraphPath), [docs, projectSummaries, tracks, selectedGraphPath]);
  const graphFocusOption = useMemo(() => {
    return getMajorGraphFocusOption(docs, projectSummaries, tracks, contextGraph.focusId);
  }, [docs, projectSummaries, tracks, contextGraph.focusId]);
  useEffect(() => {
    if (viewMode !== "graph") return;
    if (selectedGraphPath === contextGraph.focusId) return;
    setSelectedGraphPath(contextGraph.focusId);
    setHashGraph(contextGraph.focusId);
  }, [viewMode, contextGraph.focusId, selectedGraphPath]);
  const projectContextGraph = useMemo(() => buildContextGraph(activeProject?.sourceDoc || null, docs), [activeProject, docs]);
  const activeProjectLinkedDocs = useMemo(
    () => buildProjectLinkedDocs(activeProject, projectContextGraph, docs),
    [activeProject, docs, projectContextGraph],
  );

  if (viewMode === "hub") {
    return (
      <HubView
        docs={docs}
        commandBarOpen={isCommandBarOpen}
        onCommandBarOpenChange={setIsCommandBarOpen}
        onCommand={() => setIsCommandBarOpen(true)}
        onHub={goToHub}
        onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
        onProjects={goToProjects}
        onGraph={goToGraph}
        onCommandSelect={(item) => openDoc(item.path)}
        activeProject={activeProject}
        activeModule={activeModuleForHub}
        openQuestionsCount={openQuestionsCount}
        projectCount={projectSummaries.length}
        openQuestionItems={openQuestionItems}
        tracks={tracks}
        selectedTrack={selectedTrack}
        selectedTrackKey={selectedTrackKey}
        onTrackChange={setActiveTrack}
        learningItemOrder={learningItemOrder}
        learningItemLabels={learningItemLabels}
        learningItemDescriptions={learningItemDescriptions}
        onEnterLibrary={enterLibrary}
        recentDocs={recentDocs}
        onOpenDoc={openDoc}
        getDocBadge={getDocBadge}
      />
    );
  }

  if (viewMode === "projects") {
    return (
      <ProjectBoardView
        docs={docs}
        commandBarOpen={isCommandBarOpen}
        onCommandBarOpenChange={setIsCommandBarOpen}
        onCommand={() => setIsCommandBarOpen(true)}
        onHub={goToHub}
        onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
        onProjects={goToProjects}
        onGraph={goToGraph}
        onCommandSelect={(item) => openDoc(item.path)}
        projectColumns={projectColumns}
        onOpenProject={openProject}
        onMoveProject={moveProject}
      />
    );
  }

  if (viewMode === "project") {
    return (
      <ProjectDetailView
        docs={docs}
        commandBarOpen={isCommandBarOpen}
        onCommandBarOpenChange={setIsCommandBarOpen}
        onCommand={() => setIsCommandBarOpen(true)}
        onHub={goToHub}
        onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
        onProjects={goToProjects}
        onGraph={goToGraph}
        onCommandSelect={(item) => openDoc(item.path)}
        activeProject={activeProject}
        linkedDocs={activeProjectLinkedDocs}
        onOpenDoc={openDoc}
      />
    );
  }

  if (viewMode === "graph") {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-surface-main p-8 text-body-md text-on-surface-variant">
            Loading context graph…
          </div>
        }
      >
        <ContextGraphView
          docs={docs}
          commandBarOpen={isCommandBarOpen}
          onCommandBarOpenChange={setIsCommandBarOpen}
          onCommand={() => setIsCommandBarOpen(true)}
          onHub={goToHub}
          onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
          onProjects={goToProjects}
          onGraph={goToGraph}
          onCommandSelect={(item) => openDoc(item.path)}
          contextGraph={contextGraph}
          graphFocusOption={graphFocusOption}
          graphFocusOptions={graphFocusOptions}
          graphQuery={graphQuery}
          onGraphQueryChange={setGraphQuery}
          onFocusGraphPath={focusGraphPath}
          onOpenGraphNode={openGraphNode}
        />
      </Suspense>
    );
  }

  return (
    <LibraryView
      docs={docs}
      commandBarOpen={isCommandBarOpen}
      onCommandBarOpenChange={setIsCommandBarOpen}
      onCommand={() => setIsCommandBarOpen(true)}
      onHub={goToHub}
      onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
      onProjects={goToProjects}
      onGraph={goToGraph}
      onCommandSelect={(item) => openDoc(item.path)}
      isReadingMode={isReadingMode}
      onToggleReadingMode={() => setIsReadingMode((current) => !current)}
      displayTrackLabel={displayTrackLabel}
      scopedDocs={scopedDocs}
      curationStats={curationStats}
      query={query}
      onQueryChange={setQuery}
      activeTrack={activeTrack}
      onActiveTrackChange={setActiveTrack}
      trackFilterOptions={trackFilterOptions}
      activeItemType={activeItemType}
      onActiveItemTypeChange={setActiveItemType}
      learningItemOrder={learningItemOrder}
      learningItemLabels={learningItemLabels}
      libraryItemCounts={libraryItemCounts}
      visibleTags={visibleTags}
      activeTag={activeTag}
      onActiveTagChange={setActiveTag}
      tagLabels={tagLabels}
      tagCounts={tagCounts}
      hideMerged={hideMerged}
      onHideMergedChange={setHideMerged}
      groupedDocs={groupedDocs}
      filteredDocs={filteredDocs}
      activeDoc={activeDoc}
      activeDocInFilter={activeDocInFilter}
      activeDocMetrics={activeDocMetrics}
      activeBreadcrumbs={activeBreadcrumbs}
      activeModuleDoc={activeModuleDoc}
      digestQuickView={digestQuickView}
      quickRecall={quickRecall}
      readableDocContent={readableDocContent}
      onOpenDoc={openDoc}
      onRevealActiveDoc={revealActiveDoc}
      renderHighlighted={renderHighlighted}
      getDocBadge={getDocBadge}
      getDocGuidance={getDocGuidance}
      resolveMarkdownDocPath={resolveMarkdownDocPath}
      resolveMarkdownAssetPath={resolveMarkdownAssetPath}
      isExternalResource={isExternalResource}
      currentYear={currentYear}
    />
  );
}
