import { useCallback, useEffect, useState } from "react";
import type { CaptureProposalSummary } from "../lib/capture-review-api";
import type { WorkspaceReviewReport } from "../../../../tools/projects/types";

export interface AttentionChange {
  path: string;
  title: string;
  changedAt: string;
  source: string;
  projectId: string;
  projectTitle: string;
}

interface SupplementState {
  captures: CaptureProposalSummary[];
  changes: AttentionChange[];
  captureError: string;
  changeError: string;
  loading: boolean;
}

const EMPTY_STATE: SupplementState = {
  captures: [],
  changes: [],
  captureError: "",
  changeError: "",
  loading: false,
};

export function useOperatorAttentionSupplement(enabled: boolean) {
  const [state, setState] = useState<SupplementState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    if (!enabled || !import.meta.env.DEV) return;
    setState((current) => ({
      ...current,
      captureError: "",
      changeError: "",
      loading: true,
    }));

    const [{ listCaptureProposals }, { getWorkspaceReview }] = await Promise.all([
      import("../lib/capture-review-api"),
      import("../lib/workspace-review-api"),
    ]);
    const [capturesResult, reviewResult] = await Promise.allSettled([
      listCaptureProposals(),
      getWorkspaceReview({
        asOf: todayIso(),
        since: isoDateDaysAgo(7),
      }),
    ]);

    setState({
      captures: capturesResult.status === "fulfilled" ? capturesResult.value : [],
      changes: reviewResult.status === "fulfilled" ? flattenReviewChanges(reviewResult.value) : [],
      captureError:
        capturesResult.status === "rejected"
          ? toMessage(capturesResult.reason, "Could not load pending captures.")
          : "",
      changeError:
        reviewResult.status === "rejected"
          ? toMessage(reviewResult.reason, "Could not load changed evidence.")
          : "",
      loading: false,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { ...state, refresh };
}

function flattenReviewChanges(review: WorkspaceReviewReport): AttentionChange[] {
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
  return error instanceof Error && error.message ? error.message : fallback;
}
