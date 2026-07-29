import { useCallback, useEffect, useState } from "react";
import type { MarkdownContentLoader } from "../lib/content-loader";

interface MarkdownBodyState {
  status: "idle" | "loading" | "ready" | "error";
  body: string;
  error: string;
}

const IDLE_STATE: MarkdownBodyState = { status: "idle", body: "", error: "" };

export function useMarkdownBody(
  loader: MarkdownContentLoader,
  path: string,
  enabled = true,
): MarkdownBodyState & { retry: () => void } {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<MarkdownBodyState>(IDLE_STATE);

  useEffect(() => {
    if (!enabled || !path) {
      setState(IDLE_STATE);
      return;
    }

    let active = true;
    setState({ status: "loading", body: "", error: "" });
    void loader
      .load(path)
      .then((body) => {
        if (active) setState({ status: "ready", body, error: "" });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          body: "",
          error: error instanceof Error ? error.message : "The Markdown document could not load.",
        });
      });

    return () => {
      active = false;
    };
  }, [enabled, loader, path, retryVersion]);

  const retry = useCallback(() => setRetryVersion((current) => current + 1), []);
  return { ...state, retry };
}
