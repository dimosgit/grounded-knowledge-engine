import { useCallback, useEffect, useState } from "react";
import {
  RECENT_DESTINATIONS_STORAGE_KEY,
  addRecentDestinationId,
  parseRecentDestinationIds,
  serializeRecentDestinationIds,
} from "../domain/command-palette";

function loadRecentDestinationIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentDestinationIds(window.localStorage.getItem(RECENT_DESTINATIONS_STORAGE_KEY));
  } catch {
    // Blocked storage must never break navigation; the palette just has no recents.
    return [];
  }
}

/**
 * Bounded, versioned recall of the last places the operator navigated to.
 * Only canonical command-palette entry ids are persisted — never queries,
 * Markdown bodies, or machine paths.
 */
export function useRecentDestinations() {
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentDestinationIds);

  const rememberDestination = useCallback((id: string) => {
    setRecentIds((current) => addRecentDestinationId(current, id));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        RECENT_DESTINATIONS_STORAGE_KEY,
        serializeRecentDestinationIds(recentIds),
      );
    } catch {
      // Ignore storage write failures (private mode, quota, blocked storage).
    }
  }, [recentIds]);

  return { recentIds, rememberDestination };
}
