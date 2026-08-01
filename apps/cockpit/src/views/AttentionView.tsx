import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  FileClock,
  Inbox,
  RefreshCw,
  Scale,
  Sparkles,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import type { CommandPaletteBinding } from "../domain/command-palette";
import {
  OPERATOR_INBOX_KINDS,
  OPERATOR_INBOX_PRIORITIES,
  filterOperatorInbox,
  type ComposeOperatorInboxInput,
  type OperatorDestination,
  type OperatorInboxFilters,
  type OperatorInboxItem,
  type OperatorInboxKind,
  type OperatorInboxPriority,
} from "../domain/operator-inbox";
import { useOperatorAttentionValue } from "../hooks/useOperatorAttention";

const KIND_LABELS: Record<(typeof OPERATOR_INBOX_KINDS)[number], string> = {
  all: "All signals",
  project: "Projects",
  capture: "Captures",
  decision: "Decisions",
  question: "Questions",
  change: "Changes",
};

const PRIORITY_LABELS: Record<(typeof OPERATOR_INBOX_PRIORITIES)[number], string> = {
  all: "Any urgency",
  overdue: "Overdue",
  due: "Due today",
  blocked: "Blocked",
  review: "Review",
};

const ITEM_PRESENTATION: Record<
  OperatorInboxKind,
  { label: string; icon: typeof Inbox; accent: string }
> = {
  project: { label: "Project", icon: CalendarClock, accent: "text-primary" },
  capture: { label: "Capture", icon: Sparkles, accent: "text-track-sap" },
  decision: { label: "Decision", icon: Scale, accent: "text-status-waiting" },
  question: { label: "Question", icon: CircleHelp, accent: "text-status-waiting" },
  change: { label: "Change", icon: FileClock, accent: "text-status-done" },
};

interface AttentionViewProps {
  palette: CommandPaletteBinding;
  onCommand: () => void;
  onHub: () => void;
  onLibrary: () => void;
  onProjects: () => void;
  onGraph: () => void;
  /** Used for project filter labels; the signals themselves come from the
   * shared Attention state so the shell badge counts the same items. */
  projects: ComposeOperatorInboxInput["projects"];
  filters: OperatorInboxFilters;
  onFiltersChange: (filters: OperatorInboxFilters) => void;
  onOpenDestination: (destination: OperatorDestination) => void;
}

