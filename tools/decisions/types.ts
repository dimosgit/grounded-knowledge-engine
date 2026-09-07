import type { WorkspaceContext } from "../workspaces/types.js";

import type {
  DecisionStatus,
  DecisionConfidence,
  DecisionReviewState,
  DecisionEvidenceInput,
  DecisionEvidenceReviewInput,
  DecisionEvidenceChangeRecord,
  DecisionRecord,
} from "../../packages/contracts/src/decisions.js";
export type {
  DecisionStatus,
  DecisionConfidence,
  DecisionReviewState,
  DecisionEvidenceChange,
  DecisionEvidenceInput,
  DecisionEvidence,
  DecisionEvidenceReviewInput,
  DecisionEvidenceChangeRecord,
  DecisionRecord,
} from "../../packages/contracts/src/decisions.js";

export interface DecisionServiceOptions {
  repoRoot?: string;
  scanRoots?: string[];
  workspace?: WorkspaceContext;
}

export interface CreateDecisionOptions extends DecisionServiceOptions {
  decisionId?: string;
  workspaceId?: string;
  projectId?: string;
  title: string;
  status?: DecisionStatus;
  owner: string;
  decidedAt: string;
  evidenceCheckedAt: string;
  reviewAfter: string;
  confidence: DecisionConfidence;
  tags?: string[];
  question: string;
  recommendation: string;
  alternatives?: string[];
  rationale: string;
  assumptions?: string[];
  risks?: string[];
  evidence?: DecisionEvidenceInput[];
  dryRun?: boolean;
}

export interface CreatedDecision extends DecisionRecord {
  content: string;
  dryRun: boolean;
}

export interface ListDecisionOptions extends DecisionServiceOptions {
  projectId?: string;
  status?: DecisionStatus;
  reviewState?: DecisionReviewState;
  owner?: string;
  tag?: string;
  asOf?: string;
}

export interface ReviewDecisionOptions extends DecisionServiceOptions {
  decisionId: string;
  reviewedAt: string;
  reviewAfter: string;
  reviewer: string;
  recommendationSupported: boolean | "uncertain";
  assumptionsNeedingValidation?: string[];
  evidence: DecisionEvidenceReviewInput[];
  notes?: string;
  dryRun?: boolean;
}

export interface ReviewedDecision {
  decisionId: string;
  path: string;
  reviewedAt: string;
  reviewAfter: string;
  recommendationSupported: boolean | "uncertain";
  assumptionsNeedingValidation: string[];
  changes: DecisionEvidenceChangeRecord[];
  content: string;
  dryRun: boolean;
}

export interface SupersedeDecisionOptions extends DecisionServiceOptions {
  decisionId: string;
  replacementId: string;
  supersededAt: string;
  reason: string;
  dryRun?: boolean;
}

export interface SupersededDecision {
  decisionId: string;
  replacementId: string;
  decisionPath: string;
  replacementPath: string;
  decisionContent: string;
  replacementContent: string;
  dryRun: boolean;
}
