import { getKbRetriever } from "../grounding/retriever.js";
import { applyCaptureProposal } from "./capture-service.js";
import type { ApplyCaptureProposalOptions, ApplyCaptureProposalResult } from "./types.js";

export async function refreshCaptureRetrievalState(repoRoot: string): Promise<void> {
  if (process.env.KB_MCP_RETRIEVAL_BACKEND?.toLowerCase() === "sqlite") {
    const { getSqliteKbRetriever } = await import("../grounding/sqlite-index.js");
    await getSqliteKbRetriever({ repoRoot, forceRefresh: true });
    return;
  }
  await getKbRetriever({ repoRoot, forceRefresh: true });
}

export async function applyCaptureProposalAndRefresh(
  options: Omit<ApplyCaptureProposalOptions, "refresh">,
): Promise<ApplyCaptureProposalResult> {
  return applyCaptureProposal({
    ...options,
    refresh: async () => refreshCaptureRetrievalState(options.repoRoot),
  });
}
