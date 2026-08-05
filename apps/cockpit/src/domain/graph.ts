import {
  getDocBadge,
  getSectionLinks,
  normalizeDocPath,
  normalizeFrontmatterScalar,
  toSlug,
} from "./docs";

function normalizeFrontmatterList(value) {
  return normalizeFrontmatterScalar(value)
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => toSlug(item.trim()))
    .filter(Boolean);
}

function getDocModuleKey(doc) {
  const explicitModule = normalizeFrontmatterScalar(doc.frontmatter?.module);
  if (explicitModule) return explicitModule;
  if (doc.path.startsWith("kb/modules/")) {
    return doc.path.split("/").pop()?.replace(/\.md$/i, "") || "";
  }
  return "";
}

function resolveMarkdownHref(href, sourcePath, docsByPath) {
  const cleanHref = href.split("#")[0].split("?")[0].trim();
  if (!cleanHref || /^(https?:|mailto:|tel:)/i.test(cleanHref)) return "";

  const sourceDir = sourcePath.split("/").slice(0, -1).join("/");
  const rawPath = cleanHref.startsWith("/")
    ? cleanHref.slice(1)
    : cleanHref.startsWith(".")
      ? `${sourceDir}/${cleanHref}`
      : cleanHref;
  const normalized = normalizeDocPath(rawPath);
  const candidates = normalized.endsWith(".md") ? [normalized] : [normalized, `${normalized}.md`];
  return candidates.find((candidate) => docsByPath.has(candidate)) || "";
}

function getGraphDocMeta(doc, docsByPath) {
  const links = Array.isArray(doc.links) ? doc.links : getSectionLinks(doc.content || "");
  const outgoingPaths = new Set(
    links.map((link) => resolveMarkdownHref(link.href, doc.path, docsByPath)).filter(Boolean),
  );
  const moduleKey = getDocModuleKey(doc);
  if (moduleKey && doc.docType !== "module") {
    const modulePath = `kb/modules/${moduleKey}.md`;
    if (docsByPath.has(modulePath)) outgoingPaths.add(modulePath);
  }

  return {
    doc,
    moduleKey,
    tags: normalizeFrontmatterList(doc.frontmatter?.tags),
    outgoingPaths,
    searchableText: `${doc.title}\n${doc.path}\n${doc.searchIndexNormalized || ""}`.toLowerCase(),
  };
}

function scoreGraphRelationship(focusMeta, candidateMeta) {
  const reasons = [];
  let score = 0;

  if (focusMeta.outgoingPaths.has(candidateMeta.doc.path)) {
    score += 8;
    reasons.push("explicit link from focus");
  }
  if (candidateMeta.outgoingPaths.has(focusMeta.doc.path)) {
    score += 7;
    reasons.push("backlink to focus");
  }
  if (
    focusMeta.moduleKey &&
    candidateMeta.moduleKey &&
    focusMeta.moduleKey === candidateMeta.moduleKey
  ) {
    score += 5;
    reasons.push(`same module: ${focusMeta.moduleKey}`);
  }

  const focusModulePath = focusMeta.moduleKey ? `kb/modules/${focusMeta.moduleKey}.md` : "";
  const candidateModulePath = candidateMeta.moduleKey
    ? `kb/modules/${candidateMeta.moduleKey}.md`
    : "";
  if (focusModulePath && candidateMeta.doc.path === focusModulePath) {
    score += 6;
    reasons.push("owning module");
  }
  if (candidateModulePath && focusMeta.doc.path === candidateModulePath) {
    score += 5;
    reasons.push("module member");
  }

  const sharedTags = focusMeta.tags.filter((tag) => candidateMeta.tags.includes(tag)).slice(0, 3);
  if (sharedTags.length) {
    score += sharedTags.length * 2;
    reasons.push(`shared tags: ${sharedTags.join(", ")}`);
  }
  if (focusMeta.doc.track === candidateMeta.doc.track) {
    score += 1;
    reasons.push(`same track: ${focusMeta.doc.trackLabel}`);
  }

  const focusSlug = toSlug(focusMeta.doc.title);
  const candidateSlug = toSlug(candidateMeta.doc.title);
  if (focusSlug && candidateMeta.searchableText.includes(focusSlug.replaceAll("-", " "))) {
    score += 2;
    reasons.push("mentions focus title");
  }
  if (candidateSlug && focusMeta.searchableText.includes(candidateSlug.replaceAll("-", " "))) {
    score += 2;
    reasons.push("mentioned by focus");
  }

  return { score, reasons };
}

