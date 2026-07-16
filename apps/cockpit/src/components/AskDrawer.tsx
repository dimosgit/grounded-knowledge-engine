import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
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

const DEMO_QUESTIONS = [
  { label: "Demo Card status", question: "What is the Demo Card status?" },
  { label: "Demo Card owner", question: "What is the Demo Card owner?" },
];

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

  function chooseDemoQuestion(nextQuestion: string) {
    setQuestion(nextQuestion);
    setAnswer(null);
    setCapture(null);
    setError("");
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

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

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

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex justify-end"
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
            <section className="grounded-ask-panel relative flex h-full w-full max-w-2xl flex-col border-l border-border-subtle bg-background shadow-2xl">
              <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-5">
                <div>
                  <h2
                    id="grounded-ask-title"
                    className="font-display text-headline-md font-semibold"
                  >
                    Ask local knowledge
                  </h2>
                  <p className="text-metadata text-on-surface-variant">
                    Grounded in {scopeLabel} · capture is always explicit
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
                <form
                  onSubmit={submitQuestion}
                  className="rounded border border-border-subtle bg-surface-container p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <label htmlFor="grounded-question" className="font-semibold">
                      What do you need to know?
                    </label>
                    <span className="rounded bg-surface-container-high px-2 py-1 font-mono text-xs text-on-surface-variant">
                      Scope: {scopeLabel}
                    </span>
                  </div>
                  <textarea
                    id="grounded-question"
                    aria-label="Question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={3}
                    placeholder="Ask a specific question about the available local evidence…"
                    className="w-full resize-y rounded border border-border-subtle bg-surface-container p-3 text-on-surface outline-none focus:border-primary"
                  />
                  {!projectId && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-on-surface-variant">Try the demo:</span>
                      {DEMO_QUESTIONS.map((example) => (
                        <button
                          key={example.question}
                          type="button"
                          onClick={() => chooseDemoQuestion(example.question)}
                          className="rounded border border-border-subtle px-2 py-1 text-xs font-medium text-on-surface-variant hover:border-primary hover:text-primary"
                        >
                          {example.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="submit"
                      aria-label="Ask local knowledge"
                      disabled={!question.trim() || asking}
                      className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-45"
                    >
                      {asking ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : (
                        <Search size={16} />
                      )}
                      Get grounded answer
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
                  <div className="mt-5 space-y-4">
                    <section className="rounded border border-border-subtle bg-surface-container p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                            {answer.abstained ? "No verified answer" : "Answer"}
                          </div>
                          <p className="mt-1 text-sm text-on-surface-variant">
                            {answer.abstained
                              ? "The strict evidence gate did not find enough support for a reliable answer."
                              : "Extracted directly from the best-matching local source."}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            label={`Confidence: ${answer.confidence.label} (${answer.confidence.score})`}
                            positive={answer.confidence.label === "high"}
                          />
                          <StatusBadge
                            label={
                              answer.gate.pass ? "Evidence gate passed" : "Evidence gate failed"
                            }
                            positive={answer.gate.pass}
                          />
                        </div>
                      </div>
                      <div className="grounded-answer-content mt-5 text-sm leading-6 text-on-surface">
                        {answer.answer}
                      </div>
                    </section>

                    <details className="rounded border border-border-subtle bg-surface-container p-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Why this answer is grounded
                      </summary>
                      <div className="mt-3 space-y-3 text-sm text-on-surface-variant">
                        {answer.confidence.rationale && <p>{answer.confidence.rationale}</p>}
                        {!answer.gate.pass && answer.gate.reasons.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-amber-200">
                            {answer.gate.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        )}
                        {answer.tokenUsage && (
                          <p className="border-t border-border-subtle pt-3 font-mono text-xs">
                            Visible tokens: {answer.tokenUsage.kind === "estimate" ? "~" : ""}
                            {answer.tokenUsage.totalTokens} · request{" "}
                            {answer.tokenUsage.requestTokens}
                            {" · evidence "}
                            {answer.tokenUsage.evidenceTokens}
                            {" · answer "}
                            {answer.tokenUsage.answerTokens}
                            {answer.tokenUsage.kind === "estimate" ? " (estimate)" : ""}
                          </p>
                        )}
                      </div>
                    </details>

                    <details className="rounded border border-border-subtle bg-surface-container p-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        View sources ({answer.citations.length})
                      </summary>
                      {answer.citations.length > 0 ? (
                        <div className="mt-3 space-y-2">
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
                        <p className="mt-3 text-sm text-on-surface-variant">
                          No citations returned.
                        </p>
                      )}
                    </details>

                    <details className="rounded border border-border-subtle bg-surface-container p-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        View retrieved excerpts ({answer.evidence.length})
                      </summary>
                      {answer.evidence.length > 0 ? (
                        <div className="mt-3 space-y-2">
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
                        <p className="mt-3 text-sm text-on-surface-variant">
                          No evidence returned.
                        </p>
                      )}
                    </details>

                    {!answer.abstained && (
                      <section className="rounded border border-primary/40 bg-primary-container/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">Keep this answer</h3>
                            <p className="mt-1 text-xs text-on-surface-variant">
                              Clear captures save immediately; ambiguous ones stay in review.
                            </p>
                          </div>
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
                        <label
                          htmlFor="grounded-capture-title"
                          className="mt-4 block text-sm font-semibold"
                        >
                          Note title
                        </label>
                        <input
                          id="grounded-capture-title"
                          value={captureTitle}
                          onChange={(event) => setCaptureTitle(event.target.value)}
                          className="mt-2 w-full rounded border border-border-subtle bg-background px-3 py-2 text-on-surface outline-none focus:border-primary"
                        />
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
          </div>,
          document.body,
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
