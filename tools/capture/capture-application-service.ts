import { getKbRetriever } from "../grounding/retriever.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { applyCaptureProposal } from "./capture-service.js";
import type { ApplyCaptureProposalOptions, ApplyCaptureProposalResult } from "./types.js";

export async function refreshCaptureRetrievalState(
  repoRoot: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  if (process.env.KB_MCP_RETRIEVAL_BACKEND?.toLowerCase() === "sqlite") {
    const { getSqliteKbRetriever } = await import("../grounding/sqlite-index.js");
    await getSqliteKbRetriever({ repoRoot, workspace, forceRefresh: true });
    return;
  }
  await getKbRetriever({ repoRoot, workspace, forceRefresh: true });
}

export async function applyCaptureProposalAndRefresh(
  options: Omit<ApplyCaptureProposalOptions, "refresh">,
): Promise<ApplyCaptureProposalResult> {
  return applyCaptureProposal({
    ...options,
    refresh: async () => refreshCaptureRetrievalState(options.repoRoot, options.workspace),
  });
}