function getGraphNodeKind(doc, isFocus = false) {
  if (isFocus) return "focus";
  if (doc.docType === "module" || doc.docType === "client") return "module";
  if (doc.docType === "digest") return "digest";
  if (doc.docType === "term") return "term";
  return "note";
}

export function buildContextGraph(focusDoc, docs) {
  if (!focusDoc) return { focusDoc: null, nodes: [], edges: [], relationships: [] };

  const docsByPath = new Map<string, any>(docs.map((doc) => [doc.path, doc]));
  const metaByPath = new Map(docs.map((doc) => [doc.path, getGraphDocMeta(doc, docsByPath)]));
  const focusMeta = metaByPath.get(focusDoc.path);
  if (!focusMeta) return { focusDoc: null, nodes: [], edges: [], relationships: [] };

  const relationships = docs
    .filter((doc) => doc.path !== focusDoc.path)
    .map((doc) => {
      const candidateMeta = metaByPath.get(doc.path);
      const relationship = scoreGraphRelationship(focusMeta, candidateMeta);
      return { doc, ...relationship };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, 12);

  const positions = [
    { x: 50, y: 18 },
    { x: 73, y: 28 },
    { x: 82, y: 52 },
    { x: 68, y: 76 },
    { x: 42, y: 82 },
    { x: 20, y: 64 },
    { x: 18, y: 36 },
    { x: 36, y: 26 },
    { x: 61, y: 36 },
    { x: 62, y: 64 },
    { x: 38, y: 61 },
    { x: 50, y: 92 },
  ];

  const nodes = [
    {
      id: focusDoc.path,
      label: focusDoc.title,
      kind: "focus",
      path: focusDoc.path,
      docType: getDocBadge(focusDoc.docType),
      x: 50,
      y: 50,
      score: 0,
      reasons: ["selected focus"],
    },
    ...relationships.map((relationship, index) => ({
      id: relationship.doc.path,
      label: relationship.doc.title,
      kind: getGraphNodeKind(relationship.doc),
      path: relationship.doc.path,
      docType: getDocBadge(relationship.doc.docType),
      x: positions[index]?.x || 50,
      y: positions[index]?.y || 50,
      score: relationship.score,
      reasons: relationship.reasons,
    })),
  ];

  const visiblePaths = new Set(nodes.map((node) => node.path));
  const edges = relationships.map((relationship) => ({
    id: `${focusDoc.path}->${relationship.doc.path}`,
    from: focusDoc.path,
    to: relationship.doc.path,
    score: relationship.score,
    reasons: relationship.reasons,
    kind: relationship.reasons[0] || "related",
  }));

  for (const source of relationships.slice(0, 8)) {
    const sourceMeta: any = metaByPath.get(source.doc.path);
    for (const targetPath of sourceMeta.outgoingPaths as Set<string>) {
      if (!visiblePaths.has(targetPath) || targetPath === focusDoc.path) continue;
      if (edges.some((edge) => edge.from === source.doc.path && edge.to === targetPath)) continue;
      edges.push({
        id: `${source.doc.path}->${targetPath}`,
        from: source.doc.path,
        to: targetPath,
        score: 3,
        reasons: ["visible doc link"],
        kind: "visible doc link",
      });
      if (edges.length >= 22) break;
    }
    if (edges.length >= 22) break;
  }

  return { focusDoc, nodes, edges, relationships };
}

export function getMajorGraphFocusOptions(docs, projectSummaries, tracks) {
  const trackOptions = tracks.map((track) => ({
    id: `track:${track.key}`,
    label: track.label,
    kind: "Track",
    searchText: `${track.label} ${track.key}`,
  }));
  const moduleOptions = docs
    .filter((doc) => doc.docType === "module")
    .map((doc) => ({
      id: `module:${getDocModuleKey(doc) || doc.path}`,
      label: doc.title,
      kind: "Module",
      path: doc.path,
      searchText: `${doc.title} ${doc.path} ${doc.trackLabel}`,
    }));
  const clientOptions = docs
    .filter((doc) => doc.docType === "client")
    .map((doc) => ({
      id: `client:${doc.path}`,
      label: doc.title,
      kind: "Client",
      path: doc.path,
      searchText: `${doc.title} ${doc.path} ${doc.trackLabel}`,
    }));
  const projectOptions = projectSummaries
    .filter((project) => !project.legacy)
    .map((project) => ({
      id: `project:${project.id}`,
      label: project.title,
      kind: "Project",
      projectId: project.id,
      path: project.sourceDocPath,
      searchText: `${project.title} ${project.sourceDocPath} ${project.trackLabel} ${project.module}`,
    }));

  return [
    {
      id: "overview",
      label: "All major contexts",
      kind: "Overview",
      searchText: "overview all major contexts",
    },
    ...trackOptions,
    ...moduleOptions,
    ...clientOptions,
    ...projectOptions,
  ];
}

export function filterMajorGraphFocusOptions(docs, projectSummaries, tracks, query) {
  const normalizedQuery = query.trim().toLowerCase();

  return getMajorGraphFocusOptions(docs, projectSummaries, tracks).filter((option) => {
    if (!normalizedQuery) return true;
    return option.searchText.toLowerCase().includes(normalizedQuery);
  });
}

export function getMajorGraphFocusOption(docs, projectSummaries, tracks, focusId) {
  return (
    getMajorGraphFocusOptions(docs, projectSummaries, tracks).find(
      (option) => option.id === focusId,
    ) || null
  );
}

/** Node kinds the operator can switch on and off from the graph toolbar. */
export const GRAPH_LAYERS = [
  { id: "track", label: "Tracks" },
  { id: "module", label: "Modules" },
  { id: "client", label: "Clients" },
  { id: "project", label: "Projects" },
  { id: "context", label: "Signals" },
];

export const DEFAULT_GRAPH_LAYERS = GRAPH_LAYERS.map((layer) => layer.id);

/**
 * Signals triple the node count, so the canvas opens without them: project cards
 * carry their signal counts inline until the operator switches the layer on.
 */
export const INITIAL_GRAPH_LAYERS = DEFAULT_GRAPH_LAYERS.filter((id) => id !== "context");

export const GRAPH_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "blocked", label: "Blocked" },
  { id: "next", label: "Next" },
];

