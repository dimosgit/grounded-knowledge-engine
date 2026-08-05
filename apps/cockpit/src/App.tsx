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
  DEFAULT_GRAPH_LAYERS,
  INITIAL_GRAPH_LAYERS,
  buildMajorContextGraph,
  filterMajorGraphFocusOptions,
  getMajorGraphFocusOption,
} from "./domain/graph";
import { buildProjectContextMap } from "./domain/project-context-map";
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
  buildProjectAttentionCounts,
  buildProjectColumns,
  buildProjectSummaries,
  filterProjectSummaries,
  getActiveProject,
  type ProjectAttentionFilter,
} from "./domain/projects";
import {
  buildDecisionSummaries,
  countDecisionStates,
  filterDecisionSummaries,
  getDecisionSummary,
  parseDecisionDetail,
  type DecisionLedgerFilter,
} from "./domain/decisions";
import {
  type OperatorDestination,
  type OperatorInboxKindFilter,
  type OperatorInboxPriorityFilter,
  type OperatorReviewAction,
  type OperatorViewKey,
} from "./domain/operator-inbox";
import {
  composeCommandPaletteEntries,
  type CommandPaletteBinding,
  type CommandPaletteEntry,
} from "./domain/command-palette";
import {
  getAppRoute,
  getHashPath,
  setHashAttention,
  setHashGraph,
  setHashHub,
  setHashDecision,
  setHashDecisions,
  setHashPath,
  setHashProject,
  setHashProjects,
} from "./lib/routes";
import { OperatorAttentionProvider, useOperatorAttention } from "./hooks/useOperatorAttention";
import { useRecentDestinations } from "./hooks/useRecentDestinations";
import { useRecentPaths } from "./hooks/useRecentPaths";
import { useRouteSync } from "./hooks/useRouteSync";
import { useMarkdownBody } from "./hooks/useMarkdownBody";
import { createMarkdownContentLoader } from "./lib/content-loader";
import { renderHighlighted } from "./components/HighlightedText";

const HubView = lazy(() =>
  import("./views/HubView").then((module) => ({ default: module.HubView })),
);
const ContextGraphView = lazy(() =>
  import("./views/ContextGraphView").then((module) => ({ default: module.ContextGraphView })),
);
const LibraryView = lazy(() =>
  import("./views/LibraryView").then((module) => ({ default: module.LibraryView })),
);
const ProjectBoardView = lazy(() =>
  import("./views/ProjectBoardView").then((module) => ({ default: module.ProjectBoardView })),
);
const ProjectDetailView = lazy(() =>
  import("./views/ProjectDetailView").then((module) => ({ default: module.ProjectDetailView })),
);
const DecisionLedgerView = lazy(() =>
  import("./views/DecisionLedgerView").then((module) => ({
    default: module.DecisionLedgerView,
  })),
);
const DecisionReplayView = lazy(() =>
  import("./views/DecisionReplayView").then((module) => ({
    default: module.DecisionReplayView,
  })),
);
const AttentionView = lazy(() =>
  import("./views/AttentionView").then((module) => ({ default: module.AttentionView })),
);

export { isExternalResource, normalizeDocPath, resolveMarkdownAssetPath, resolveMarkdownDocPath };

const RECENT_ACTIVITY_COUNT = 3;

const catalogModules = import.meta.glob("../content/catalog.json", {
  import: "default",
  eager: true,
});
const markdownModules = import.meta.glob("../content/**/*.md", {
  query: "?raw",
  import: "default",
});
const catalogEntries = (Object.values(catalogModules)[0] || []) as Parameters<typeof buildDocs>[0];
const markdownContentLoader = createMarkdownContentLoader(markdownModules);

const DEFAULT_ACTIVE_TAG = "modules";
const DEFAULT_HIDE_MERGED = true;
declare const __KB_DEFAULT_ACTIVE_TRACK__: string | undefined;
// Workspaces can pin the initial track filter via `.gke/workspace.json` (ui.defaultActiveTrack).
const DEFAULT_ACTIVE_TRACK =
  typeof __KB_DEFAULT_ACTIVE_TRACK__ === "string" && __KB_DEFAULT_ACTIVE_TRACK__
    ? __KB_DEFAULT_ACTIVE_TRACK__
    : "all";