export function AttentionView({
  palette,
  onCommand,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  projects,
  filters,
  onFiltersChange,
  onOpenDestination,
}: AttentionViewProps) {
  const {
    items,
    counts,
    proposalStatus,
    proposalError,
    changeStatus,
    changeError,
    refreshChanges,
    retryFailed,
  } = useOperatorAttentionValue();
  const localLoading = proposalStatus === "loading" || changeStatus === "loading";
  const localFailed = proposalStatus === "error" || changeStatus === "error";
  const visibleItems = useMemo(() => filterOperatorInbox(items, filters), [filters, items]);
  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          items
            .filter((item) => item.projectId)
            .map((item) => [item.projectId as string, projectTitle(item, projects)]),
        ),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [items, projects],
  );

  function updateFilters(patch: Partial<OperatorInboxFilters>) {
    onFiltersChange({ ...filters, ...patch });
  }

  return (
    <OperatorFrame
      activeView="attention"
      title="Attention Inbox"
      commandBar={<CommandBar {...palette} />}
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className="mx-auto flex max-w-cockpit flex-col gap-6 px-4 py-8 md:px-8">
        <header className="relative overflow-hidden rounded-xl border border-primary/25 bg-surface-container-low p-6 md:p-8">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-primary-container/20 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-label-caps uppercase text-primary">
                <Inbox size={15} />
                One review queue
              </span>
              <h1 className="font-display text-display-lg text-on-surface">
                What needs your attention now?
              </h1>
              <p className="mt-3 max-w-3xl text-body-md leading-6 text-on-surface-variant">
                Projects, pending knowledge captures, decision reviews, open questions, and changed
                evidence—prioritized without leaving the local workspace.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface/80 px-4 py-3">
              <CheckCircle2 size={18} className="text-status-done" />
              <div>
                <div className="font-display text-headline-md text-on-surface">{counts.total}</div>
                <div className="text-metadata text-on-surface-variant">
                  signals in this workspace
                </div>
              </div>
            </div>
          </div>
        </header>

        <section aria-label="Attention summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryCard label="Overdue" value={counts.overdue} tone="blocked" />
          <SummaryCard label="Blocked" value={counts.blocked} tone="blocked" />
          <SummaryCard label="Review" value={counts.review} tone="waiting" />
          <SummaryCard label="Decisions" value={counts.decision} tone="primary" />
          <SummaryCard label="Changes" value={counts.change} tone="done" />
        </section>

        <section className="rounded-xl border border-border-subtle bg-surface-container-low p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
            <FilterGroup label="Signal type">
              {OPERATOR_INBOX_KINDS.map((kind) => (
                <FilterButton
                  key={kind}
                  label={KIND_LABELS[kind]}
                  active={filters.kind === kind}
                  onClick={() => updateFilters({ kind })}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Urgency">
              {OPERATOR_INBOX_PRIORITIES.map((priority) => (
                <FilterButton
                  key={priority}
                  label={PRIORITY_LABELS[priority]}
                  active={filters.priority === priority}
                  onClick={() => updateFilters({ priority })}
                />
              ))}
            </FilterGroup>
            <label className="text-metadata text-on-surface-variant">
              <span className="mb-2 block text-label-caps uppercase">Project</span>
              <select
                value={filters.projectId}
                onChange={(event) => updateFilters({ projectId: event.target.value })}
                className="h-10 w-full rounded border border-outline-variant bg-surface px-3 text-body-md text-on-surface outline-none focus:border-primary"
              >
                <option value="">All projects</option>
                {projectOptions.map(([projectId, title]) => (
                  <option key={projectId} value={projectId}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {(localLoading || localFailed) && (
          <SupplementStatus
            loading={localLoading}
            captureError={proposalStatus === "error" ? proposalError : ""}
            changeError={changeStatus === "error" ? changeError : ""}
            onRetry={retryFailed}
          />
        )}

        <section aria-labelledby="attention-results-title">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 id="attention-results-title" className="font-display text-headline-sm">
                Prioritized queue
              </h2>
              <p aria-live="polite" className="mt-1 text-body-md text-on-surface-variant">
                {visibleItems.length} of {items.length} signals shown
              </p>
            </div>
            <div className="flex items-center gap-3">
              {import.meta.env.DEV ? (
                <button
                  type="button"
                  onClick={() => void refreshChanges()}
                  disabled={changeStatus === "loading"}
                  className="inline-flex items-center gap-1.5 text-label-caps uppercase text-primary disabled:opacity-50"
                >
                  <RefreshCw
                    size={14}
                    className={changeStatus === "loading" ? "animate-spin" : undefined}
                  />
                  Refresh changes
                </button>
              ) : null}
              {(filters.kind !== "all" || filters.priority !== "all" || filters.projectId) && (
                <button
                  type="button"
                  onClick={() => onFiltersChange({ kind: "all", priority: "all", projectId: "" })}
                  className="text-label-caps uppercase text-primary"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  onOpen={() => onOpenDestination(item.destination)}
                />
              ))
            ) : (
              <div className="px-6 py-14 text-center">
                <CheckCircle2 className="mx-auto text-status-done" size={30} />
                <h3 className="mt-3 font-display text-headline-md text-on-surface">
                  No signals match
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-body-md text-on-surface-variant">
                  This filter combination is clear. Reset the filters to review the complete
                  workspace queue.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </OperatorFrame>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blocked" | "waiting" | "primary" | "done";
}) {
  const toneClass = {
    blocked: "text-status-blocked",
    waiting: "text-status-waiting",
    primary: "text-primary",
    done: "text-status-done",
  }[tone];
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-container p-4">
      <div className={`font-display text-headline-md ${toneClass}`}>{value}</div>
      <div className="mt-1 text-label-caps uppercase text-on-surface-variant">{label}</div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-metadata font-semibold transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-outline-variant bg-surface text-on-surface-variant hover:border-primary"
      }`}
    >
      {label}
    </button>
  );
}

function SupplementStatus({
  loading,
  captureError,
  changeError,
  onRetry,
}: {
  loading: boolean;
  captureError: string;
  changeError: string;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-container px-4 py-3 text-body-md text-on-surface-variant"
      >
        <RefreshCw size={17} className="animate-spin text-primary" />
        Checking pending captures and changed evidence…
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col justify-between gap-3 rounded-lg border border-status-waiting/35 bg-status-waiting/10 p-4 md:flex-row md:items-center"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-waiting" />
        <div>
          <div className="font-semibold text-on-surface">Some local signals are unavailable</div>
          <p className="mt-1 text-body-md text-on-surface-variant">
            {[captureError, changeError].filter(Boolean).join(" ")} Catalog-backed signals remain
            usable.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded border border-outline-variant bg-surface px-3 py-2 text-body-md font-semibold text-on-surface hover:border-primary"
      >
        <RefreshCw size={15} />
        Retry local signals
      </button>
    </div>
  );
}

function InboxRow({ item, onOpen }: { item: OperatorInboxItem; onOpen: () => void }) {
  const presentation = ITEM_PRESENTATION[item.kind];
  const Icon = presentation.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full gap-3 border-b border-border-subtle px-4 py-4 text-left transition last:border-b-0 hover:bg-surface-container-low md:grid-cols-[44px_minmax(0,1fr)_auto_24px] md:items-center md:px-5"
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-surface-container ${presentation.accent}`}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-headline-sm text-on-surface">{item.title}</span>
          <PriorityBadge priority={item.priority} />
        </span>
        <span className="mt-1 block text-body-md text-on-surface-variant">{item.summary}</span>
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-code-sm text-on-surface-variant">
          <span>{presentation.label}</span>
          {item.projectId ? <span>{item.projectId}</span> : null}
          {item.sourcePath ? <span className="truncate">{item.sourcePath}</span> : null}
        </span>
      </span>
      <span className="text-metadata text-on-surface-variant">
        {formatOccurredAt(item.occurredAt)}
      </span>
      <ArrowUpRight className="hidden text-on-surface-variant md:block" size={17} />
    </button>
  );
}

function PriorityBadge({ priority }: { priority: OperatorInboxPriority }) {
  const className = {
    overdue: "bg-status-blocked/15 text-status-blocked",
    due: "bg-status-waiting/15 text-status-waiting",
    blocked: "bg-status-blocked/15 text-status-blocked",
    review: "bg-primary/10 text-primary",
    info: "bg-status-done/10 text-status-done",
  }[priority];
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-metadata font-semibold capitalize ${className}`}
    >
      {priority}
    </span>
  );
}

function projectTitle(
  item: OperatorInboxItem,
  projects: ComposeOperatorInboxInput["projects"],
): string {
  return projects.find((project) => project.id === item.projectId)?.title || item.projectId || "";
}

function formatOccurredAt(value: string | null): string {
  if (!value) return "Open";
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : value;
}
