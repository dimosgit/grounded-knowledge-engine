import type { WorkspaceContext } from "../workspaces/types.js";

export type OpenQuestionStatus = "open" | "resolved";
export type OpenQuestionMutationAction = "created" | "appended" | "unchanged";

export interface OpenQuestionMutationInput {
  question: string;
  whyOpen: string;
  whatWouldResolve: string;
  status?: OpenQuestionStatus;
  resolvedBy?: string;
  relatedPath?: string;
  owner?: string;
  source?: string;
  dryRun?: boolean;
}

export interface NormalizedOpenQuestionInput {
  question: string;
  normalizedQuestion: string;
  whyOpen: string;
  whatWouldResolve: string;
  status: OpenQuestionStatus;
  resolvedBy: string;
  relatedPath: string;
  owner: string;
  source: string;
  dryRun: boolean;
}

export interface ParsedOpenQuestionEntry {
  entryId: string;
  question: string;
  normalizedQuestion: string;
  status: OpenQuestionStatus | null;
  line: number;
}

export interface OpenQuestionMutationResult {
  action: OpenQuestionMutationAction;
  entryId: string;
  dryRun: boolean;
  path: "kb/open_questions.md";
  status: OpenQuestionStatus;
  question: string;
  existing: boolean;
}

export interface OpenQuestionServiceOptions {
  repoRoot: string;
  workspace: WorkspaceContext;
  writesEnabled: boolean;
  refresh?: () => Promise<void>;
  now?: () => Date;
}
