import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  describeWorkspaceDisplay,
  type SafeWorkspaceIdentity,
  type WorkspaceContextState,
  type WorkspaceDisplay,
} from "../domain/workspace-display";

/**
 * Resolves the active workspace identity once per app session.
 *
 * The public build starts and stays in the compile-time `demo` state: the
 * `import.meta.env.DEV` guard becomes `false` at build time, so Rollup removes
 * the effect body along with the dynamic import of the local endpoint client.
 */
export function useWorkspaceDisplay(): WorkspaceDisplay {
  const [state, setState] = useState<WorkspaceContextState>(() =>
    import.meta.env.DEV ? { status: "loading" } : { status: "demo" },
  );
  // Strict Mode replays mount effects in development. Its second effect must
  // subscribe to the same in-flight request rather than starting another one.
  const workspaceRequest = useRef<Promise<SafeWorkspaceIdentity> | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    const request =
      workspaceRequest.current ??
      (workspaceRequest.current = import("../lib/workspace-context-api").then(
        ({ getWorkspaceIdentity }) => getWorkspaceIdentity(),
      ));

    void request
      .then((workspace) => {
        if (!cancelled) setState({ status: "ready", workspace });
      })
      .catch(() => {
        // The message is intentionally dropped: navigation stays usable and the
        // shell renders the fixed unavailable copy instead of any error detail.
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => describeWorkspaceDisplay(state), [state]);
}

/**
 * The shell remounts `OperatorFrame` on every route change, so the resolved
 * identity lives above the router and is read from context instead of being
 * fetched per mount. The default is the neutral loading model, which keeps the
 * shell geometry stable when a subtree renders without a provider.
 */
const WorkspaceDisplayContext = createContext<WorkspaceDisplay>(
  describeWorkspaceDisplay({ status: "loading" }),
);

export function WorkspaceDisplayProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspaceDisplay();
  return (
    <WorkspaceDisplayContext.Provider value={workspace}>
      {children}
    </WorkspaceDisplayContext.Provider>
  );
}

/** Renders a fixed workspace state without a request; used by tests. */
export function WorkspaceDisplayValueProvider({
  value,
  children,
}: {
  value: WorkspaceDisplay;
  children: ReactNode;
}) {
  return (
    <WorkspaceDisplayContext.Provider value={value}>{children}</WorkspaceDisplayContext.Provider>
  );
}

export function useWorkspaceDisplayValue(): WorkspaceDisplay {
  return useContext(WorkspaceDisplayContext);
}
