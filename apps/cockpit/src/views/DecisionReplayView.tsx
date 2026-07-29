import { AlertTriangle, ArrowLeft, GitCompareArrows, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { DecisionRecord } from "../../../../tools/decisions/types";
import { CommandBar } from "../components/CommandBar";
import { DecisionReviewPanel } from "../components/DecisionReviewPanel";
import { OperatorFrame } from "../components/OperatorFrame";
import { buildDecisionEvidenceChanges, type DecisionSummary } from "../domain/decisions";

interface CommandDoc {
  path: string;
  title: string;
  searchIndex: string;
  searchIndexNormalized: string;
  searchIndexCompact: string;
}

interface DecisionReplayViewProps {
  docs: CommandDoc[];
  commandBarOpen: boolean;
  onCommandBarOpenChange: (open: boolean) => void;
  onCommand: () => void;
  onCommandSelect: (item: CommandDoc) => void;
  onHub: () => void;
  onLibrary: () => void;
  onProjects: () => void;
  onGraph: () => void;
  summary: DecisionSummary | null;
  decision: DecisionRecord | null;
  bodyStatus: string;
  bodyError: string;
  onRetryBody: () => void;
  onReviewApplied: () => void;
  onBack: () => void;
  onOpenDoc: (path: string) => void;
}

export function DecisionReplayView({
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  summary,
  decision,
  bodyStatus,
  bodyError,
  onRetryBody,
  onReviewApplied,
  onBack,
  onOpenDoc,
}: DecisionReplayViewProps) {
  const [showReviewGuide, setShowReviewGuide] = useState(false);
  const changes = decision ? buildDecisionEvidenceChanges(decision) : [];

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
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-2 text-body-md font-semibold text-primary"
        >
          <ArrowLeft size={17} />
          Decision Ledger
        </button>

        {!summary ? (
          <div className="rounded-lg border border-border-subtle bg-surface p-8">
            <h1 className="font-display text-headline-md">Decision not found</h1>
            <p className="mt-2 text-body-md text-on-surface-variant">
              This route does not match a canonical decision in the synced workspace.
            </p>
          </div>
        ) : bodyStatus === "loading" || bodyStatus === "idle" ? (
          <div className="rounded-lg border border-border-subtle bg-surface p-8" role="status">
            Loading the canonical decision…
          </div>
        ) : bodyStatus === "error" || !decision ? (
          <div className="rounded-lg border border-status-blocked/50 bg-status-blocked/10 p-6">
            <h1 className="font-display text-headline-md">Decision could not be parsed</h1>
            <p className="mt-2 text-body-md text-on-surface-variant">{bodyError}</p>
            <button
              type="button"
              onClick={onRetryBody}
              className="mt-4 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <header className="flex flex-col justify-between gap-5 border-b border-border-subtle pb-6 lg:flex-row lg:items-start">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-outline-variant px-2.5 py-1 text-metadata font-semibold capitalize">
                    {decision.status}
                  </span>
                  <span className="rounded-full border border-outline-variant px-2.5 py-1 text-metadata font-semibold capitalize">
                    {decision.confidence} confidence
                  </span>
                </div>
                <h1 className="font-display text-display-lg text-on-surface">{decision.title}</h1>
                <p className="mt-2 font-mono text-metadata text-on-surface-variant">
                  {decision.decisionId} · {decision.projectId || "workspace-wide"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewGuide((current) => !current)}
                aria-expanded={showReviewGuide}
                className="flex items-center justify-center gap-2 rounded bg-primary px-4 py-3 text-label-caps font-semibold uppercase text-on-primary"
              >
                <RefreshCw size={17} />
                Review what changed
              </button>
            </header>

            {decision.reviewState !== "current" && (
              <div className="flex items-start gap-3 rounded-lg border border-status-waiting/50 bg-status-waiting/10 p-4">
                <AlertTriangle className="mt-0.5 shrink-0 text-status-waiting" size={19} />
                <p className="text-body-md text-on-surface">
                  <strong>
                    {decision.reviewState === "overdue" ? "Stale decision." : "Review due."}
                  </strong>{" "}
                  Evidence was checked on {decision.evidenceCheckedAt}; review was scheduled for{" "}
                  {decision.reviewAfter}. Revalidate before presenting this recommendation as
                  current.
                </p>
              </div>
            )}

            {showReviewGuide &&
              (import.meta.env.DEV ? (
                <DecisionReviewPanel
                  key={decision.decisionId}
                  decision={decision}
                  onApplied={onReviewApplied}
                />
              ) : (
                <section className="rounded-lg border border-primary/40 bg-primary/5 p-5">
                  <h2 className="font-display text-headline-sm">
                    Review with newer local evidence
                  </h2>
                  <p className="mt-2 text-body-md text-on-surface-variant">
                    The public preview is read-only. In a local GKE workspace, this panel validates
                    a review before appending it to canonical Markdown. MCP and CLI review commands
                    remain available for automation.
                  </p>
                </section>
              ))}

            <section className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-lg border border-border-subtle bg-surface p-5 lg:col-span-2">
                <h2 className="text-label-caps uppercase text-on-surface-variant">
                  Decision question
                </h2>
                <p className="mt-3 text-headline-sm text-on-surface">{decision.question}</p>
                <h2 className="mt-6 text-label-caps uppercase text-on-surface-variant">
                  Recommendation
                </h2>
                <p className="mt-3 text-body-lg text-on-surface">{decision.recommendation}</p>
                <h2 className="mt-6 text-label-caps uppercase text-on-surface-variant">
                  Rationale
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-body-md text-on-surface-variant">
                  {decision.rationale}
                </p>
              </div>
              <dl className="rounded-lg border border-border-subtle bg-surface-container-low p-5 text-body-md">
                <div className="mb-4">
                  <dt className="text-metadata uppercase text-on-surface-variant">Owner</dt>
                  <dd className="mt-1 font-semibold">{decision.owner}</dd>
                </div>
                <div className="mb-4">
                  <dt className="text-metadata uppercase text-on-surface-variant">Decided</dt>
                  <dd className="mt-1 font-semibold">{decision.decidedAt}</dd>
                </div>
                <div className="mb-4">
                  <dt className="text-metadata uppercase text-on-surface-variant">
                    Evidence checked
                  </dt>
                  <dd className="mt-1 font-semibold">{decision.evidenceCheckedAt}</dd>
                </div>
                <div>
                  <dt className="text-metadata uppercase text-on-surface-variant">Next review</dt>
                  <dd className="mt-1 font-semibold">{decision.reviewAfter}</dd>
                </div>
              </dl>
            </section>

            <section>
              <div className="mb-4 flex items-center gap-2">
                <GitCompareArrows size={20} className="text-primary" />
                <h2 className="font-display text-headline-md">Evidence replay</h2>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-lg border border-border-subtle bg-surface p-5">
                  <h3 className="font-display text-headline-sm">Original snapshot</h3>
                  <p className="mt-1 text-metadata text-on-surface-variant">
                    Preserved from {decision.evidenceCheckedAt}
                  </p>
                  <ul className="mt-4 space-y-3">
                    {decision.evidence.length ? (
                      decision.evidence.map((evidence) => (
                        <li key={`${evidence.path}:${evidence.line}`}>
                          <button
                            type="button"
                            onClick={() => onOpenDoc(evidence.path)}
                            className="w-full rounded border border-border-subtle bg-surface-container-low p-3 text-left hover:border-primary"
                          >
                            <span className="block font-mono text-metadata text-primary">
                              {evidence.path}:{evidence.line}
                            </span>
                            <span className="mt-1 block text-body-md text-on-surface-variant">
                              {evidence.section}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="text-body-md text-on-surface-variant">
                        No evidence citations recorded.
                      </li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface p-5">
                  <h3 className="font-display text-headline-sm">What changed</h3>
                  <p className="mt-1 text-metadata text-on-surface-variant">
                    Classified review evidence; the original snapshot remains unchanged.
                  </p>
                  <ul className="mt-4 space-y-3">
                    {changes.length ? (
                      changes.map((change, index) => (
                        <li
                          key={`${change.classification}-${index}`}
                          className="rounded border border-border-subtle bg-surface-container-low p-3"
                        >
                          <span className="text-metadata font-semibold uppercase text-primary">
                            {change.classification}
                          </span>
                          <p className="mt-1 text-body-md text-on-surface-variant">
                            {change.evidence}
                          </p>
                        </li>
                      ))
                    ) : (
                      <li className="text-body-md text-on-surface-variant">
                        No classified review changes recorded yet.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-border-subtle bg-surface p-5">
                <h2 className="font-display text-headline-sm">Assumptions</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-body-md text-on-surface-variant">
                  {decision.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface p-5">
                <h2 className="font-display text-headline-sm">Risks and caveats</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-body-md text-on-surface-variant">
                  {decision.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-lg border border-border-subtle bg-surface p-5">
              <h2 className="font-display text-headline-sm">Decision timeline</h2>
              <ol className="mt-4 space-y-3 border-l border-border-subtle pl-5 text-body-md text-on-surface-variant">
                <li>
                  <strong className="text-on-surface">{decision.decidedAt}</strong> — decision
                  recorded with {decision.evidence.length} evidence citation
                  {decision.evidence.length === 1 ? "" : "s"}.
                </li>
                {decision.reviewHistory.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
                {decision.supersession.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </OperatorFrame>
  );
}
