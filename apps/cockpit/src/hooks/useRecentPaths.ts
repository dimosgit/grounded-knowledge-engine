import { useEffect, useState } from "react";

const RECENT_PATHS_STORAGE_KEY = "learning-os.recent-paths";
const RECENT_PATHS_MAX = 12;

function loadRecentPaths() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PATHS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === "string");
  } catch {
    return [];
  }
}

export function useRecentPaths(activePath) {
  const [recentPaths, setRecentPaths] = useState(() => loadRecentPaths());

  useEffect(() => {
    if (!activePath) return;
    setRecentPaths((current) => {
      if (current[0] === activePath) return current;
      const next = [activePath, ...current.filter((path) => path !== activePath)];
      return next.slice(0, RECENT_PATHS_MAX);
    });
  }, [activePath]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENT_PATHS_STORAGE_KEY, JSON.stringify(recentPaths));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [recentPaths]);

  return recentPaths;
}
