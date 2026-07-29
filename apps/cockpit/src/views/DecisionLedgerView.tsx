import { AlertTriangle, ChevronRight, Search } from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import {
  DECISION_LEDGER_FILTERS,
  type DecisionLedgerFilter,
  type DecisionSummary,
} from "../domain/decisions";

interface CommandDoc {
  path: string;
  title: string;
  searchIndex: string;
  searchIndexNormalized: string;
  searchIndexCompact: string;
}

interface DecisionLedgerViewProps {
  docs: CommandDoc[];
  commandBarOpen: boolean;
  onCommandBarOpenChange: (open: boolean) => void;
  onCommand: () => void;
  onCommandSelect: (item: CommandDoc) => void;
  onHub: () => void;
  onLibrary: () => void;
  onProjects: () => void;
  onGraph: () => void;
  decisions: DecisionSummary[];
  counts: Record<string, number>;
  filter: DecisionLedgerFilter;
  onFilterChange: (filter: DecisionLedgerFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenDecision: (decisionId: string) => void;
}

export function DecisionLedgerView({
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  decisions,
  counts,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onOpenDecision,
}: DecisionLedgerViewProps) {
  return (
    <OperatorFrame
      activeView="decisions"
      title="Decision Replay"
      commandBar={
        <CommandBar
          items={docs}
          isOpen={commandBarOpen}
          onOpenChange={onCommandBarOpenChange}
          onSelect={onCommandSelect}
        />
      }
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className="mx-auto flex max-w-cockpit flex-col gap-6 px-4 py-8 md:px-8">
        <header className="flex flex-col justify-between gap-4 border-b border-border-subtle pb-6 md:flex-row md:items-end">
          <div>
            <h1 className="font-display text-display-lg text-on-surface">Decision Ledger</h1>
            <p className="mt-2 max-w-3xl text-body-md text-on-surface-variant">
              Reuse prior recommendations, see when their evidence was checked, and review stale
              conclusions before acting on them.
            </p>
          </div>
          <div className="rounded border border-border-subtle bg-surface-container px-4 py-3 text-body-md">
            <span className="font-semibold text-on-surface">{decisions.length}</span>{" "}
            <span className="text-on-surface-variant">visible decisions</span>
          </div>
        </header>

        {(counts.overdue > 0 || counts.due > 0) && (
          <div className="flex items-start gap-3 rounded-lg border border-status-waiting/50 bg-status-waiting/10 p-4">
            <AlertTriangle className="mt-0.5 shrink-0 text-status-waiting" size={19} />
            <div>
              <div className="font-semibold text-on-surface">Evidence review needs attention</div>
              <p className="mt-1 text-body-md text-on-surface-variant">
                {counts.overdue} overdue and {counts.due} due today. Stale means review is required;
                it does not mean the recorded recommendation is automatically wrong.
              </p>
            </div>
          </div>
        )}

        <section className="rounded-lg border border-border-subtle bg-surface-container-low p-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
              size={17}
            />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="w-full rounded border border-outline-variant bg-surface py-2.5 pl-10 pr-3 text-body-md text-on-surface outline-none focus:border-primary"
              placeholder="Search decisions, projects, owners, or tags"
              aria-label="Search decisions"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Decision filters">
            {DECISION_LEDGER_FILTERS.map((item) => {
              const count = item.key === "all" ? null : counts[item.key] || 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={filter === item.key}
                  onClick={() => onFilterChange(item.key)}
                  className={`rounded-full border px-3 py-1.5 text-metadata font-semibold ${
                    filter === item.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant bg-surface text-on-surface-variant hover:border-primary"
                  }`}
                >
                  {item.label}
                  {count !== null ? ` ${count}` : ""}
                </button>
              );
            })}
          </div>
        </section>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <div className="hidden grid-cols-[minmax(260px,2fr)_1fr_120px_130px_120px_36px] gap-4 border-b border-border-subtle bg-surface-container-low px-5 py-3 text-label-caps uppercase text-on-surface-variant lg:grid">
            <span>Decision</span>
            <span>Project</span>
            <span>Status</span>
            <span>Evidence</span>
            <span>Review</span>
            <span />
          </div>
          {decisions.length ? (
            decisions.map((decision) => (
              <button
                key={decision.decisionId}
                type="button"
                onClick={() => onOpenDecision(decision.decisionId)}
                className="grid w-full gap-3 border-b border-border-subtle px-5 py-4 text-left transition last:border-b-0 hover:bg-surface-container-low lg:grid-cols-[minmax(260px,2fr)_1fr_120px_130px_120px_36px] lg:items-center lg:gap-4"
              >
                <span>
                  <span className="block font-display text-headline-sm text-on-surface">
                    {decision.title}
                  </span>
                  <span className="mt-1 block font-mono text-metadata text-on-surface-variant">
                    {decision.decisionId}
                  </span>
                </span>
                <span className="text-body-md text-on-surface-variant">
                  {decision.projectId || "Workspace"}
                </span>
                <span className="w-fit rounded-full border border-outline-variant px-2.5 py-1 text-metadata font-semibold capitalize text-on-surface">
                  {decision.status}
                </span>
                <span className="text-body-md text-on-surface-variant">
                  {decision.evidenceCheckedAt}
                </span>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-metadata font-semibold capitalize ${
                    decision.reviewState === "overdue"
                      ? "bg-status-blocked/15 text-status-blocked"
                      : decision.reviewState === "due"
                        ? "bg-status-waiting/15 text-status-waiting"
                        : "bg-status-done/15 text-status-done"
                  }`}
                >
                  {decision.reviewState}
                </span>
                <ChevronRight className="hidden text-on-surface-variant lg:block" size={18} />
              </button>
            ))
          ) : (
            <div className="px-6 py-14 text-center">
              <h2 className="font-display text-headline-md">No decisions match</h2>
              <p className="mt-2 text-body-md text-on-surface-variant">
                Change the filter or search, or record a decision through the local CLI or MCP full
                profile.
              </p>
            </div>
          )}
        </div>
      </div>
    </OperatorFrame>
  );
}
