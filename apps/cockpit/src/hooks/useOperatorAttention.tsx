import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  composeOperatorInbox,
  countOperatorInbox,
  describeAttentionBadge,
  type ChangeInboxInput,
  type ComposeOperatorInboxInput,
  type OperatorActionRequest,
  type OperatorAttentionBadge,
  type OperatorInboxCounts,
  type OperatorInboxItem,
  type OperatorReviewAction,
} from "../domain/operator-inbox";
import type { CaptureProposalSummary } from "../lib/capture-review-api";
import type { WorkspaceReviewReport } from "../../../../tools/projects/types";

/** Days of changed-evidence history the Attention Inbox asks the engine for. */
const CHANGE_WINDOW_DAYS = 7;

/**
 * Explicit lifecycle instead of one ambiguous boolean: "idle" and "ready" both
 * mean "not loading", but only "ready" means the list on screen was fetched.
 */
export type OperatorAttentionStatus = "idle" | "loading" | "ready" | "error";

/**
 * The single client-side owner of pending capture proposals, changed evidence,
 * review-drawer requests, and the composed Attention view model. The shell
 * badge, the Attention Inbox, and the authoritative Capture Review drawer all
 * read this one contract, so they can never disagree or duplicate a request.
 *
 * This contract is navigation and read state only. Every write still happens
 * inside the review drawers through the existing application services.
 */
export interface OperatorAttention {
  proposals: CaptureProposalSummary[];
  selectedProposalId: string | null;
  proposalStatus: OperatorAttentionStatus;
  proposalError: string;
  changes: ChangeInboxInput[];
  changeStatus: OperatorAttentionStatus;
  changeError: string;
  /** Full, unfiltered Attention items; every consumer filters from these. */
  items: OperatorInboxItem[];
  counts: OperatorInboxCounts;
  badge: OperatorAttentionBadge;
  /** Pending request for an authoritative review drawer, if any. */
  request?: OperatorActionRequest;
  refreshProposals: (preferredId?: string | null) => Promise<void>;
  refreshChanges: () => Promise<void>;
  retryFailed: () => void;
  selectProposal: (proposalId: string | null) => void;
  requestCaptureReview: (proposalId?: string) => void;
  requestOperatorAction: (action: OperatorReviewAction, proposalId?: string) => void;
}

export interface UseOperatorAttentionInput {
  projects: ComposeOperatorInboxInput["projects"];
  decisions: ComposeOperatorInboxInput["decisions"];
  questions: ComposeOperatorInboxInput["questions"];
  /**
   * Changed evidence is the expensive signal, so it loads only where it is
   * shown rather than on every route.
   */
  changesActive: boolean;
}

