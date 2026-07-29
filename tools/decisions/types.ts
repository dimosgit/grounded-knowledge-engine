import type { WorkspaceContext } from "../workspaces/types.js";

export type DecisionStatus = "proposed" | "active" | "superseded" | "rejected";
export type DecisionConfidence = "low" | "medium" | "high";
export type DecisionReviewState = "current" | "due" | "overdue";
export type DecisionEvidenceChange =
  | "unchanged"
  | "strengthened"
  | "weakened"
  | "contradicted"
  | "missing"
  | "new";

export interface DecisionEvidenceInput {
  path: string;
  line: number;
}

export interface DecisionEvidence extends DecisionEvidenceInput {
  section: string;
}

export interface DecisionEvidenceReviewInput extends DecisionEvidenceInput {
  classification?: Exclude<DecisionEvidenceChange, "missing">;
  note?: string;
}

export interface DecisionEvidenceChangeRecord {
  classification: DecisionEvidenceChange;
  previous?: DecisionEvidence;
  current?: DecisionEvidence;
  note?: string;
}

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

export interface DecisionRecord {
  decisionId: string;
  workspaceId: string;
  projectId?: string;
  title: string;
  status: DecisionStatus;
  owner: string;
  decidedAt: string;
  evidenceCheckedAt: string;
  reviewAfter: string;
  confidence: DecisionConfidence;
  updated: string;
  tags: string[];
  question: string;
  recommendation: string;
  alternatives: string[];
  rationale: string;
  assumptions: string[];
  risks: string[];
  evidence: DecisionEvidence[];
  reviewHistory: string[];
  supersession: string[];
  reviewState: DecisionReviewState;
  path: string;
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
