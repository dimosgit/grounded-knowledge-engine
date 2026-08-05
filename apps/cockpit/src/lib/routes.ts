import {
  isOperatorInboxKind,
  isOperatorInboxPriority,
  sanitizeOperatorProjectFilter,
  type OperatorInboxFilters,
} from "../domain/operator-inbox";

export function normalizePathname(pathname) {
  if (!pathname) return "/";
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

export function getHashRoute() {
  const hash = window.location.hash;
  const hashPath = normalizePathname(hash.slice(1).split("?")[0] || "/");
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

export function getAppRoute() {
  const hashRoute = getHashRoute();
  if (hashRoute.mode) {
    return hashRoute;
  }

  return { mode: null, path: null };
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
