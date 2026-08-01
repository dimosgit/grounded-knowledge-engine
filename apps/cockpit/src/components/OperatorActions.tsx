import { useEffect, useState } from "react";
import type { GroundedCaptureResult } from "../lib/grounded-ask-api";
import { useOperatorAttentionValue } from "../hooks/useOperatorAttention";
import { AskDrawer } from "./AskDrawer";
import { CaptureReviewDrawer } from "./CaptureReviewDrawer";

interface OperatorActionsProps {
  projectId?: string;
  projectTitle?: string;
}

/**
 * Presentation and drawer choreography only. The proposal list, its selection,
 * and its refresh lifecycle belong to the shared Attention state, so the queue
 * badge here and the Attention Inbox can never show different numbers.
 */
export function OperatorActions({ projectId, projectTitle }: OperatorActionsProps) {
  const {
    proposals,
    selectedProposalId,
    proposalStatus,
    proposalError,
    request,
    refreshProposals,
    selectProposal,
  } = useOperatorAttentionValue();
  const [reviewOpen, setReviewOpen] = useState(false);

  // Identity follows the shared request object, so a re-render never re-fires
  // the drawers' open effects; only a new request (with a fresh requestId) does.
  const captureReviewRequest = request?.action === "capture-review" ? request : undefined;
  const askRequestId = request?.action === "ask" ? request.requestId : undefined;

  useEffect(() => {
    if (!captureReviewRequest) return;
    setReviewOpen(true);
    void refreshProposals(captureReviewRequest.proposalId);
  }, [captureReviewRequest, refreshProposals]);

  function handleCapture(capture: GroundedCaptureResult) {
    const proposalId = capture.action === "proposed" ? capture.proposal?.proposalId : undefined;
    if (proposalId) void refreshProposals(proposalId);
  }

  function openReview(proposalId?: string | null) {
    if (proposalId) selectProposal(proposalId);
    setReviewOpen(true);
  }

  return (
    <>
      <AskDrawer
        key={projectId || "workspace"}
        projectId={projectId}
        projectTitle={projectTitle}
        openRequest={askRequestId}
        onCapture={handleCapture}
        onReviewProposal={openReview}
      />
      <CaptureReviewDrawer
        isOpen={reviewOpen}
        proposals={proposals}
        selectedId={selectedProposalId}
        queueLoading={proposalStatus === "loading"}
        queueError={proposalError}
        onOpen={openReview}
        onClose={() => setReviewOpen(false)}
        onSelect={selectProposal}
        onRefresh={refreshProposals}
      />
    </>
  );
}
