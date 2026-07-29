import path from "node:path";
import {
  createGroundingApplicationService,
  type GroundingApplicationService,
} from "../grounding/grounding-application-service.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  applyCaptureProposal,
  applyUnreviewedCapture,
  getCaptureProposal,
  isCaptureProposalUnchanged,
  listCaptureProposalSummaries,
  listCaptureProposals,
  persistCaptureProposal,
  planCapture,
  previewCaptureProposal,
  rejectCaptureProposal,
} from "./capture-service.js";
import {
  captureGroundedAnswer,
  type CaptureGroundedAnswerOptions,
  type CaptureGroundedAnswerResult,
} from "./grounded-capture-service.js";
import type {
  ApplyCaptureProposalOptions,
  ApplyCaptureProposalResult,
  CapturePlanResult,
  CaptureProposal,
  CaptureProposalPreview,
  CaptureProposalSummary,
  PlanCaptureInput,
} from "./types.js";

export type CapturePlanInput = Omit<PlanCaptureInput, "repoRoot" | "workspace">;
export type CaptureApplyInput = Omit<
  ApplyCaptureProposalOptions,
  "repoRoot" | "workspace" | "refresh"
>;
export type GroundedCaptureInput = Omit<
  CaptureGroundedAnswerOptions,
  "repoRoot" | "workspace" | "refresh"
>;

export interface CaptureApplicationServiceOptions {
  repoRoot: string;
  workspace?: WorkspaceContext;
  refresh?: () => Promise<void>;
  backend?: unknown;
}

export class CaptureApplicationService {
  private readonly repoRoot: string;
  private readonly workspace?: WorkspaceContext;
  private readonly refresh: () => Promise<void>;

  constructor(options: CaptureApplicationServiceOptions) {
    this.repoRoot = options.workspace?.realRepoRoot || path.resolve(options.repoRoot);
    this.workspace = options.workspace;
    const groundingService = options.refresh
      ? null
      : createGroundingApplicationService({
          repoRoot: this.repoRoot,
          workspace: this.workspace,
          backend: options.backend,
        });
    this.refresh = options.refresh || createRefreshCallback(groundingService);
  }

  async plan(input: CapturePlanInput): Promise<CapturePlanResult> {
    return planCapture({
      ...input,
      repoRoot: this.repoRoot,
      workspace: this.workspace,
    });
  }

  async persist(proposal: CaptureProposal): Promise<string> {
    return persistCaptureProposal(this.repoRoot, proposal, this.workspace);
  }

  async list(): Promise<CaptureProposal[]> {
    return listCaptureProposals(this.repoRoot, this.workspace);
  }

  async listSummaries(): Promise<CaptureProposalSummary[]> {
    return listCaptureProposalSummaries(this.repoRoot, this.workspace);
  }

  async get(proposalId: string): Promise<CaptureProposal> {
    return getCaptureProposal(this.repoRoot, proposalId, this.workspace);
  }

  async preview(proposalId: string): Promise<CaptureProposalPreview> {
    return previewCaptureProposal(this.repoRoot, proposalId, this.workspace);
  }

  async apply(input: CaptureApplyInput): Promise<ApplyCaptureProposalResult> {
    return applyCaptureProposal({
      ...input,
      repoRoot: this.repoRoot,
      workspace: this.workspace,
      refresh: this.refresh,
    });
  }

  async reject(
    proposalId: string,
    dryRun = false,
  ): Promise<{ proposalId: string; rejected: boolean; dryRun: boolean }> {
    return rejectCaptureProposal(this.repoRoot, proposalId, dryRun, this.workspace);
  }

  async applyUnreviewed(
    proposal: CaptureProposal,
    options: { dryRun?: boolean } = {},
  ): Promise<ApplyCaptureProposalResult> {
    return applyUnreviewedCapture(this.repoRoot, proposal, {
      ...options,
      workspace: this.workspace,
      refresh: this.refresh,
    });
  }

  async isUnchanged(proposal: CaptureProposal): Promise<boolean> {
    return isCaptureProposalUnchanged(this.repoRoot, proposal, this.workspace);
  }

  async captureGrounded(input: GroundedCaptureInput): Promise<CaptureGroundedAnswerResult> {
    return captureGroundedAnswer({
      ...input,
      repoRoot: this.repoRoot,
      workspace: this.workspace,
      refresh: this.refresh,
    });
  }
}

export function createCaptureApplicationService(
  options: CaptureApplicationServiceOptions,
): CaptureApplicationService {
  return new CaptureApplicationService(options);
}

export async function refreshCaptureRetrievalState(
  repoRoot: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  await createGroundingApplicationService({
    repoRoot,
    workspace,
    backend: process.env.KB_MCP_RETRIEVAL_BACKEND,
  }).refresh();
}

export async function applyCaptureProposalAndRefresh(
  options: Omit<ApplyCaptureProposalOptions, "refresh">,
): Promise<ApplyCaptureProposalResult> {
  const service = createCaptureApplicationService({
    repoRoot: options.repoRoot,
    workspace: options.workspace,
    backend: process.env.KB_MCP_RETRIEVAL_BACKEND,
  });
  return service.apply(options);
}

function createRefreshCallback(
  groundingService: GroundingApplicationService | null,
): () => Promise<void> {
  if (!groundingService) {
    throw new Error("Capture refresh service is not configured.");
  }
  return async () => {
    await groundingService.refresh();
  };
}
