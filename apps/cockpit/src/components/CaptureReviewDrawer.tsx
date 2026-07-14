import { useEffect, useState } from "react";
import { Check, Inbox, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import {
  applyCaptureProposal,
  CaptureReviewApiError,
  getCaptureProposal,
  rejectCaptureProposal,
  type CaptureAction,
  type CaptureProposalPreview,
  type CaptureProposalSummary,
} from "../lib/capture-review-api";

interface CaptureReviewDrawerProps {
  isOpen: boolean;
  proposals: CaptureProposalSummary[];
  selectedId: string | null;
  queueLoading: boolean;
  queueError: string;
  onOpen: (proposalId?: string | null) => void;
  onClose: () => void;
  onSelect: (proposalId: string) => void;
  onRefresh: (preferredId?: string | null) => Promise<void>;
}

export function CaptureReviewDrawer({
  isOpen,
  proposals,
  selectedId,
  queueLoading,
  queueError,
  onOpen,
  onClose,
  onSelect,
  onRefresh,
}: CaptureReviewDrawerProps) {
  const [preview, setPreview] = useState<CaptureProposalPreview | null>(null);
  const [action, setAction] = useState<CaptureAction | "">("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !selectedId) {
      setPreview(null);
      return;
    }
    let active = true;
    setPreviewLoading(true);
    setError("");
    void getCaptureProposal(selectedId)
      .then((value) => {
        if (!active) return;
        setPreview(value);
        setAction("");
      })
      .catch((requestError) => {
        if (active) setError(toMessage(requestError));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, selectedId]);

  async function submit(kind: "apply" | "reject") {
    if (!selectedId || (kind === "apply" && !action)) return;
    setSubmitting(true);
    setError("");
    try {
      if (kind === "apply") await applyCaptureProposal(selectedId, action as CaptureAction);
      else await rejectCaptureProposal(selectedId);
      await onRefresh(null);
    } catch (requestError) {
      const message = toMessage(requestError);
      setError(
        requestError instanceof CaptureReviewApiError && requestError.status === 409
          ? `${message} The proposal was retained; refresh and review the changed target.`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const proposal = preview?.proposal;
  const currentContent = preview?.preview.currentContent;
  const route = proposal?.routing;
  const loading = queueLoading || previewLoading;
  const visibleError = error || queueError;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(selectedId)}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-border-subtle bg-surface-container px-3 py-2 text-on-surface-variant hover:border-primary hover:text-primary"
        aria-label="Open capture review queue"
      >
        <Inbox size={16} />
        <span className="hidden text-body-md xl:inline">Capture review</span>
        {proposals.length > 0 && (
          <span className="rounded-full bg-primary-container px-2 py-0.5 text-xs text-on-primary-container">
            {proposals.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/65"
            aria-label="Close capture review queue"
            onClick={onClose}
          />
          <section className="relative flex h-full w-full max-w-6xl flex-col border-l border-border-subtle bg-background shadow-2xl">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-5">
              <div>
                <h2 className="font-display text-headline-md font-semibold">
                  Capture review queue
                </h2>
                <p className="text-metadata text-on-surface-variant">
                  Local proposals only · applying writes canonical Markdown
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-border-subtle p-2 text-on-surface-variant hover:text-primary"
                  onClick={() => void onRefresh(selectedId)}
                  aria-label="Refresh capture proposals"
                  disabled={loading}
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  type="button"
                  className="rounded border border-border-subtle p-2 text-on-surface-variant hover:text-primary"
                  onClick={onClose}
                  aria-label="Close capture review queue"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr]">
              <aside className="overflow-y-auto border-r border-border-subtle bg-surface-sidebar p-3">
                {proposals.map((item) => (
                  <button
                    key={item.proposalId}
                    type="button"
                    onClick={() => onSelect(item.proposalId)}
                    className={`mb-2 w-full rounded border p-3 text-left transition ${
                      selectedId === item.proposalId
                        ? "border-primary bg-surface-container-high"
                        : "border-border-subtle bg-surface-container hover:border-primary"
                    }`}
                  >
                    <div className="font-semibold text-on-surface">{item.title}</div>
                    <div className="mt-1 break-all font-mono text-xs text-on-surface-variant">
                      {item.path}
                    </div>
                    <div className="mt-2 text-xs uppercase text-on-surface-variant">
                      {item.proposedAction} · {item.reviewReasons.join(", ") || "manual review"}
                    </div>
                  </button>
                ))}
                {!loading && proposals.length === 0 && !visibleError && (
                  <div className="p-5 text-center text-body-md text-on-surface-variant">
                    No pending capture proposals.
                  </div>
                )}
              </aside>

              <div className="min-h-0 overflow-y-auto p-5">
                {loading && !proposal && (
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <LoaderCircle className="animate-spin" size={18} /> Loading capture review…
                  </div>
                )}
                {visibleError && (
                  <div
                    role="alert"
                    className="mb-4 rounded border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200"
                  >
                    {visibleError}
                  </div>
                )}
                {proposal && (
                  <div className="space-y-5">
                    <div className="rounded border border-border-subtle bg-surface-container p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-display text-headline-md font-semibold">
                            {proposal.proposedNote.title}
                          </h3>
                          <p className="font-mono text-xs text-on-surface-variant">
                            {proposal.proposedNote.path}
                          </p>
                        </div>
                        <span className="rounded bg-primary-container px-3 py-1 text-xs uppercase text-on-primary-container">
                          {route?.status || "unclassified route"}
                        </span>
                      </div>

                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                        <RouteValue
                          label="Track"
                          value={proposal.proposedNote.track}
                          source={route?.fields.track.source}
                        />
                        <RouteValue
                          label="Module"
                          value={proposal.proposedNote.module}
                          source={route?.fields.module.source}
                        />
                        <RouteValue
                          label="Project"
                          value={proposal.proposedNote.projectId}
                          source={route?.fields.projectId.source}
                        />
                      </dl>

                      <div className="mt-4 text-sm text-on-surface-variant">
                        Review: {proposal.reviewReasons.join(", ") || "operator requested"}
                      </div>
                      {proposal.duplicateCandidates.length > 0 && (
                        <div className="mt-3 rounded border border-amber-400/30 bg-amber-950/20 p-3 text-sm">
                          <div className="font-semibold text-amber-200">Possible duplicates</div>
                          {proposal.duplicateCandidates.map((candidate) => (
                            <div key={candidate.path} className="mt-1 text-amber-100/80">
                              {candidate.path} · score {candidate.score}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <PreviewPane
                        title={
                          preview.preview.targetExists
                            ? "Current Markdown"
                            : "Current Markdown (new file)"
                        }
                        content={currentContent ?? ""}
                      />
                      <PreviewPane
                        title="Proposed Markdown"
                        content={preview.preview.proposedContent}
                      />
                    </div>

                    <div className="rounded border border-border-subtle bg-surface-container p-4">
                      <div className="mb-3 text-sm font-semibold">Evidence</div>
                      {proposal.evidenceCitations.length ? (
                        proposal.evidenceCitations.map((citation) => (
                          <div
                            key={`${citation.path}:${citation.line || 0}`}
                            className="font-mono text-xs text-on-surface-variant"
                          >
                            {citation.path}
                            {citation.line ? `:${citation.line}` : ""}
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-on-surface-variant">
                          No evidence citations attached.
                        </div>
                      )}
                    </div>

                    <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle bg-background py-4">
                      <button
                        type="button"
                        onClick={() => void submit("reject")}
                        disabled={submitting}
                        className="flex items-center gap-2 rounded border border-red-500/40 px-4 py-2 text-red-300 disabled:opacity-50"
                      >
                        <Trash2 size={16} /> Reject
                      </button>
                      <label className="sr-only" htmlFor="capture-action">
                        Apply action
                      </label>
                      <select
                        id="capture-action"
                        value={action}
                        onChange={(event) => setAction(event.target.value as CaptureAction | "")}
                        className="rounded border border-border-subtle bg-surface-container px-3 py-2 text-on-surface"
                      >
                        <option value="">Choose explicit action…</option>
                        {allowedActions(
                          proposal.proposedNote.path,
                          preview.preview.targetExists,
                          proposal.proposedAction,
                        ).map((value) => (
                          <option key={value} value={value}>
                            {value.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void submit("apply")}
                        disabled={!action || submitting}
                        className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-45"
                      >
                        {submitting ? (
                          <LoaderCircle className="animate-spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                        Apply and refresh
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function RouteValue({ label, value, source }) {
  return (
    <div>
      <dt className="text-xs uppercase text-on-surface-variant">{label}</dt>
      <dd className="mt-1 font-mono text-xs">{value || "unresolved"}</dd>
      {source && (
        <dd className="text-xs text-on-surface-variant">via {source.replaceAll("_", " ")}</dd>
      )}
    </div>
  );
}

function PreviewPane({ title, content }) {
  return (
    <section className="min-w-0 rounded border border-border-subtle bg-surface-container">
      <h4 className="border-b border-border-subtle px-3 py-2 text-sm font-semibold">{title}</h4>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-on-surface-variant">
        {content || "—"}
      </pre>
    </section>
  );
}

function allowedActions(
  path: string,
  targetExists: boolean,
  proposedAction: CaptureAction,
): CaptureAction[] {
  if (path === "kb/open_questions.md") return ["open_question"];
  if (proposedAction === "delete") return ["delete"];
  return targetExists ? ["append", "replace"] : ["create"];
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Capture review request failed.";
}
