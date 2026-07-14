import { useState } from "react";
import { CalendarClock, FileClock } from "lucide-react";
import { getWorkspaceReview } from "../lib/workspace-review-api";
import type { WorkspaceReviewReport } from "../../../../tools/projects/types";

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function LocalProjectDelta({ onOpenDoc }) {
  const [since, setSince] = useState(() => isoDateDaysAgo(7));
  const [review, setReview] = useState<WorkspaceReviewReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadChanges(event) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const nextReview = await getWorkspaceReview({
        asOf: new Date().toISOString().slice(0, 10),
        since,
      });
      setReview(nextReview);
    } catch (loadError) {
      setReview(null);
      setError(
        loadError instanceof Error ? loadError.message : "Could not load workspace changes.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  const changes = (review?.projects || []).flatMap((project) =>
    project.changedDocuments.map((document) => ({
      ...document,
      projectId: project.projectId,
      projectTitle: project.title,
    })),
  );

  return (
    <section
      aria-labelledby="local-project-delta-title"
      className="rounded-lg border border-border-subtle bg-surface-container-low p-5"
    >
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2
            id="local-project-delta-title"
            className="flex items-center gap-2 font-display text-headline-sm"
          >
            <FileClock size={20} className="text-primary" />
            Local project changes
          </h2>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Explicitly scoped project documents changed since a selected date.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={loadChanges}>
          <label className="text-metadata text-on-surface-variant">
            <span className="mb-1 block">Changed since</span>
            <span className="flex items-center gap-2 rounded border border-outline-variant bg-surface px-3 py-2">
              <CalendarClock size={15} />
              <input
                aria-label="Changed since"
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                value={since}
                onChange={(event) => setSince(event.target.value)}
                className="bg-transparent font-mono text-code-sm text-on-surface outline-none"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded bg-primary px-4 py-2.5 text-label-caps font-semibold uppercase text-on-primary disabled:opacity-55"
          >
            {isLoading ? "Loading…" : "Load changes"}
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded border border-status-blocked/35 p-3 text-body-md">
          {error}
        </p>
      )}

      {review && (
        <div className="mt-5 space-y-2">
          <p className="text-metadata text-on-surface-variant">
            {changes.length} changed document{changes.length === 1 ? "" : "s"} since {since}
          </p>
          {changes.map((change) => (
            <button
              key={`${change.projectId}:${change.path}`}
              type="button"
              onClick={() => onOpenDoc(change.path)}
              className="flex w-full flex-col gap-2 rounded border border-border-subtle bg-surface p-3 text-left hover:border-primary md:flex-row md:items-center md:justify-between"
            >
              <span>
                <span className="block text-body-md font-semibold text-on-surface">
                  {change.title}
                </span>
                <span className="block text-metadata text-on-surface-variant">
                  {change.projectTitle} · {change.path}:{change.citation.line}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-code-sm">
                <span className="rounded bg-surface-container-high px-2 py-1 text-primary">
                  {change.source}
                </span>
                <span className="text-on-surface-variant">{change.changedAt.slice(0, 10)}</span>
              </span>
            </button>
          ))}
          {!changes.length && (
            <p className="rounded border border-dashed border-border-subtle p-4 text-body-md text-on-surface-variant">
              No explicitly scoped project documents changed in this window.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
