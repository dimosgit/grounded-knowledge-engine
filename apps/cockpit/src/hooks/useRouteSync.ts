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
  setViewMode,
}) {
  useEffect(() => {
    function syncWithLocation() {
      const route = getAppRoute();
      if (route.mode === "hub") {
        setViewMode("hub");
        return;
      }
      if (route.mode === "projects") {
        setViewMode("projects");
        return;
      }
      if (route.mode === "project") {
        setSelectedProjectId(route.projectId || "");
        setViewMode("project");
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
    setViewMode,
  ]);
}
