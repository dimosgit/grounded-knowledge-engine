import { ArrowRight, ArrowRightLeft, GripVertical, Link2 } from "lucide-react";

// Lanes a card can be moved to. Mirrors the board columns; "reference" clears
// the markdown lifecycle so the card reverts to the content-derived lane.
export const LANE_OPTIONS = [
  { value: "next", label: "Next Up" },
  { value: "active", label: "Active Now" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Completed" },
  { value: "reference", label: "Auto (from markdown)" },
];

const TRACK_BADGE = {
  demo: "border-track-demo/35 bg-track-demo/10 text-track-demo",
  ai: "border-track-ai/35 bg-track-ai/10 text-track-ai",
  "ai-tools": "border-track-ai/35 bg-track-ai/10 text-track-ai",
  "business-marketing": "border-track-biz/35 bg-track-biz/10 text-track-biz",
  finance: "border-track-biz/35 bg-track-biz/10 text-track-biz",
  product: "border-track-biz/35 bg-track-biz/10 text-track-biz",
};
const TRACK_BADGE_DEFAULT = "border-primary/35 bg-primary/10 text-primary";

const STATUS_BADGE = {
  active: {
    label: "Active",
    className: "border-status-done/45 bg-status-done/10 text-status-done",
  },
  blocked: {
    label: "Blocked",
    className: "border-status-blocked/45 bg-status-blocked/10 text-status-blocked",
  },
  next: {
    label: "Queued",
    className: "border-status-waiting/45 bg-status-waiting/10 text-status-waiting",
  },
  done: {
    label: "Completed",
    className: "border-status-done/45 bg-status-done/10 text-status-done",
  },
  reference: {
    label: "Reference",
    className: "border-outline-variant bg-surface-container-high text-on-surface-variant",
  },
};

export function ProjectCard({ project, onOpen, onMove }) {
  const canMove = typeof onMove === "function";
  const tone =
    project.statusBucket === "blocked"
      ? "border-status-blocked/60 bg-status-blocked/5"
      : project.statusBucket === "done"
        ? "border-status-done bg-status-done/10"
        : project.statusBucket === "active"
          ? "border-status-done/55 bg-status-done/5"
          : "border-status-waiting/55 bg-status-waiting/5";

  const trackClassName = TRACK_BADGE[project.track] || TRACK_BADGE_DEFAULT;
  const status = STATUS_BADGE[project.statusBucket] || STATUS_BADGE.reference;
  const actionLabel =
    project.statusBucket === "done"
      ? "Completed"
      : project.glance?.nextActions?.[0] || project.glance?.blocker || "Review project context";

  return (
    <article
      className={`group rounded-lg border ${tone} p-4 shadow-sm shadow-black/10 transition hover:-translate-y-0.5 hover:border-primary/70 ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
      draggable={canMove}
      onDragStart={(event) => {
        if (!canMove) return;
        event.dataTransfer.setData("text/plain", project.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canMove && (
            <GripVertical
              size={15}
              className="shrink-0 text-on-surface-variant/60 group-hover:text-on-surface-variant"
              aria-hidden="true"
            />
          )}
          <span
            className={`inline-flex max-w-full items-center rounded border px-2 py-0.5 font-mono text-code-sm uppercase ${trackClassName}`}
          >
            <span className="truncate">{project.trackLabel || project.track}</span>
          </span>
          <span
            className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 font-mono text-code-sm uppercase ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        <span className="shrink-0 rounded bg-surface-container-high px-2 py-0.5 font-mono text-code-sm uppercase text-on-surface-variant">
          {project.updated || "live"}
        </span>
      </div>
      <h3 className="mb-2 line-clamp-2 font-display text-body-md font-semibold text-on-surface">
        {project.title}
      </h3>
      <p className="mb-3 line-clamp-2 text-metadata leading-5 text-on-surface-variant">
        {project.glance?.startHere || project.currentStatus}
      </p>
      <div className="rounded border border-border-subtle bg-surface/70 p-3">
        <div className="mb-1 flex items-center gap-2 text-code-sm uppercase text-on-surface-variant">
          <ArrowRight size={14} />
          {project.statusBucket === "done" ? "Status" : "Next Task"}
        </div>
        <p className="line-clamp-2 text-body-md text-on-surface">{actionLabel}</p>
      </div>
      {typeof project.progressPercent === "number" && project.taskCounts?.total > 0 && (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-status-done"
              style={{
                width: `${project.statusBucket === "done" ? 100 : project.progressPercent}%`,
              }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-code-sm text-on-surface-variant">
            <span>
              {project.taskCounts.done}/{project.taskCounts.total} tasks
            </span>
            <span>{project.statusBucket === "done" ? 100 : project.progressPercent}%</span>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center gap-2 rounded border border-outline-variant px-3 py-2 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary"
          type="button"
          onClick={() => onOpen(project.id)}
        >
          <Link2 size={15} />
          Open Context
        </button>
        {canMove && (
          <label className="relative ml-auto flex items-center text-on-surface-variant opacity-0 transition-opacity duration-150 hover:text-on-surface group-hover:opacity-100 focus-within:opacity-100">
            <span className="sr-only">Move {project.title} to lane</span>
            <ArrowRightLeft
              size={14}
              className="pointer-events-none absolute left-2"
              aria-hidden="true"
            />
            <select
              className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-7 pr-2 text-code-sm text-current hover:bg-surface-container focus:bg-surface-container focus:outline-none focus:ring-1 focus:ring-primary"
              value={project.statusBucket}
              onChange={(event) => onMove(project.id, event.target.value)}
              title="Move to lane"
            >
              {LANE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </article>
  );
}