function getNodeLayer(node) {
  return node.kind === "client" ? "client" : node.kind;
}

/** World geometry in canvas pixels; node coordinates stay percentage-based. */
const OVERVIEW_LAYOUT = {
  trackX: 110,
  moduleX: 350,
  projectStartX: 640,
  projectCellWidth: 330,
  projectCellHeight: 168,
  projectNodeInset: 130,
  paddingY: 90,
  minHeight: 720,
  /** Card height plus breathing room: below this, rail labels overlap. */
  railMinStep: 84,
  /** Horizontal offset for a wrapped rail column; wider than a rail card. */
  railColumnGap: 210,
};

const FOCUS_LAYOUT = {
  width: 1400,
  height: 900,
  radiusX: 36,
  radiusY: 34,
  innerRingFactor: 0.62,
  contextRadiusX: 11,
  contextRadiusY: 13,
};

function layoutOverview(visibleNodes, showContext) {
  const grouped = {
    track: visibleNodes.filter((node) => node.kind === "track"),
    module: visibleNodes.filter((node) => node.kind === "module" || node.kind === "client"),
    project: visibleNodes.filter((node) => node.kind === "project"),
    context: visibleNodes.filter((node) => node.kind === "context"),
  };

  const projectCount = grouped.project.length;
  const columns = Math.max(1, Math.min(3, Math.ceil(projectCount / 6)));
  const rows = Math.max(1, Math.ceil(projectCount / columns));
  const cellWidth = OVERVIEW_LAYOUT.projectCellWidth + (showContext ? 220 : 0);
  const cellHeight = OVERVIEW_LAYOUT.projectCellHeight + (showContext ? 90 : 0);
  const canvasHeight = Math.max(
    OVERVIEW_LAYOUT.minHeight,
    OVERVIEW_LAYOUT.paddingY * 2 + rows * cellHeight,
  );

  const railSpan = canvasHeight - OVERVIEW_LAYOUT.paddingY * 2;
  // A rail taller than the canvas would stack cards on top of each other, so a
  // dense rail wraps into extra columns instead. The canvas has horizontal room;
  // overlapping labels are unreadable at any zoom level.
  const railRowCapacity = Math.max(1, Math.floor(railSpan / OVERVIEW_LAYOUT.railMinStep) + 1);
  const rails = [
    { items: grouped.track, railX: OVERVIEW_LAYOUT.trackX },
    { items: grouped.module, railX: OVERVIEW_LAYOUT.moduleX },
  ].map((rail) => {
    const railColumns = Math.max(1, Math.ceil(rail.items.length / railRowCapacity));
    return { ...rail, railColumns, perColumn: Math.ceil(rail.items.length / railColumns) };
  });

  // Push the project grid clear of any rail that had to wrap.
  const railOverflow = Math.max(...rails.map((rail) => rail.railColumns - 1), 0);
  const projectStartX =
    OVERVIEW_LAYOUT.projectStartX + railOverflow * OVERVIEW_LAYOUT.railColumnGap;
  const canvasWidth = projectStartX + columns * cellWidth + 80;
  const toPercentX = (value) => (value / canvasWidth) * 100;
  const toPercentY = (value) => (value / canvasHeight) * 100;

  for (const { items, railX, perColumn } of rails) {
    const step = perColumn > 1 ? railSpan / (perColumn - 1) : 0;
    items.forEach((node, index) => {
      const column = Math.floor(index / perColumn);
      const row = index % perColumn;
      node.x = toPercentX(railX + column * OVERVIEW_LAYOUT.railColumnGap);
      node.y = toPercentY(perColumn > 1 ? OVERVIEW_LAYOUT.paddingY + row * step : canvasHeight / 2);
    });
  }

  // Signal chips fan out to the right of their project, two columns deep.
  const contextOffsets = [
    { x: 190, y: -66 },
    { x: 348, y: -66 },
    { x: 190, y: 0 },
    { x: 348, y: 0 },
    { x: 190, y: 66 },
    { x: 348, y: 66 },
  ];

  grouped.project.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centerX = projectStartX + column * cellWidth + OVERVIEW_LAYOUT.projectNodeInset;
    const centerY = OVERVIEW_LAYOUT.paddingY + row * cellHeight + cellHeight / 2;
    node.x = toPercentX(centerX);
    node.y = toPercentY(centerY);

    grouped.context
      .filter((item) => item.projectNodeId === node.id)
      .forEach((contextNode, contextIndex) => {
        const offset = contextOffsets[contextIndex] || contextOffsets[contextOffsets.length - 1];
        contextNode.x = toPercentX(centerX + offset.x);
        contextNode.y = toPercentY(centerY + offset.y);
      });
  });

  return { canvasWidth, canvasHeight };
}

