import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpenCheck, Check, LoaderCircle, Search, X } from "lucide-react";
import {
  askGrounded,
  captureGroundedAnswer,
  type GroundedAnswer,
  type GroundedCaptureResult,
} from "../lib/grounded-ask-api";

interface AskDrawerProps {
  projectId?: string;
  projectTitle?: string;
  onCapture?: (capture: GroundedCaptureResult) => void;
  onReviewProposal?: (proposalId: string) => void;
}

export function AskDrawer({
  projectId,
  projectTitle,
  onCapture,
  onReviewProposal,
}: AskDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answeredQuestion, setAnsweredQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [capture, setCapture] = useState<GroundedCaptureResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || asking) return;

    setAsking(true);
    setError("");
    setAnswer(null);
    setCapture(null);
    try {
      const next = await askGrounded(normalizedQuestion, projectId ? { projectId } : {});
      setAnswer(next);
      setAnsweredQuestion(normalizedQuestion);
      setCaptureTitle(defaultCaptureTitle(normalizedQuestion));
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setAsking(false);
    }
  }

  function reviewProposedCapture() {
    const proposalId = capture?.proposal?.proposalId;
    if (!proposalId) return;
    setIsOpen(false);
    onReviewProposal?.(proposalId);
  }

  const scopeLabel = projectId ? `${projectTitle || "Project"} (${projectId})` : "Workspace";

  async function submitCapture() {
    const normalizedTitle = captureTitle.trim();
    if (!answer || answer.abstained || !answeredQuestion || !normalizedTitle || capturing) return;

    setCapturing(true);
    setError("");
    try {
      const next = await captureGroundedAnswer({
        question: answeredQuestion,
        title: normalizedTitle,
        kind: "topic",
        ...(projectId ? { projectId } : {}),
      });
      setCapture(next);
      onCapture?.(next);
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-border-subtle bg-surface-container px-3 py-2 text-on-surface-variant hover:border-primary hover:text-primary"
        aria-label="Ask grounded knowledge"
      >
        <Search size={16} />
        <span className="hidden text-body-md xl:inline">Ask</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[80] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="grounded-ask-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/65"
            aria-label="Close grounded Ask"
            onClick={() => setIsOpen(false)}
          />
          <section className="relative flex h-full w-full max-w-3xl flex-col border-l border-border-subtle bg-background shadow-2xl">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-5">
              <div>
                <h2 id="grounded-ask-title" className="font-display text-headline-md font-semibold">
                  Grounded Ask
                </h2>
                <p className="text-metadata text-on-surface-variant">
                  Answers from local evidence · capture is always explicit
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-border-subtle p-2 text-on-surface-variant hover:text-primary"
                onClick={() => setIsOpen(false)}
                aria-label="Close grounded Ask"
              >
                <X size={18} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <form onSubmit={submitQuestion} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <label htmlFor="grounded-question" className="font-semibold">
                    Question
                  </label>
                  <span className="font-normal text-on-surface-variant">Scope: {scopeLabel}</span>
                </div>
                <textarea
                  id="grounded-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={3}
                  placeholder="Ask a question about the local knowledge base…"
                  className="w-full resize-y rounded border border-border-subtle bg-surface-container p-3 text-on-surface outline-none focus:border-primary"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!question.trim() || asking}
                    className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-45"
                  >
                    {asking ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                    Ask local knowledge
                  </button>
                </div>
              </form>

              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200"
                >
                  {error}
                </div>
              )}

              {answer && (
                <div className="mt-6 space-y-5">
                  <section className="rounded border border-border-subtle bg-surface-container p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={`Confidence: ${answer.confidence.label} (${answer.confidence.score})`}
                        positive={answer.confidence.label === "high"}
                      />
                      <StatusBadge
                        label={answer.gate.pass ? "Evidence gate passed" : "Evidence gate failed"}
                        positive={answer.gate.pass}
                      />
                      {answer.abstained && (
                        <span className="rounded bg-amber-950/40 px-2 py-1 text-xs text-amber-200">
                          Answer withheld
                        </span>
                      )}
                    </div>
                    {answer.confidence.rationale && (
                      <p className="mb-3 text-sm text-on-surface-variant">
                        {answer.confidence.rationale}
                      </p>
                    )}
                    {!answer.gate.pass && answer.gate.reasons.length > 0 && (
                      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-amber-200">
                        {answer.gate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-on-surface">
                      {answer.answer}
                    </pre>
                    {answer.tokenUsage && (
                      <p className="mt-3 border-t border-border-subtle pt-3 font-mono text-xs text-on-surface-variant">
                        Token usage: {answer.tokenUsage.kind === "estimate" ? "~" : ""}
                        {answer.tokenUsage.totalTokens} visible tokens · request{" "}
                        {answer.tokenUsage.requestTokens}
                        {" · evidence "}
                        {answer.tokenUsage.evidenceTokens}
                        {" · answer "}
                        {answer.tokenUsage.answerTokens}
                        {answer.tokenUsage.kind === "estimate" ? " (estimate)" : ""}
                      </p>
                    )}
                  </section>

                  <section className="rounded border border-border-subtle bg-surface-container p-4">
                    <h3 className="mb-3 text-sm font-semibold">Citations</h3>
                    {answer.citations.length > 0 ? (
                      <div className="space-y-2">
                        {answer.citations.map((citation) => (
                          <div
                            key={`${citation.path}:${citation.line}`}
                            className="break-all font-mono text-xs text-on-surface-variant"
                          >
                            {citation.path}:{citation.line}
                            {citation.score === undefined ? "" : ` · score ${citation.score}`}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-on-surface-variant">No citations returned.</p>
                    )}
                  </section>

                  <section className="rounded border border-border-subtle bg-surface-container p-4">
                    <h3 className="mb-3 text-sm font-semibold">Evidence</h3>
                    {answer.evidence.length > 0 ? (
                      <div className="space-y-2">
                        {answer.evidence.map((item, index) => (
                          <details
                            key={`${item.path}:${item.lineNumber}:${index}`}
                            className="rounded border border-border-subtle bg-background p-3"
                          >
                            <summary className="cursor-pointer text-sm font-semibold">
                              {item.title || item.path}
                              <span className="ml-2 font-mono text-xs font-normal text-on-surface-variant">
                                {item.path}:{item.lineNumber} · score {item.score}
                              </span>
                            </summary>
                            <p className="mt-3 whitespace-pre-wrap text-sm text-on-surface-variant">
                              {item.snippet || "No evidence excerpt returned."}
                            </p>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-on-surface-variant">No evidence returned.</p>
                    )}
                  </section>

                  {!answer.abstained && (
                    <section className="rounded border border-border-subtle bg-surface-container p-4">
                      <label htmlFor="grounded-capture-title" className="text-sm font-semibold">
                        Capture title
                      </label>
                      <input
                        id="grounded-capture-title"
                        value={captureTitle}
                        onChange={(event) => setCaptureTitle(event.target.value)}
                        className="mt-2 w-full rounded border border-border-subtle bg-background px-3 py-2 text-on-surface outline-none focus:border-primary"
                      />
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-on-surface-variant">
                          Clear captures may be created immediately; ambiguous captures enter
                          review.
                        </p>
                        <button
                          type="button"
                          onClick={() => void submitCapture()}
                          disabled={!captureTitle.trim() || capturing || Boolean(capture)}
                          className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-45"
                        >
                          {capturing ? (
                            <LoaderCircle className="animate-spin" size={16} />
                          ) : capture ? (
                            <Check size={16} />
                          ) : (
                            <BookOpenCheck size={16} />
                          )}
                          Capture answer
                        </button>
                      </div>
                      {capture && (
                        <div
                          role="status"
                          className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-primary"
                        >
                          <span>
                            {capture.action === "created"
                              ? `Captured to ${capture.path}.`
                              : `Queued for review at ${capture.path}.`}
                          </span>
                          {capture.action === "proposed" && capture.proposal?.proposalId && (
                            <button
                              type="button"
                              onClick={reviewProposedCapture}
                              className="inline-flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 font-semibold hover:bg-primary-container hover:text-on-primary-container"
                            >
                              Review now <ArrowRight size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function StatusBadge({ label, positive }: { label: string; positive: boolean }) {
  return (
    <span
      className={`rounded px-2 py-1 text-xs ${
        positive
          ? "bg-emerald-950/40 text-emerald-200"
          : "bg-surface-container-high text-on-surface-variant"
      }`}
    >
      {label}
    </span>
  );
}

function defaultCaptureTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim().replace(/\?+$/, "");
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}...`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Grounded Ask request failed.";
}
