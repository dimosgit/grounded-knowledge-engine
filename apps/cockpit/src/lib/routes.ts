import {
  isOperatorInboxKind,
  isOperatorInboxPriority,
  sanitizeOperatorProjectFilter,
  type OperatorInboxFilters,
} from "../domain/operator-inbox";

export interface AppRoute {
  mode: string | null;
  path: string | null;
  areaId?: string;
  inboxKind?: OperatorInboxFilters["kind"];
  inboxPriority?: OperatorInboxFilters["priority"];
  inboxProjectId?: string;
  attentionFilter?: string;
  projectId?: string;
  projectSection?: string;
  decisionFilter?: string;
  decisionId?: string;
  focusPath?: string;
}

export function normalizePathname(pathname) {
  if (!pathname) return "/";
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

export function getHashRoute(): AppRoute {
  const hash = window.location.hash;
  const hashPath = normalizePathname(hash.slice(1).split("?")[0] || "/");
  if (hashPath === "/areas") {
    return { mode: "areas", path: null };
  }
  if (hash.startsWith("#/focus/")) {
    return getAreaRoute(hash, "#/focus/", "focus");
  }
  if (hash.startsWith("#/explore/")) {
    return getAreaRoute(hash, "#/explore/", "explore");
  }
  if (hashPath === "/hub") {
    return { mode: "hub", path: null };
  }
  if (hashPath === "/attention") {
    const queryString = hash.slice(1).split("?")[1] || "";
    const query = new URLSearchParams(queryString);
    const requestedKind = query.get("kind") || "all";
    const requestedPriority = query.get("priority") || "all";
    return {
      mode: "attention",
      path: null,
      inboxKind: isOperatorInboxKind(requestedKind) ? requestedKind : "all",
      inboxPriority: isOperatorInboxPriority(requestedPriority) ? requestedPriority : "all",
      inboxProjectId: sanitizeOperatorProjectFilter(query.get("project") || ""),
    };
  }
  if (hashPath === "/projects") {
    const queryString = hash.slice(1).split("?")[1] || "";
    const requestedFilter = new URLSearchParams(queryString).get("attention") || "";
    const attentionFilter = [
      "all",
      "needs-attention",
      "overdue",
      "blocked",
      "open-questions",
    ].includes(requestedFilter)
      ? requestedFilter
      : "";
    return { mode: "projects", path: null, attentionFilter };
  }
  if (hashPath === "/decisions") {
    const queryString = hash.slice(1).split("?")[1] || "";
    const requestedFilter = new URLSearchParams(queryString).get("filter") || "";
    const decisionFilter = [
      "all",
      "current",
      "due",
      "overdue",
      "proposed",
      "active",
      "superseded",
      "rejected",
    ].includes(requestedFilter)
      ? requestedFilter
      : "";
    return { mode: "decisions", path: null, decisionFilter };
  }
  if (hashPath === "/graph") {
    const queryString = hash.slice(1).split("?")[1] || "";
    const focusPath = new URLSearchParams(queryString).get("focus") || "";
    return { mode: "graph", path: null, focusPath };
  }
  if (hash.startsWith("#/project/")) {
    try {
      const encodedProjectId = hash.slice("#/project/".length).split("?")[0];
      const queryString = hash.slice(1).split("?")[1] || "";
      const requestedSection = new URLSearchParams(queryString).get("section") || "";
      return {
        mode: "project",
        projectId: decodeURIComponent(encodedProjectId),
        projectSection: requestedSection === "delivery-checklist" ? requestedSection : "",
        path: null,
      };
    } catch {
      return { mode: null, path: null };
    }
  }
  if (hash.startsWith("#/decision/")) {
    try {
      const encodedDecisionId = hash.slice("#/decision/".length).split("?")[0];
      return { mode: "decision", decisionId: decodeURIComponent(encodedDecisionId), path: null };
    } catch {
      return { mode: null, path: null };
    }
  }
  if (!hash.startsWith("#/doc/")) {
    return { mode: null, path: null };
  }
  try {
    const encodedDocPath = hash.slice("#/doc/".length).split("?")[0];
    return { mode: "doc", path: decodeURIComponent(encodedDocPath) };
  } catch {
    return { mode: null, path: null };
  }
}

export function getAppRoute(): AppRoute {
  const hashRoute = getHashRoute();
  if (hashRoute.mode) {
    return hashRoute;
  }

  return { mode: null, path: null };
}

function getAreaRoute(hash, prefix, mode): AppRoute {
  try {
    const areaId = decodeURIComponent(hash.slice(prefix.length).split("?")[0]).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(areaId)) return { mode: null, path: null };
    return { mode, areaId, path: null };
  } catch {
    return { mode: null, path: null };
  }
}

export function getHashPath() {
  const route = getHashRoute();
  return route.mode === "doc" ? route.path : null;
}

export function setHashPath(path) {
  window.location.hash = `/doc/${encodeURIComponent(path)}`;
}

export function setHashHub() {
  window.location.hash = "/hub";
}

export function setHashAreas() {
  window.location.hash = "/areas";
}

export function setHashFocus(areaId) {
  window.location.hash = `/focus/${encodeURIComponent(areaId)}`;
}

export function setHashAreaExplore(areaId) {
  window.location.hash = `/explore/${encodeURIComponent(areaId)}`;
}

export function setHashAttention(filters: OperatorInboxFilters) {
  const query = new URLSearchParams();
  if (filters.kind !== "all") query.set("kind", filters.kind);
  if (filters.priority !== "all") query.set("priority", filters.priority);
  const projectId = sanitizeOperatorProjectFilter(filters.projectId);
  if (projectId) query.set("project", projectId);
  const queryString = query.toString();
  window.location.hash = queryString ? `/attention?${queryString}` : "/attention";
}

export function setHashProjects(attentionFilter = "") {
  window.location.hash = attentionFilter
    ? `/projects?attention=${encodeURIComponent(attentionFilter)}`
    : "/projects";
}

export function setHashGraph(focusPath = "") {
  window.location.hash = focusPath ? `/graph?focus=${encodeURIComponent(focusPath)}` : "/graph";
}

export function setHashProject(projectId, section = "") {
  const sectionQuery = section === "delivery-checklist" ? "?section=delivery-checklist" : "";
  window.location.hash = `/project/${encodeURIComponent(projectId)}${sectionQuery}`;
}

export function setHashDecisions(decisionFilter = "") {
  window.location.hash =
    decisionFilter && decisionFilter !== "all"
      ? `/decisions?filter=${encodeURIComponent(decisionFilter)}`
      : "/decisions";
}

export function setHashDecision(decisionId) {
  window.location.hash = `/decision/${encodeURIComponent(decisionId)}`;
}