function layoutFocus(visibleNodes, focusNode) {
  if (focusNode) {
    focusNode.x = 50;
    focusNode.y = 50;
  }

  const nodesById = new Map<string, any>(visibleNodes.map((node) => [node.id, node]));
  const neighbors = visibleNodes.filter((node) => node.id !== focusNode?.id);
  const anchored = neighbors.filter(
    (node) => node.kind === "context" && nodesById.has(node.projectNodeId),
  );
  const anchoredIds = new Set(anchored.map((node) => node.id));
  const ringNodes = neighbors.filter((node) => !anchoredIds.has(node.id));

  // Two rings once a single one would stack the labels on top of each other.
  const useTwoRings = ringNodes.length > 10;
  ringNodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(ringNodes.length, 1);
    const ringFactor = useTwoRings && index % 2 === 1 ? FOCUS_LAYOUT.innerRingFactor : 1;
    node.x = 50 + Math.cos(angle) * FOCUS_LAYOUT.radiusX * ringFactor;
    node.y = 50 + Math.sin(angle) * FOCUS_LAYOUT.radiusY * ringFactor;
  });

  const anchorsByProject = new Map<string, any[]>();
  for (const node of anchored) {
    const siblings = anchorsByProject.get(node.projectNodeId) || [];
    siblings.push(node);
    anchorsByProject.set(node.projectNodeId, siblings);
  }
  for (const [projectNodeId, siblings] of anchorsByProject) {
    const parent = nodesById.get(projectNodeId);
    if (!parent) continue;
    // Fan the signals away from the centre so they never sit under their parent.
    const outward = Math.atan2(parent.y - 50, parent.x - 50);
    siblings.forEach((node, index) => {
      const angle = outward + ((index - (siblings.length - 1) / 2) * Math.PI) / 3.4;
      node.x = Math.max(3, Math.min(97, parent.x + Math.cos(angle) * FOCUS_LAYOUT.contextRadiusX));
      node.y = Math.max(4, Math.min(96, parent.y + Math.sin(angle) * FOCUS_LAYOUT.contextRadiusY));
    });
  }

  return { canvasWidth: FOCUS_LAYOUT.width, canvasHeight: FOCUS_LAYOUT.height };
}

