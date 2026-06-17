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
  const outgoingPaths = new Set(
    getSectionLinks(doc.content)
      .map((link) => resolveMarkdownHref(link.href, doc.path, docsByPath))
      .filter(Boolean),
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
    searchableText: `${doc.title}\n${doc.path}\n${doc.content}`.toLowerCase(),
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
  if (focusMeta.moduleKey && candidateMeta.moduleKey && focusMeta.moduleKey === candidateMeta.moduleKey) {
    score += 5;
    reasons.push(`same module: ${focusMeta.moduleKey}`);
  }

  const focusModulePath = focusMeta.moduleKey ? `kb/modules/${focusMeta.moduleKey}.md` : "";
  const candidateModulePath = candidateMeta.moduleKey ? `kb/modules/${candidateMeta.moduleKey}.md` : "";
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
    for (const targetPath of sourceMeta.outgoingPaths) {
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
  const projectOptions = projectSummaries.map((project) => ({
    id: `project:${project.id}`,
    label: project.title,
    kind: "Project",
    projectId: project.id,
    path: project.sourceDocPath,
    searchText: `${project.title} ${project.sourceDocPath} ${project.trackLabel} ${project.module}`,
  }));

  return [
    { id: "overview", label: "All major contexts", kind: "Overview", searchText: "overview all major contexts" },
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
  return getMajorGraphFocusOptions(docs, projectSummaries, tracks).find((option) => option.id === focusId) || null;
}

export function buildMajorContextGraph(docs, projectSummaries, tracks, focusId = "overview") {
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
    const moduleDocsCount = docs.filter((item) => getDocModuleKey(item) === moduleKey && item.path !== doc.path).length;
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
      count: docs.filter((item) => item.content.includes(doc.path)).length,
    });
    addEdge(`track:${doc.track}`, `client:${doc.path}`, "track owns client", 2);
  }

  for (const project of projectSummaries) {
    addNode({
      id: `project:${project.id}`,
      label: project.title,
      kind: "project",
      path: project.sourceDocPath,
      projectId: project.id,
      moduleKey: project.module,
      trackKey: project.track,
      summary: project.blockers.length ? `${project.blockers.length} blockers` : `${project.nextActions.length} next actions`,
      count: project.blockers.length || project.nextActions.length,
      statusBucket: project.statusBucket,
    });
    addEdge(`track:${project.track}`, `project:${project.id}`, "track owns project", 1);
    if (project.module && nodesById.has(`module:${project.module}`)) {
      addEdge(`module:${project.module}`, `project:${project.id}`, "module drives project", 5);
    }
  }

  for (const doc of moduleDocs) {
    const sourceModuleKey = getDocModuleKey(doc) || doc.path;
    const sourceMeta = getGraphDocMeta(doc, docsByPath);
    for (const targetPath of sourceMeta.outgoingPaths) {
      const targetDoc = docsByPath.get(targetPath);
      if (!targetDoc || targetDoc.docType !== "module") continue;
      const targetModuleKey = getDocModuleKey(targetDoc) || targetDoc.path;
      addEdge(`module:${sourceModuleKey}`, `module:${targetModuleKey}`, "module link", 3);
    }
  }

  const allEdges = Array.from(edgesById.values());
  const resolvedFocusId = nodesById.has(focusId) ? focusId : "overview";
  const visibleIds = new Set();

  if (resolvedFocusId === "overview") {
    for (const node of nodesById.values()) visibleIds.add(node.id);
  } else {
    visibleIds.add(resolvedFocusId);
    for (const edge of allEdges) {
      if (edge.from === resolvedFocusId) visibleIds.add(edge.to);
      if (edge.to === resolvedFocusId) visibleIds.add(edge.from);
    }
  }

  const visibleEdges = allEdges
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .sort((a, b) => b.score - a.score);
  const visibleNodes = Array.from(nodesById.values()).filter((node) => visibleIds.has(node.id));

  if (resolvedFocusId === "overview") {
    const grouped = {
      track: visibleNodes.filter((node) => node.kind === "track"),
      module: visibleNodes.filter((node) => node.kind === "module" || node.kind === "client"),
      project: visibleNodes.filter((node) => node.kind === "project"),
    };
    const columns = [
      { kind: "track", x: 16 },
      { kind: "module", x: 48 },
      { kind: "project", x: 80 },
    ];

    for (const column of columns) {
      const items = grouped[column.kind] || [];
      const step = Math.min(11, Math.max(6, 70 / Math.max(items.length, 1)));
      const start = 18;
      items.forEach((node, index) => {
        node.x = column.x;
        node.y = Math.min(88, start + index * step);
      });
    }
  } else {
    const focusNode = nodesById.get(resolvedFocusId);
    if (focusNode) {
      focusNode.x = 50;
      focusNode.y = 50;
    }
    const neighbors = visibleNodes.filter((node) => node.id !== resolvedFocusId);
    const radiusX = 33;
    const radiusY = 34;
    neighbors.forEach((node, index) => {
      const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / Math.max(neighbors.length, 1);
      node.x = 50 + Math.cos(angle) * radiusX;
      node.y = 50 + Math.sin(angle) * radiusY;
    });
  }

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
  };
}