export function useOperatorAttention({
  projects,
  decisions,
  questions,
  changesActive,
}: UseOperatorAttentionInput): OperatorAttention {
  const [proposals, setProposals] = useState<CaptureProposalSummary[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [proposalStatus, setProposalStatus] = useState<OperatorAttentionStatus>("idle");
  const [proposalError, setProposalError] = useState("");
  const [changes, setChanges] = useState<ChangeInboxInput[]>([]);
  const [changeStatus, setChangeStatus] = useState<OperatorAttentionStatus>("idle");
  const [changeError, setChangeError] = useState("");
  const [request, setRequest] = useState<OperatorActionRequest | undefined>();

  const mounted = useRef(true);
  // Monotonic tokens: only the newest request may write state, so a slow
  // earlier response can never overwrite a newer list.
  const proposalToken = useRef(0);
  const changeToken = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshProposals = useCallback(async (preferredId?: string | null) => {
    // Compile-time false in the public build, so Rollup removes this body
    // together with the dynamic import of the local endpoint client.
    if (!import.meta.env.DEV) return;
    const token = (proposalToken.current += 1);
    setProposalStatus("loading");
    setProposalError("");
    try {
      const { listCaptureProposals } = await import("../lib/capture-review-api");
      const next = await listCaptureProposals();
      if (!mounted.current || token !== proposalToken.current) return;
      setProposals(next);
      setSelectedProposalId((currentId) => resolveSelection(next, preferredId, currentId));
      setProposalStatus("ready");
    } catch (error) {
      if (!mounted.current || token !== proposalToken.current) return;
      // The previous list stays on screen: a failed refresh degrades the
      // freshness of the queue, it does not empty it.
      setProposalError(toMessage(error, "Could not load pending captures."));
      setProposalStatus("error");
    }
  }, []);

  const refreshChanges = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const token = (changeToken.current += 1);
    setChangeStatus("loading");
    setChangeError("");
    try {
      const { getWorkspaceReview } = await import("../lib/workspace-review-api");
      const review = await getWorkspaceReview({
        asOf: todayIso(),
        since: isoDateDaysAgo(CHANGE_WINDOW_DAYS),
      });
      if (!mounted.current || token !== changeToken.current) return;
      setChanges(flattenReviewChanges(review));
      setChangeStatus("ready");
    } catch (error) {
      if (!mounted.current || token !== changeToken.current) return;
      setChangeError(toMessage(error, "Could not load changed evidence."));
      setChangeStatus("error");
    }
  }, []);

  // Strict Mode replays mount effects in development; the first load is stored
  // so the replay observes the same request instead of starting a second one.
  const initialProposalLoad = useRef<Promise<void> | null>(null);
  const changesRequested = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    initialProposalLoad.current ??= refreshProposals();
    void initialProposalLoad.current;

    // Returning to the tab fires `visibilitychange` and `focus` together. Only
    // a real away -> back transition refreshes, so one return costs one
    // request, and no timer ever polls in the background.
    let away = false;
    const markAway = () => {
      away = true;
    };
    const handleReturn = () => {
      if (!away) return;
      away = false;
      void refreshProposals();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") markAway();
      else handleReturn();
    };

    window.addEventListener("blur", markAway);
    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshProposals]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!changesActive || changesRequested.current) return;
    changesRequested.current = true;
    void refreshChanges();
  }, [changesActive, refreshChanges]);

  const retryFailed = useCallback(() => {
    if (proposalStatus === "error") void refreshProposals();
    if (changeStatus === "error") void refreshChanges();
  }, [changeStatus, proposalStatus, refreshChanges, refreshProposals]);

  const selectProposal = useCallback((proposalId: string | null) => {
    setSelectedProposalId(proposalId);
  }, []);

  /**
   * Opening a review surface is navigation, not a mutation: the drawer still
   * owns every write and still asks before it makes one. A monotonic requestId
   * keeps repeat requests for the same action observable without colliding.
   */
  const requestOperatorAction = useCallback((action: OperatorReviewAction, proposalId?: string) => {
    setRequest((current) => ({ action, proposalId, requestId: (current?.requestId ?? 0) + 1 }));
  }, []);

  const requestCaptureReview = useCallback(
    (proposalId?: string) => requestOperatorAction("capture-review", proposalId),
    [requestOperatorAction],
  );

  // Derived views are memoized from the primitive source arrays; no filtered or
  // counted collection is ever stored as independent state.
  const items = useMemo(
    () => composeOperatorInbox({ projects, decisions, questions, captures: proposals, changes }),
    [changes, decisions, projects, proposals, questions],
  );
  const counts = useMemo(() => countOperatorInbox(items), [items]);
  const badge = useMemo(() => describeAttentionBadge(items.length), [items.length]);

  return useMemo(
    () => ({
      proposals,
      selectedProposalId,
      proposalStatus,
      proposalError,
      changes,
      changeStatus,
      changeError,
      items,
      counts,
      badge,
      request,
      refreshProposals,
      refreshChanges,
      retryFailed,
      selectProposal,
      requestCaptureReview,
      requestOperatorAction,
    }),
    [
      badge,
      changeError,
      changeStatus,
      changes,
      counts,
      items,
      proposalError,
      proposalStatus,
      proposals,
      refreshChanges,
      refreshProposals,
      request,
      requestCaptureReview,
      requestOperatorAction,
      retryFailed,
      selectProposal,
      selectedProposalId,
    ],
  );
}

/**
 * Keeps the current selection when it survived the refresh, honors an explicit
 * preference when that proposal exists, and otherwise falls back to the first
 * remaining proposal — or `null` once the queue is empty.
 */
function resolveSelection(
  proposals: CaptureProposalSummary[],
  preferredId: string | null | undefined,
  currentId: string | null,
): string | null {
  const requestedId = preferredId === null ? null : preferredId || currentId;
  const keepsRequested = Boolean(
    requestedId && proposals.some((proposal) => proposal.proposalId === requestedId),
  );
  return (keepsRequested ? requestedId : null) || proposals[0]?.proposalId || null;
}

const INERT_ATTENTION: OperatorAttention = {
  proposals: [],
  selectedProposalId: null,
  proposalStatus: "idle",
  proposalError: "",
  changes: [],
  changeStatus: "idle",
  changeError: "",
  items: [],
  counts: countOperatorInbox([]),
  badge: describeAttentionBadge(0),
  request: undefined,
  refreshProposals: async () => {},
  refreshChanges: async () => {},
  retryFailed: () => {},
  selectProposal: () => {},
  requestCaptureReview: () => {},
  requestOperatorAction: () => {},
};

/**
 * The shell remounts `OperatorFrame` on every route change, so Attention state
 * lives above the router and is read from context. The default is inert rather
 * than a second live owner: a subtree rendered without a provider shows an
 * empty queue instead of quietly issuing its own requests.
 */
const OperatorAttentionContext = createContext<OperatorAttention>(INERT_ATTENTION);

export function OperatorAttentionProvider({
  value,
  children,
}: {
  value: OperatorAttention;
  children: ReactNode;
}) {
  return (
    <OperatorAttentionContext.Provider value={value}>{children}</OperatorAttentionContext.Provider>
  );
}

export function useOperatorAttentionValue(): OperatorAttention {
  return useContext(OperatorAttentionContext);
}

function flattenReviewChanges(review: WorkspaceReviewReport): ChangeInboxInput[] {
  return review.projects.flatMap((project) =>
    project.changedDocuments.map((document) => ({
      path: document.path,
      title: document.title,
      changedAt: document.changedAt,
      source: document.source,
      projectId: project.projectId,
      projectTitle: project.title,
    })),
  );
}

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toMessage(error: unknown, fallback: string): string {
  // Local adapters can fail with transport or filesystem details. Attention
  // status is rendered in the shared shell, so keep it actionable without
  // reflecting a machine path or an adapter response into the browser.
  void error;
  return fallback;
}