export function buildMajorContextGraph(
  docs,
  projectSummaries,
  tracks,
  focusId = "overview",
  options: { layers?: string[]; projectStatus?: string } = {},
) {
  const activeLayers = new Set(options.layers?.length ? options.layers : DEFAULT_GRAPH_LAYERS);
  const projectStatusFilter = options.projectStatus || "all";
  const docsByPath = new Map<string, any>(docs.map((doc) => [doc.path, doc]));
  const nodesById = new Map<string, any>();
  const edgesById = new Map<string, any>();

  function addNode(node) {
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
    return nodesById.get(node.id);
  }

  function addEdge(from, to, reason, score = 1) {
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    const reverseKey = `${to}->${from}`;
    const existing = edgesById.get(key) || edgesById.get(reverseKey);
    if (existing) {
      existing.score += score;
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    edgesById.set(key, { id: key, from, to, score, reasons: [reason], kind: reason });
  }

  const canonicalProjects = projectSummaries.filter((project) => !project.legacy);
  const graphProjects = canonicalProjects.filter((project) => {
    if (projectStatusFilter === "all") return true;
    // The focused project always stays on the canvas, filter or not.
    if (`project:${project.id}` === focusId) return true;
    if (projectStatusFilter === "blocked") {
      return project.statusBucket === "blocked" || (project.blockers || []).length > 0;
    }
    return project.statusBucket === projectStatusFilter;
  });

  for (const track of tracks) {
    addNode({
      id: `track:${track.key}`,
      label: track.label,
      kind: "track",
      trackKey: track.key,
      summary: `${track.count} indexed docs`,
      count: track.count,
    });
  }

  const moduleDocs = docs.filter((doc) => doc.docType === "module");
  for (const doc of moduleDocs) {
    const moduleKey = getDocModuleKey(doc) || doc.path;
    const moduleDocsCount = docs.filter(
      (item) => getDocModuleKey(item) === moduleKey && item.path !== doc.path,
    ).length;
    addNode({
      id: `module:${moduleKey}`,
      label: doc.title,
      kind: "module",
      path: doc.path,
      moduleKey,
      trackKey: doc.track,
      summary: `${moduleDocsCount} owned docs`,
      count: moduleDocsCount,
    });
    addEdge(`track:${doc.track}`, `module:${moduleKey}`, "track owns module", 2);
  }

  for (const doc of docs.filter((item) => item.docType === "client")) {
    addNode({
      id: `client:${doc.path}`,
      label: doc.title,
      kind: "client",
      path: doc.path,
      trackKey: doc.track,
      summary: "client context",
      count: docs.filter((item) => getGraphDocMeta(item, docsByPath).outgoingPaths.has(doc.path))
        .length,
    });
    addEdge(`track:${doc.track}`, `client:${doc.path}`, "track owns client", 2);
  }

  for (const project of graphProjects) {
    const projectNodeId = `project:${project.id}`;
    const openTaskCount = (project.tasks || []).filter((task) => task.status !== "done").length;
    const attentionCount = (project.blockers || []).length + (project.openQuestions || []).length;
    const contextSignals = [
      {
        key: "work",
        label: "Current work",
        count: openTaskCount || (project.nextActions || []).length,
        summary: `${openTaskCount || (project.nextActions || []).length} open items`,
      },
      {
        key: "attention",
        label: "Attention",
        count: attentionCount,
        summary: `${attentionCount} blockers or questions`,
      },
      {
        key: "decisions",
        label: "Decisions",
        count: (project.activeDecisions || []).length,
        summary: `${(project.activeDecisions || []).length} active decisions`,
      },
      {
        key: "history",
        label: "History",
        count: project.recentChanges ? 1 : 0,
        summary: project.recentChanges ? "latest change connected" : "no history connected",
      },
      {
        key: "evidence",
        label: "Evidence",
        count: (project.keyDocuments || []).length + 1,
        summary: `${(project.keyDocuments || []).length + 1} scoped records`,
      },
    ].filter((signal) => signal.count > 0);

    addNode({
      id: projectNodeId,
      label: project.title,
      kind: "project",
      path: project.sourceDocPath,
      projectId: project.id,
      moduleKey: project.module,
      trackKey: project.track,
      summary: project.blockers.length
        ? `${project.blockers.length} blockers`
        : `${project.nextActions.length} next actions`,
      count: project.blockers.length || project.nextActions.length,
      statusBucket: project.statusBucket,
      // Rendered inline on the node so the overview stays legible with the
      // signal layer switched off.
      signals: contextSignals.map((signal) => ({ key: signal.key, count: signal.count })),
    });
    addEdge(`track:${project.track}`, projectNodeId, "track owns project", 1);
    if (project.module && nodesById.has(`module:${project.module}`)) {
      addEdge(`module:${project.module}`, projectNodeId, "module drives project", 5);
    }

    for (const signal of contextSignals) {
      const signalNodeId = `${projectNodeId}:${signal.key}`;
      addNode({
        id: signalNodeId,
        label: signal.label,
        kind: "context",
        contextGroup: signal.key,
        projectId: project.id,
        projectNodeId,
        path: project.sourceDocPath,
        summary: signal.summary,
        count: signal.count,
      });
      addEdge(projectNodeId, signalNodeId, `project connects ${signal.key}`, 4);
    }
  }

  for (const doc of moduleDocs) {
    const sourceModuleKey = getDocModuleKey(doc) || doc.path;
    const sourceMeta = getGraphDocMeta(doc, docsByPath);
    for (const targetPath of sourceMeta.outgoingPaths as Set<string>) {
      const targetDoc = docsByPath.get(targetPath);
      if (!targetDoc || targetDoc.docType !== "module") continue;
      const targetModuleKey = getDocModuleKey(targetDoc) || targetDoc.path;
      addEdge(`module:${sourceModuleKey}`, `module:${targetModuleKey}`, "module link", 3);
    }
  }

  const allEdges = Array.from(edgesById.values());
  const resolvedFocusId = nodesById.has(focusId) ? focusId : "overview";
  const visibleIds = new Set<string>();

  if (resolvedFocusId === "overview") {
    for (const node of nodesById.values()) visibleIds.add(node.id);
  } else {
    visibleIds.add(resolvedFocusId);
    for (const edge of allEdges) {
      if (edge.from === resolvedFocusId) visibleIds.add(edge.to);
      if (edge.to === resolvedFocusId) visibleIds.add(edge.from);
    }
    const focusKind = nodesById.get(resolvedFocusId)?.kind;
    if (focusKind === "track" || focusKind === "module" || focusKind === "client") {
      const firstHopIds = new Set(visibleIds);
      for (const edge of allEdges) {
        const fromNode = nodesById.get(edge.from);
        const toNode = nodesById.get(edge.to);
        if (firstHopIds.has(edge.from) && toNode?.kind === "context") visibleIds.add(edge.to);
        if (firstHopIds.has(edge.to) && fromNode?.kind === "context") visibleIds.add(edge.from);
      }
    }
  }

  // Layer switches hide whole node kinds; the focus itself always survives.
  const layerCounts = { track: 0, module: 0, client: 0, project: 0, context: 0 };
  for (const id of visibleIds) {
    const layer = getNodeLayer(nodesById.get(id));
    if (layer in layerCounts) layerCounts[layer] += 1;
  }
  for (const id of Array.from(visibleIds)) {
    if (id === resolvedFocusId) continue;
    if (!activeLayers.has(getNodeLayer(nodesById.get(id)))) visibleIds.delete(id);
  }

  const visibleEdges = allEdges
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .sort((a, b) => b.score - a.score);
  const visibleNodes = Array.from(nodesById.values()).filter((node) => visibleIds.has(node.id));

  const { canvasWidth, canvasHeight } =
    resolvedFocusId === "overview"
      ? layoutOverview(visibleNodes, activeLayers.has("context"))
      : layoutFocus(visibleNodes, nodesById.get(resolvedFocusId));

  const relationships = visibleEdges.map((edge) => {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    return {
      ...edge,
      fromNode,
      toNode,
      label: `${fromNode?.label || edge.from} -> ${toNode?.label || edge.to}`,
    };
  });

  return {
    focusId: resolvedFocusId,
    focusNode: resolvedFocusId === "overview" ? null : nodesById.get(resolvedFocusId),
    nodes: visibleNodes,
    edges: visibleEdges,
    relationships,
    canvasWidth,
    canvasHeight,
    layerCounts,
    projectCount: canonicalProjects.length,
    filteredProjectCount: graphProjects.length,
  };
}
