import { useEffect, useRef, type ReactNode } from "react";
import {
  OperatorAttentionProvider,
  useOperatorAttention,
  useOperatorAttentionValue,
  type OperatorAttention,
  type UseOperatorAttentionInput,
} from "../../hooks/useOperatorAttention";

/**
 * Mounts the single shared Attention owner exactly the way `App.tsx` does, so
 * component tests exercise the real hook instead of a hand-written stand-in.
 */
export function AttentionHarness({
  children,
  projects = [],
  decisions = [],
  questions = [],
  changesActive = false,
  onAttention,
}: Partial<UseOperatorAttentionInput> & {
  children?: ReactNode;
  /** Receives the live contract so a test can drive it from outside the tree. */
  onAttention?: (attention: OperatorAttention) => void;
}) {
  const attention = useOperatorAttention({ projects, decisions, questions, changesActive });
  const report = useRef(onAttention);
  report.current = onAttention;

  useEffect(() => {
    report.current?.(attention);
  }, [attention]);

  return <OperatorAttentionProvider value={attention}>{children}</OperatorAttentionProvider>;
}

/** Minimal second consumer: proves the shell reads the same shared state. */
export function AttentionBadgeProbe() {
  const { badge, proposals, selectedProposalId } = useOperatorAttentionValue();
  return (
    <div>
      <span data-testid="probe-badge-text">{badge.text}</span>
      <span data-testid="probe-badge-label">{badge.label}</span>
      <span data-testid="probe-proposal-ids">
        {proposals.map((proposal) => proposal.proposalId).join(",")}
      </span>
      <span data-testid="probe-selected">{selectedProposalId || "none"}</span>
    </div>
  );
}
