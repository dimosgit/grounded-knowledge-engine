import type {
  CaptureEvidenceConsensusPolicy,
  CaptureEvidenceRoute,
  CaptureRouteDecision,
  CaptureRoutingDefaults,
} from "./capture-routing.js";

export const CAPTURE_PROPOSAL_SCHEMA_VERSION = 1 as const;

export type CaptureSourceOperation = "answer" | "ingest" | "upsert";
export type CaptureAction = "create" | "append" | "replace" | "open_question";
export type CaptureConflictPolicy = "error" | "append" | "replace";

export interface CaptureDuplicateCandidate {
  path: string;
  title: string;
  matchReason: "slug-or-title-match" | "title-body-overlap";
  score: number;
  titleScore: number;
  bodyScore: number;
}

export interface CaptureCitation {
  path: string;
  line?: number;
  score?: number;
}

export interface ProposedCaptureNote {
  kind: "topic" | "term";
  title: string;
  path: string;
  track: string | null;
  module: string | null;
  projectId: string | null;
  type: string | null;
  status: string | null;
  tags: string[];
  owner: string | null;
  updated: string;
  body: string;
}

export interface CaptureProposal {
  schemaVersion: typeof CAPTURE_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  createdAt: string;
  sourceOperation: CaptureSourceOperation;
  proposedAction: CaptureAction;
  proposedNote: ProposedCaptureNote;
  duplicateCandidates: CaptureDuplicateCandidate[];
  baseContentHash: string | null;
  evidenceCitations: CaptureCitation[];
  groundedConfidence: Record<string, unknown> | null;
  routing?: CaptureRouteDecision;
  requiresReview: boolean;
  reviewReasons: string[];
}

export interface PlanCaptureInput {
  repoRoot: string;
  sourceOperation: CaptureSourceOperation;
  kind: "topic" | "term";
  title: string;
  body: string;
  requestedPath?: string;
  track?: string;
  module?: string;
  projectId?: string;
  type?: string;
  status?: string;
  tags?: string[];
  owner?: string;
  updated?: string;
  proposedAction?: CaptureAction;
  evidenceCitations?: CaptureCitation[];
  evidenceRoutes?: CaptureEvidenceRoute[];
  routingDefaults?: CaptureRoutingDefaults;
  evidenceConsensus?: CaptureEvidenceConsensusPolicy;
  groundedConfidence?: Record<string, unknown> | null;
  persist?: boolean;
}

export interface CapturePlanResult {
  proposal: CaptureProposal;
  proposalPath: string | null;
  targetExists: boolean;
}

export interface ApplyCaptureProposalOptions {
  repoRoot: string;
  proposalId: string;
  action?: CaptureAction;
  dryRun?: boolean;
  refresh?: () => Promise<void>;
}

export interface ApplyCaptureProposalResult {
  proposalId: string;
  action: "created" | "appended" | "replaced" | "opened_question";
  path: string;
  dryRun: boolean;
  contentHash: string;
}

export interface CaptureProposalSummary {
  proposalId: string;
  createdAt: string;
  sourceOperation: CaptureSourceOperation;
  proposedAction: CaptureAction;
  title: string;
  path: string;
  track: string | null;
  module: string | null;
  projectId: string | null;
  requiresReview: boolean;
  reviewReasons: string[];
  duplicateCandidateCount: number;
  evidenceCitationCount: number;
  routingStatus: CaptureRouteDecision["status"] | null;
}

export interface CaptureProposalPreview {
  proposal: CaptureProposal;
  targetExists: boolean;
  currentContent: string;
  proposedContent: string;
  currentContentHash: string | null;
  stale: boolean;
}

export type { CaptureRouteDecision } from "./capture-routing.js";
