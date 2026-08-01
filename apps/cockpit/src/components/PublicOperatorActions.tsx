import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenCheck, Inbox, Terminal, X } from "lucide-react";
import type { OperatorActionRequest, OperatorReviewAction } from "../domain/operator-inbox";
import { useModalSurface } from "../hooks/useModalSurface";

interface PublicOperatorActionsProps {
  request?: OperatorActionRequest;
}

const ACTION_COPY: Record<
  OperatorReviewAction,
  { title: string; summary: string; icon: typeof BookOpenCheck }
> = {
  ask: {
    title: "Ask grounded knowledge",
    summary: "Ground answers in your local Markdown knowledge base.",
    icon: BookOpenCheck,
  },
  "capture-review": {
    title: "Capture review queue",
    summary: "Inspect proposed knowledge changes before canonical Markdown is updated.",
    icon: Inbox,
  },
};

/**
 * Safe production counterpart for local review tools. It keeps every command
 * destination reachable in the hosted preview without importing local API
 * adapters or suggesting that the static build can mutate a workspace.
 */
export function PublicOperatorActions({ request }: PublicOperatorActionsProps) {
  const [activeAction, setActiveAction] = useState<OperatorReviewAction | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const modalRef = useModalSurface<HTMLDivElement>({
    isOpen: activeAction !== null,
    onClose: () => setActiveAction(null),
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (request) setActiveAction(request.action);
  }, [request]);

  if (!activeAction || typeof document === "undefined") return null;

  const copy = ACTION_COPY[activeAction];
  const Icon = copy.icon;

  return createPortal(
    <div
      ref={modalRef}
      className="fixed inset-0 z-[120] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setActiveAction(null)}
      />
      <section className="relative flex h-full w-full max-w-2xl flex-col border-l border-border-subtle bg-background shadow-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-5">
          <div>
            <h2 id={titleId} className="font-display text-headline-md font-semibold">
              {copy.title}
            </h2>
            <p id={descriptionId} className="text-metadata text-on-surface-variant">
              Hosted preview · read-only
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="rounded border border-border-subtle p-2 text-on-surface-variant hover:text-primary"
            onClick={() => setActiveAction(null)}
            aria-label={`Close ${copy.title}`}
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-10">
          <div className="w-full max-w-xl rounded-xl border border-primary/25 bg-surface-container-low p-6 md:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container/20 text-primary">
              <Icon size={23} />
            </span>
            <h3 className="mt-5 font-display text-headline-md text-on-surface">{copy.summary}</h3>
            <p className="mt-3 text-body-md leading-6 text-on-surface-variant">
              This hosted Cockpit cannot access your machine or local knowledge files. Open GKE
              locally to use this review flow against your workspace; the public preview will not
              send a request or write any content.
            </p>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4">
              <Terminal className="mt-0.5 shrink-0 text-primary" size={19} />
              <div>
                <div className="font-semibold text-on-surface">Use the local Cockpit</div>
                <code className="mt-1 block font-mono text-code-sm text-on-surface-variant">
                  cd apps/cockpit &amp;&amp; npm run dev
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