const DEFAULT_ACTIVE_ITEM = "all";

function ViewLoading({ label }: { label: string }) {
  return (
    <div
      className="min-h-screen bg-surface-main p-8 text-body-md text-on-surface-variant"
      role="status"
    >
      Loading {label}…
    </div>
  );
}

export default function App() {
  const docs = useMemo(() => buildDocs(catalogEntries), []);
  const currentYear = new Date().getFullYear();
  const initialHashPath = getHashPath();
  const initialDocFromHash = initialHashPath
    ? docs.find((doc) => doc.path === initialHashPath) || null
    : null;
  const initialRoute = getAppRoute();
  const [query, setQuery] = useState("");
  const [activeTrack, setActiveTrack] = useState(initialDocFromHash?.track || DEFAULT_ACTIVE_TRACK);
  const [activeItemType, setActiveItemType] = useState(DEFAULT_ACTIVE_ITEM);
  const [activeTag, setActiveTag] = useState(initialDocFromHash ? "all" : DEFAULT_ACTIVE_TAG);
  const [hideMerged, setHideMerged] = useState(DEFAULT_HIDE_MERGED);
  const [viewMode, setViewMode] = useState(() => {
    const route = initialRoute;
    if (route.mode === "hub") return "hub";
    if (route.mode === "attention") return "attention";
    if (route.mode === "projects") return "projects";
    if (route.mode === "project") return "project";
    if (route.mode === "decisions") return "decisions";
    if (route.mode === "decision") return "decision";
    if (route.mode === "graph") return "graph";
    return initialDocFromHash ? "library" : "hub";
  });
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [moduleContextByPath, setModuleContextByPath] = useState({});
  const [selectedProjectId, setSelectedProjectId] = useState(initialRoute.projectId || "");
  const [selectedDecisionId, setSelectedDecisionId] = useState(initialRoute.decisionId || "");
  const [decisionLedgerFilter, setDecisionLedgerFilter] = useState<DecisionLedgerFilter>(
    (initialRoute.decisionFilter as DecisionLedgerFilter) || "all",
  );
  const [decisionQuery, setDecisionQuery] = useState("");
  const [lifecycleOverrides, setLifecycleOverrides] = useState<Record<string, string>>({});
  const [projectBodyOverrides, setProjectBodyOverrides] = useState<Record<string, string>>({});
  const [projectAttentionFilter, setProjectAttentionFilter] = useState<ProjectAttentionFilter>(
    (initialRoute.attentionFilter as ProjectAttentionFilter) || "all",
  );
  const [inboxKind, setInboxKind] = useState<OperatorInboxKindFilter>(
    (initialRoute.inboxKind as OperatorInboxKindFilter) || "all",
  );
  const [inboxPriority, setInboxPriority] = useState<OperatorInboxPriorityFilter>(
    (initialRoute.inboxPriority as OperatorInboxPriorityFilter) || "all",
  );
  const [inboxProjectId, setInboxProjectId] = useState(initialRoute.inboxProjectId || "");
  const [selectedGraphPath, setSelectedGraphPath] = useState(initialRoute.focusPath || "overview");
  const [graphQuery, setGraphQuery] = useState("");
  const [graphLayers, setGraphLayers] = useState<string[]>(INITIAL_GRAPH_LAYERS);
  const [graphStatusFilter, setGraphStatusFilter] = useState("all");
  const [activePath, setActivePath] = useState(() => {
    if (initialDocFromHash) return initialDocFromHash.path;
    return getInitialDocPath(
      docs,
      DEFAULT_ACTIVE_TAG,
      DEFAULT_HIDE_MERGED,
      DEFAULT_ACTIVE_TRACK,
      DEFAULT_ACTIVE_ITEM,
    );
  });
  const recentPaths = useRecentPaths(activePath);
  const { recentIds, rememberDestination } = useRecentDestinations();
  useRouteSync({
    docs,
    setActiveItemType,
    setActivePath,
    setActiveTag,
    setActiveTrack,
    setIsReadingMode,
    setSelectedGraphPath,
    setSelectedProjectId,
    setProjectAttentionFilter,
    setSelectedDecisionId,
    setDecisionLedgerFilter,
    setInboxKind,
    setInboxPriority,
    setInboxProjectId,
    setViewMode,
  });

  const tracks = useMemo(() => buildTracks(docs), [docs]);

  const selectedTrackKey = useMemo(
    () => getSelectedTrackKey(tracks, activeTrack),
    [tracks, activeTrack],
  );

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

  const scopedDocs = useMemo(
    () => getScopedDocs(docs, activeTrack, activeItemType),
    [docs, activeTrack, activeItemType],
  );

  const tagCounts = useMemo(() => buildTagCounts(scopedDocs), [scopedDocs]);

  const visibleTags = useMemo(() => getVisibleTags(tagCounts), [tagCounts]);

  useEffect(() => {
    if (activeTag === "all") return;
    if (visibleTags.includes(activeTag)) return;
    setActiveTag("all");
  }, [activeTag, visibleTags]);

  const libraryItemCounts = useMemo(
    () => buildLibraryItemCounts(docs, activeTrack),
    [docs, activeTrack],
  );

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
    const fallbackPath = getInitialDocPath(
      docs,
      activeTag,
      hideMerged,
      activeTrack,
      activeItemType,
      {
        fallbackToAnyDoc: false,
      },
    );
    if (!fallbackPath) return;
    setActivePath(fallbackPath);
    setHashPath(fallbackPath);
  }, [docs, viewMode, activePath, activeTag, hideMerged, activeTrack, activeItemType]);

  const activeDoc = docs.find((doc) => doc.path === activePath) || docs[0] || null;
  const activeDocBody = useMarkdownBody(
    markdownContentLoader,
    activeDoc?.path || "",
    viewMode === "library" && Boolean(activeDoc),
  );
  const activeDocContent = activeDocBody.status === "ready" ? activeDocBody.body : "";
  const activeDocInFilter = activeDoc
    ? filteredDocs.some((doc) => doc.path === activeDoc.path)
    : false;
  const activeDocMetrics = activeDoc
    ? activeDocContent
      ? getDocMetrics(activeDocContent)
      : activeDoc.metrics
    : null;
  const activeModuleDoc = useMemo(() => {
    if (!activeDoc) return null;
    return getModuleDocForDoc(activeDoc, docs, moduleContextByPath);
  }, [activeDoc, docs, moduleContextByPath]);
  const activeBreadcrumbs = useMemo(() => {
    return buildBreadcrumbs(activeDoc, docs, activeModuleDoc);
  }, [activeDoc, docs, activeModuleDoc]);
  const digestQuickView = useMemo(() => {
    if (!activeDoc || activeDoc.docType !== "digest") return null;
    return activeDocContent
      ? buildDigestQuickView(activeDocContent)
      : activeDoc.digestQuickView || null;
  }, [activeDoc, activeDocContent]);
  const quickRecall = useMemo(() => {
    if (!activeDoc) return null;
    return activeDocContent ? buildQuickRecall(activeDocContent) : activeDoc.quickRecall || null;
  }, [activeDoc, activeDocContent]);
  const readableDocContent = useMemo(() => {
    if (!activeDocContent) return "";
    return stripMarkdownSection(activeDocContent, "Quick recall");
  }, [activeDocContent]);

  const trackFilterOptions = useMemo(() => buildTrackFilterOptions(docs, tracks), [docs, tracks]);

  const displayTrackLabel = useMemo(
    () => getDisplayTrackLabel(tracks, activeTrack),
    [activeTrack, tracks],
  );

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
    const targetTrack =
      nextTrack === "all" ? null : tracks.find((track) => track.key === nextTrack) || null;
    const requestedItemHasDocs =
      nextItemType === "all" ||
      nextTrack === "all" ||
      (targetTrack?.learningItemCounts?.[nextItemType] || 0) > 0;

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

  function goToAttention(
    filters = { kind: inboxKind, priority: inboxPriority, projectId: inboxProjectId },
  ) {
    setIsReadingMode(false);
    setInboxKind(filters.kind);
    setInboxPriority(filters.priority);
    setInboxProjectId(filters.projectId);
    setViewMode("attention");
    setHashAttention(filters);
  }

  function goToProjects() {
    setIsReadingMode(false);
    setViewMode("projects");
    setHashProjects();
  }

  function openAttentionQueue(filter: ProjectAttentionFilter) {
    setProjectAttentionFilter(filter);
    setIsReadingMode(false);
    setViewMode("projects");
    setHashProjects(filter);
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

  function toggleGraphLayer(layerId) {
    setGraphLayers((current) => {
      if (!current.includes(layerId)) {
        // Keep the canonical order so the chips never reshuffle.
        return DEFAULT_GRAPH_LAYERS.filter((id) => id === layerId || current.includes(id));
      }
      const next = current.filter((id) => id !== layerId);
      // Never let the operator empty the canvas completely.
      return next.length ? next : current;
    });
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

  function openProject(projectId, section = "") {
    setIsReadingMode(false);
    setSelectedProjectId(projectId);
    setViewMode("project");
    setHashProject(projectId, section);
  }

  function openProjectDeliveryChecklist(projectId) {
    openProject(projectId, "delivery-checklist");
  }

  function goToDecisions(filter: DecisionLedgerFilter = "all") {
    setIsReadingMode(false);
    setDecisionLedgerFilter(filter);
    setViewMode("decisions");
    setHashDecisions(filter);
  }

  function openDecision(decisionId) {
    setIsReadingMode(false);
    setSelectedDecisionId(decisionId);
    setViewMode("decision");
    setHashDecision(decisionId);
  }

  function openView(view: OperatorViewKey) {
    if (view === "hub") return goToHub();
    if (view === "attention") return goToAttention();
    if (view === "library") {
      return enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType });
    }
    if (view === "projects") return goToProjects();
    if (view === "decisions") return goToDecisions(decisionLedgerFilter);
    return goToGraph();
  }

  function requestOperatorAction(action: OperatorReviewAction, proposalId?: string) {
    // The shared Attention state owns the request so the drawers, the inbox,
    // and the shell badge react to exactly one source.
    attention.requestOperatorAction(action, proposalId);
  }

  function openOperatorDestination(destination: OperatorDestination) {
    switch (destination.kind) {
      case "project":
        return openProject(destination.projectId);
      case "decision":
        return openDecision(destination.decisionId);
      case "document":
        return openDoc(destination.path);
      case "view":
        return openView(destination.view);
      case "capture":
        return requestOperatorAction("capture-review", destination.proposalId);
      case "review":
        return requestOperatorAction(destination.action);
    }
  }

  const activeModuleForHub = useMemo(() => buildHubModuleSummary(docs), [docs]);

  const openQuestionsCount = useMemo(() => countOpenQuestions(docs), [docs]);

  const recentDocs = useMemo(
    () => buildRecentDocs(docs, recentPaths, RECENT_ACTIVITY_COUNT),
    [docs, recentPaths],
  );

  const catalogProjectSummaries = useMemo(
    () => buildProjectSummaries(docs, lifecycleOverrides),
    [docs, lifecycleOverrides],
  );
  const catalogActiveProject = useMemo(
    () => getActiveProject(catalogProjectSummaries, selectedProjectId),
    [catalogProjectSummaries, selectedProjectId],
  );
  const activeProjectBody = useMarkdownBody(
    markdownContentLoader,
    catalogActiveProject?.sourceDocPath || "",
    viewMode === "project" && Boolean(catalogActiveProject?.sourceDocPath),
  );
  const projectDocs = useMemo(() => {
    if (!catalogActiveProject?.sourceDocPath) return docs;
    const sourceDocPath = catalogActiveProject.sourceDocPath;
    const body =
      projectBodyOverrides[sourceDocPath] ??
      (activeProjectBody.status === "ready" ? activeProjectBody.body : null);
    if (body === null) return docs;
    return docs.map((doc) => (doc.path === sourceDocPath ? { ...doc, content: body } : doc));
  }, [
    activeProjectBody.body,
    activeProjectBody.status,
    catalogActiveProject,
    docs,
    projectBodyOverrides,
  ]);
  const projectSummaries = useMemo(
    () => buildProjectSummaries(projectDocs, lifecycleOverrides),
    [lifecycleOverrides, projectDocs],
  );
  const activeProject = useMemo(
    () => getActiveProject(projectSummaries, selectedProjectId),
    [projectSummaries, selectedProjectId],
  );
  const projectContextMap = useMemo(
    () => buildProjectContextMap(activeProject, projectDocs),
    [activeProject, projectDocs],
  );
  const attentionCounts = useMemo(
    () => buildProjectAttentionCounts(projectSummaries),
    [projectSummaries],
  );
  const attentionProjects = useMemo(
    () => filterProjectSummaries(projectSummaries, "needs-attention"),
    [projectSummaries],
  );
  const filteredProjectSummaries = useMemo(
    () => filterProjectSummaries(projectSummaries, projectAttentionFilter),
    [projectAttentionFilter, projectSummaries],
  );
  const projectColumns = useMemo(
    () => buildProjectColumns(filteredProjectSummaries),
    [filteredProjectSummaries],
  );
  const moveProject = async (projectId, bucket) => {
    const project = projectSummaries.find((item) => item.id === projectId);
    if (!project || project.statusBucket === bucket) return;
    const lifecycle = BUCKET_LIFECYCLE[bucket] ?? "";
    // Optimistic move; the dev write-back + content re-sync makes it durable.
    setLifecycleOverrides((current) => ({ ...current, [projectId]: lifecycle }));
    // The lane write-back is a dev-only Vite middleware (see vite.config.ts).
    // In the static build (e.g. the hosted demo) that endpoint does not exist,
    // and the SPA fallback would answer the POST with index.html and a
    // misleading 200 — so the move would look persisted but silently isn't.
    // Keep the optimistic in-session move and skip the request outside dev; the
    // Project Board surfaces a "demo mode" notice explaining moves are
    // session-only there.
    if (!import.meta.env.DEV) return;
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

  const finishProjectTask = async (taskText: string) => {
    if (!activeProject?.id || !activeProject.sourceDocPath) {
      throw new Error("Project task is unavailable.");
    }
    if (!import.meta.env.DEV) {
      throw new Error("Task completion is available only in a writable local workspace.");
    }
    const { finishProjectTask: submitTaskCompletion } = await import("./lib/project-task-api");
    const result = await submitTaskCompletion(activeProject.id, taskText);
    setProjectBodyOverrides((current) => ({
      ...current,
      [activeProject.sourceDocPath]: result.content,
    }));
  };
  const openQuestionItems = useMemo(() => buildOpenQuestionItems(docs), [docs]);
  const graphFocusOptions = useMemo(
    () => filterMajorGraphFocusOptions(docs, projectSummaries, tracks, graphQuery),
    [docs, graphQuery, projectSummaries, tracks],
  );
  const contextGraph = useMemo(
    () =>
      buildMajorContextGraph(docs, projectSummaries, tracks, selectedGraphPath, {
        layers: graphLayers,
        projectStatus: graphStatusFilter,
      }),
    [docs, graphLayers, graphStatusFilter, projectSummaries, tracks, selectedGraphPath],
  );
  const graphFocusOption = useMemo(() => {
    return getMajorGraphFocusOption(docs, projectSummaries, tracks, contextGraph.focusId);
  }, [docs, projectSummaries, tracks, contextGraph.focusId]);
  const graphProject = useMemo(() => {
    if (contextGraph.focusNode?.kind !== "project") return null;
    return (
      projectSummaries.find((project) => project.id === contextGraph.focusNode.projectId) || null
    );
  }, [contextGraph.focusNode, projectSummaries]);
  const graphProjectContextMap = useMemo(
    () => (graphProject ? buildProjectContextMap(graphProject, docs) : null),
    [docs, graphProject],
  );
  useEffect(() => {
    if (viewMode !== "graph") return;
    if (selectedGraphPath === contextGraph.focusId) return;
    setSelectedGraphPath(contextGraph.focusId);
    setHashGraph(contextGraph.focusId);
  }, [viewMode, contextGraph.focusId, selectedGraphPath]);
  const decisionSummaries = useMemo(() => buildDecisionSummaries(docs), [docs]);
  const paletteEntries = useMemo(
    () =>
      composeCommandPaletteEntries({
        documents: docs,
        projects: projectSummaries,
        decisions: decisionSummaries,
        // Local development opens the authoritative review tools. The static
        // preview keeps the same destinations reachable through read-only
        // explanatory drawers without bundling local endpoint adapters.
        includeReviewActions: true,
      }),
    [decisionSummaries, docs, projectSummaries],
  );

  function selectPaletteEntry(entry: CommandPaletteEntry) {
    rememberDestination(entry.id);
    openOperatorDestination(entry.destination);
  }

  const palette: CommandPaletteBinding = {
    entries: paletteEntries,
    recentIds,
    isOpen: isCommandBarOpen,
    onOpenChange: setIsCommandBarOpen,
    onSelect: selectPaletteEntry,
  };

  const decisionCounts = useMemo(() => countDecisionStates(decisionSummaries), [decisionSummaries]);
  const filteredDecisionSummaries = useMemo(
    () => filterDecisionSummaries(decisionSummaries, decisionLedgerFilter, decisionQuery),
    [decisionLedgerFilter, decisionQuery, decisionSummaries],
  );
  const activeDecisionSummary = useMemo(
    () => getDecisionSummary(decisionSummaries, selectedDecisionId),
    [decisionSummaries, selectedDecisionId],
  );
  const activeDecisionDoc = useMemo(
    () => docs.find((doc) => doc.path === activeDecisionSummary?.path) || null,
    [activeDecisionSummary, docs],
  );
  const activeDecisionBody = useMarkdownBody(
    markdownContentLoader,
    activeDecisionSummary?.path || "",
    viewMode === "decision" && Boolean(activeDecisionSummary?.path),
  );
  const activeDecisionResult = useMemo(() => {
    if (activeDecisionBody.status !== "ready" || !activeDecisionSummary) {
      return { decision: null, error: "" };
    }
    try {
      return {
        decision: parseDecisionDetail(
          activeDecisionBody.body,
          activeDecisionSummary.path,
          undefined,
          activeDecisionDoc?.frontmatter,
        ),
        error: "",
      };
    } catch (error) {
      return {
        decision: null,
        error: error instanceof Error ? error.message : "The decision record is invalid.",
      };
    }
  }, [
    activeDecisionBody.body,
    activeDecisionBody.status,
    activeDecisionDoc,
    activeDecisionSummary,
  ]);

  const attention = useOperatorAttention({
    projects: projectSummaries,
    decisions: decisionSummaries,
    questions: openQuestionItems,
    // Changed evidence is only rendered by the Attention Inbox, so it loads
    // when that route is active rather than on every screen.
    changesActive: viewMode === "attention",
  });

  function renderActiveView() {
    if (viewMode === "attention") {
      return (
        <Suspense fallback={<ViewLoading label="attention inbox" />}>
          <AttentionView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            projects={projectSummaries}
            filters={{ kind: inboxKind, priority: inboxPriority, projectId: inboxProjectId }}
            onFiltersChange={goToAttention}
            onOpenDestination={openOperatorDestination}
          />
        </Suspense>
      );
    }

    if (viewMode === "hub") {
      return (
        <Suspense fallback={<ViewLoading label="operator hub" />}>
          <HubView
            docs={docs}
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
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
            attentionCounts={attentionCounts}
            attentionProjects={attentionProjects}
            onOpenAttention={() => goToAttention({ kind: "all", priority: "all", projectId: "" })}
            onAttentionFilter={openAttentionQueue}
            onOpenProject={openProject}
          />
        </Suspense>
      );
    }

    if (viewMode === "projects") {
      return (
        <Suspense fallback={<ViewLoading label="project board" />}>
          <ProjectBoardView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            projectColumns={projectColumns}
            onOpenProject={openProject}
            onMoveProject={moveProject}
            attentionFilter={projectAttentionFilter}
            onAttentionFilterChange={setProjectAttentionFilter}
            attentionCounts={attentionCounts}
          />
        </Suspense>
      );
    }

    if (viewMode === "decisions") {
      return (
        <Suspense fallback={<ViewLoading label="decision ledger" />}>
          <DecisionLedgerView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            decisions={filteredDecisionSummaries}
            counts={decisionCounts}
            filter={decisionLedgerFilter}
            onFilterChange={(filter) => {
              setDecisionLedgerFilter(filter);
              setHashDecisions(filter);
            }}
            query={decisionQuery}
            onQueryChange={setDecisionQuery}
            onOpenDecision={openDecision}
          />
        </Suspense>
      );
    }

    if (viewMode === "decision") {
      const bodyStatus =
        activeDecisionResult.error && activeDecisionBody.status === "ready"
          ? "error"
          : activeDecisionBody.status;
      return (
        <Suspense fallback={<ViewLoading label="decision replay" />}>
          <DecisionReplayView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            summary={activeDecisionSummary}
            decision={activeDecisionResult.decision}
            bodyStatus={bodyStatus}
            bodyError={activeDecisionResult.error || activeDecisionBody.error}
            onRetryBody={activeDecisionBody.retry}
            onReviewApplied={() => {
              window.setTimeout(activeDecisionBody.retry, 500);
            }}
            onBack={() => goToDecisions(decisionLedgerFilter)}
            onOpenDoc={openDoc}
          />
        </Suspense>
      );
    }

    if (viewMode === "project") {
      return (
        <Suspense fallback={<ViewLoading label="project details" />}>
          <ProjectDetailView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            activeProject={activeProject}
            contextMap={projectContextMap}
            focusSection={initialRoute.mode === "project" ? initialRoute.projectSection : ""}
            onOpenDoc={openDoc}
            onOpenDecision={openDecision}
            bodyStatus={activeProjectBody.status}
            bodyError={activeProjectBody.error}
            onRetryBody={activeProjectBody.retry}
            onCompleteTask={finishProjectTask}
          />
        </Suspense>
      );
    }

    if (viewMode === "graph") {
      return (
        <Suspense
          fallback={
            <div className="min-h-screen bg-surface-main p-8 text-body-md text-on-surface-variant">
              Loading portfolio map…
            </div>
          }
        >
          <ContextGraphView
            palette={palette}
            onCommand={() => setIsCommandBarOpen(true)}
            onHub={goToHub}
            onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
            onProjects={goToProjects}
            onGraph={goToGraph}
            contextGraph={contextGraph}
            graphFocusOption={graphFocusOption}
            graphFocusOptions={graphFocusOptions}
            graphQuery={graphQuery}
            onGraphQueryChange={setGraphQuery}
            onFocusGraphPath={focusGraphPath}
            onOpenGraphNode={openGraphNode}
            graphLayers={graphLayers}
            onToggleGraphLayer={toggleGraphLayer}
            graphStatusFilter={graphStatusFilter}
            onGraphStatusFilterChange={setGraphStatusFilter}
            graphProject={graphProject}
            projectContextMap={graphProjectContextMap}
            onOpenDoc={openDoc}
            onOpenDecision={openDecision}
            onOpenDeliveryChecklist={openProjectDeliveryChecklist}
          />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<ViewLoading label="knowledge library" />}>
        <LibraryView
          docs={docs}
          palette={palette}
          onCommand={() => setIsCommandBarOpen(true)}
          onHub={goToHub}
          onLibrary={() => enterLibrary({ trackKey: selectedTrackKey, itemType: activeItemType })}
          onProjects={goToProjects}
          onGraph={goToGraph}
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
          activeDocBodyStatus={activeDocBody.status}
          activeDocBodyError={activeDocBody.error}
          onRetryActiveDocBody={activeDocBody.retry}
          onOpenDoc={openDoc}
          onRevealActiveDoc={revealActiveDoc}
          renderHighlighted={renderHighlighted}
          getDocBadge={getDocBadge}
          getDocGuidance={getDocGuidance}
          resolveMarkdownDocPath={resolveMarkdownDocPath}
          resolveMarkdownAssetPath={resolveMarkdownAssetPath}
          currentYear={currentYear}
        />
      </Suspense>
    );
  }

  return (
    <OperatorAttentionProvider value={attention}>{renderActiveView()}</OperatorAttentionProvider>
  );
}
