import { CheckCircle2, Eye, Save } from "lucide-react";
import { useState } from "react";
import type {
  DecisionEvidenceChangeRecord,
  DecisionRecord,
} from "../../../../tools/decisions/types";
import { submitDecisionReview, type DecisionReviewRequest } from "../lib/decision-review-api";

interface DecisionReviewPanelProps {
  decision: DecisionRecord;
  onApplied: () => void;
}

export function DecisionReviewPanel({ decision, onApplied }: DecisionReviewPanelProps) {
  const [reviewedAt, setReviewedAt] = useState(todayIso());
  const [reviewAfter, setReviewAfter] = useState(nextMonthIso());
  const [reviewer, setReviewer] = useState(decision.owner);
  const [support, setSupport] = useState<"yes" | "no" | "uncertain">("uncertain");
  const [assumptions, setAssumptions] = useState("");
  const [evidenceText, setEvidenceText] = useState(() =>
    decision.evidence.map((evidence) => `${evidence.path}:${evidence.line}@unchanged`).join("\n"),
  );
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<DecisionEvidenceChangeRecord[] | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [status, setStatus] = useState<"idle" | "previewing" | "applying" | "applied">("idle");
  const [error, setError] = useState("");

  const fingerprint = JSON.stringify({
    reviewedAt,
    reviewAfter,
    reviewer,
    support,
    assumptions,
    evidenceText,
    notes,
  });
  const previewCurrent = preview !== null && previewFingerprint === fingerprint;

  function buildRequest(dryRun: boolean): DecisionReviewRequest {
    return {
      decisionId: decision.decisionId,
      reviewedAt,
      reviewAfter,
      reviewer,
      recommendationSupported: support === "yes" ? true : support === "no" ? false : "uncertain",
      assumptionsNeedingValidation: assumptions
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      evidence: parseEvidenceLines(evidenceText),
      notes: notes.trim() || undefined,
      dryRun,
    };
  }

  async function previewReview() {
    setError("");
    setStatus("previewing");
    try {
      const result = await submitDecisionReview(buildRequest(true));
      setPreview(result.changes);
      setPreviewFingerprint(fingerprint);
      setStatus("idle");
    } catch (requestError) {
      setPreview(null);
      setStatus("idle");
      setError(toMessage(requestError));
    }
  }

  async function applyReview() {
    if (!previewCurrent) return;
    setError("");
    setStatus("applying");
    try {
      await submitDecisionReview(buildRequest(false));
      setStatus("applied");
      onApplied();
    } catch (requestError) {
      setStatus("idle");
      setError(toMessage(requestError));
    }
  }

  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-5">
      <h2 className="font-display text-headline-sm">Review with newer local evidence</h2>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Preview validates citations and computes the evidence diff without writing. Apply becomes
        available only while the form still matches that preview.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-body-md text-on-surface">
          <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
            Reviewed at
          </span>
          <input
            type="date"
            value={reviewedAt}
            onChange={(event) => setReviewedAt(event.target.value)}
            className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
          />
        </label>
        <label className="text-body-md text-on-surface">
          <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
            Next review after
          </span>
          <input
            type="date"
            value={reviewAfter}
            onChange={(event) => setReviewAfter(event.target.value)}
            className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
          />
        </label>
        <label className="text-body-md text-on-surface">
          <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
            Reviewer
          </span>
          <input
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
          />
        </label>
        <label className="text-body-md text-on-surface">
          <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
            Recommendation supported
          </span>
          <select
            value={support}
            onChange={(event) => setSupport(event.target.value as typeof support)}
            className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
          >
            <option value="uncertain">Uncertain</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      <label className="mt-4 block text-body-md text-on-surface">
        <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
          Evidence, one per line
        </span>
        <textarea
          value={evidenceText}
          onChange={(event) => setEvidenceText(event.target.value)}
          rows={4}
          className="w-full rounded border border-outline-variant bg-surface px-3 py-2 font-mono text-metadata"
          aria-describedby="decision-review-evidence-help"
        />
        <span
          id="decision-review-evidence-help"
          className="mt-1 block text-metadata text-on-surface-variant"
        >
          Format: path:line@classification. Add “ — note” when useful.
        </span>
      </label>

      <label className="mt-4 block text-body-md text-on-surface">
        <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
          Assumptions needing human validation
        </span>
        <textarea
          value={assumptions}
          onChange={(event) => setAssumptions(event.target.value)}
          rows={3}
          className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
          placeholder="One assumption per line"
        />
      </label>

      <label className="mt-4 block text-body-md text-on-surface">
        <span className="mb-1 block text-metadata font-semibold uppercase text-on-surface-variant">
          Review notes
        </span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="w-full rounded border border-outline-variant bg-surface px-3 py-2"
        />
      </label>

      {error && (
        <p className="mt-4 rounded border border-status-blocked/40 bg-status-blocked/10 p-3 text-body-md text-status-blocked">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded border border-border-subtle bg-surface p-4">
          <h3 className="font-semibold text-on-surface">Validated preview</h3>
          <ul className="mt-2 space-y-1 text-body-md text-on-surface-variant">
            {preview.map((change, index) => {
              const evidence = change.current || change.previous;
              return (
                <li key={`${change.classification}-${index}`}>
                  <strong className="text-primary">{change.classification}</strong>:{" "}
                  {evidence?.path}:{evidence?.line}
                </li>
              );
            })}
          </ul>
          {!previewCurrent && (
            <p className="mt-2 text-metadata text-status-waiting">
              The form changed after preview. Preview again before applying.
            </p>
          )}
        </div>
      )}

      {status === "applied" && (
        <p className="mt-4 flex items-center gap-2 rounded border border-status-done/40 bg-status-done/10 p-3 text-body-md text-status-done">
          <CheckCircle2 size={18} />
          Review appended to canonical Markdown.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void previewReview()}
          disabled={status === "previewing" || status === "applying"}
          className="flex items-center gap-2 rounded border border-primary px-4 py-2 text-label-caps font-semibold uppercase text-primary disabled:opacity-50"
        >
          <Eye size={17} />
          {status === "previewing" ? "Previewing…" : "Preview review"}
        </button>
        <button
          type="button"
          onClick={() => void applyReview()}
          disabled={!previewCurrent || status === "applying" || status === "applied"}
          className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Save size={17} />
          {status === "applying" ? "Applying…" : "Apply reviewed change"}
        </button>
      </div>
    </section>
  );
}

function parseEvidenceLines(value: string): DecisionReviewRequest["evidence"] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [citationAndClassification, notePart] = line.split(/\s+—\s+/, 2);
      const atIndex = citationAndClassification.lastIndexOf("@");
      const citation = atIndex >= 0 ? citationAndClassification.slice(0, atIndex) : "";
      const classification =
        atIndex >= 0 ? citationAndClassification.slice(atIndex + 1).trim() : "";
      const match = citation.match(/^(.+):([1-9]\d*)$/);
      if (!match) {
        throw new Error(`Invalid evidence line: ${line}`);
      }
      if (
        !["unchanged", "strengthened", "weakened", "contradicted", "new"].includes(classification)
      ) {
        throw new Error(`Invalid evidence classification: ${classification || "(missing)"}`);
      }
      return {
        path: match[1],
        line: Number.parseInt(match[2], 10),
        classification:
          classification as DecisionReviewRequest["evidence"][number]["classification"],
        note: notePart?.trim() || undefined,
      };
    });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextMonthIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Decision review request failed.";
}
