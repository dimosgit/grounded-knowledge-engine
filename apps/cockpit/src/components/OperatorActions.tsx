import { useCallback, useEffect, useState } from "react";
import { listCaptureProposals, type CaptureProposalSummary } from "../lib/capture-review-api";
import type { GroundedCaptureResult } from "../lib/grounded-ask-api";
import { AskDrawer } from "./AskDrawer";
import { CaptureReviewDrawer } from "./CaptureReviewDrawer";

interface OperatorActionsProps {
  projectId?: string;
  projectTitle?: string;
}

export function OperatorActions({ projectId, projectTitle }: OperatorActionsProps) {
  const [proposals, setProposals] = useState<CaptureProposalSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");

  const refreshProposals = useCallback(async (preferredId?: string | null) => {
    setQueueLoading(true);
    setQueueError("");
    try {
      const next = await listCaptureProposals();
      setProposals(next);
      setSelectedId((currentId) => {
        const requestedId = preferredId === null ? null : preferredId || currentId;
        return (
          (requestedId && next.some((item) => item.proposalId === requestedId)
            ? requestedId
            : null) ||
          next[0]?.proposalId ||
          null
        );
      });
    } catch (requestError) {
      setQueueError(toMessage(requestError));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProposals();
    const refreshOnFocus = () => {
      if (document.visibilityState !== "hidden") void refreshProposals();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refreshProposals]);

  function handleCapture(capture: GroundedCaptureResult) {
    const proposalId = capture.action === "proposed" ? capture.proposal?.proposalId : undefined;
    if (proposalId) void refreshProposals(proposalId);
  }

  function openReview(proposalId?: string | null) {
    if (proposalId) setSelectedId(proposalId);
    setReviewOpen(true);
  }

  return (
    <>
      <AskDrawer
        key={projectId || "workspace"}
        projectId={projectId}
        projectTitle={projectTitle}
        onCapture={handleCapture}
        onReviewProposal={openReview}
      />
      <CaptureReviewDrawer
        isOpen={reviewOpen}
        proposals={proposals}
        selectedId={selectedId}
        queueLoading={queueLoading}
        queueError={queueError}
        onOpen={openReview}
        onClose={() => setReviewOpen(false)}
        onSelect={setSelectedId}
        onRefresh={refreshProposals}
      />
    </>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Capture review request failed.";
}
