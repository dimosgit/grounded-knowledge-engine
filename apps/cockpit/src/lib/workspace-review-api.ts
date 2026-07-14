import type { WorkspaceReviewReport } from "../../../../tools/projects/types";

const WORKSPACE_REVIEW_PATH = "/__gke/review";
const CLIENT_TIMEOUT_MS = 10_000;

export async function getWorkspaceReview({
  asOf,
  since,
}: {
  asOf?: string;
  since?: string;
}): Promise<WorkspaceReviewReport> {
  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  if (since) query.set("since", since);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKSPACE_REVIEW_PATH}?${query}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not load the local workspace review.");
    }
    return payload.review;
  } finally {
    window.clearTimeout(timer);
  }
}
