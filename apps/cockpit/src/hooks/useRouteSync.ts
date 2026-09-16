import { useEffect } from "react";
import { getAppRoute } from "../lib/routes";

export function useRouteSync({
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
  setSelectedAreaId,
  setViewMode,
  areaIds = [],
}) {
  useEffect(() => {
    function syncWithLocation() {
      const route = getAppRoute();
      if (route.mode === "hub") {
        setViewMode("hub");
        return;
      }
      if (route.mode === "areas") {
        setSelectedAreaId("");
        setViewMode("areas");
        return;
      }
      if (route.mode === "focus" || route.mode === "explore") {
        if (!areaIds.includes(route.areaId)) {
          setSelectedAreaId("");
          setViewMode("areas");
          return;
        }
        setSelectedAreaId(route.areaId);
        setViewMode(route.mode);
        return;
      }
      if (route.mode === "attention") {
        setInboxKind(route.inboxKind || "all");
        setInboxPriority(route.inboxPriority || "all");
        setInboxProjectId(route.inboxProjectId || "");
        setViewMode("attention");
        return;
      }
      if (route.mode === "projects") {
        if (route.attentionFilter) setProjectAttentionFilter(route.attentionFilter);
        setViewMode("projects");
        return;
      }
      if (route.mode === "project") {
        setSelectedProjectId(route.projectId || "");
        setViewMode("project");
        return;
      }
      if (route.mode === "decisions") {
        if (route.decisionFilter) setDecisionLedgerFilter(route.decisionFilter);
        setViewMode("decisions");
        return;
      }
      if (route.mode === "decision") {
        setSelectedDecisionId(route.decisionId || "");
        setViewMode("decision");
        return;
      }
      if (route.mode === "graph") {
        if (route.focusPath) setSelectedGraphPath(route.focusPath);
        setViewMode("graph");
        return;
      }

      if (route.mode !== "doc" || !route.path) {
        return;
      }

      const targetDoc = docs.find((doc) => doc.path === route.path);
      if (!targetDoc) return;
      setViewMode("library");
      setActiveTrack(targetDoc.track);
      setActiveItemType("all");
      setActiveTag("all");
      setActivePath(targetDoc.path);
    }

    window.addEventListener("hashchange", syncWithLocation);
    window.addEventListener("popstate", syncWithLocation);
    syncWithLocation();
    return () => {
      window.removeEventListener("hashchange", syncWithLocation);
      window.removeEventListener("popstate", syncWithLocation);
    };
  }, [
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
    setSelectedAreaId,
    setViewMode,
    areaIds,
  ]);
}
