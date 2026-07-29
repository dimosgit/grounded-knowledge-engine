import {
  createDecision,
  getDecision,
  listDecisions,
  reviewDecision,
  supersedeDecision,
} from "./decision-record.js";
import type {
  CreateDecisionOptions,
  CreatedDecision,
  DecisionRecord,
  DecisionServiceOptions,
  ListDecisionOptions,
  ReviewDecisionOptions,
  ReviewedDecision,
  SupersedeDecisionOptions,
  SupersededDecision,
} from "./types.js";

export type RecordDecisionInput = Omit<CreateDecisionOptions, keyof DecisionServiceOptions>;
export type GetDecisionInput = { identifier: string; asOf?: string };
export type ListDecisionsInput = Omit<ListDecisionOptions, keyof DecisionServiceOptions>;
export type ReviewDecisionInput = Omit<ReviewDecisionOptions, keyof DecisionServiceOptions>;
export type SupersedeDecisionInput = Omit<SupersedeDecisionOptions, keyof DecisionServiceOptions>;

export interface DecisionApplicationServiceOptions extends DecisionServiceOptions {
  refresh?: () => Promise<void>;
}

export class DecisionApplicationService {
  private readonly context: DecisionServiceOptions;
  private readonly refresh?: () => Promise<void>;

  constructor(options: DecisionApplicationServiceOptions = {}) {
    this.context = {
      repoRoot: options.repoRoot,
      scanRoots: options.scanRoots ? [...options.scanRoots] : undefined,
      workspace: options.workspace,
    };
    this.refresh = options.refresh;
  }

  async record(input: RecordDecisionInput): Promise<CreatedDecision> {
    const result = await createDecision({ ...input, ...this.context });
    await this.refreshAfterMutation(result.dryRun);
    return result;
  }

  async get(input: GetDecisionInput): Promise<DecisionRecord> {
    return getDecision(input.identifier, {
      ...this.context,
      asOf: input.asOf,
    });
  }

  async list(input: ListDecisionsInput = {}): Promise<DecisionRecord[]> {
    return listDecisions({ ...input, ...this.context });
  }

  async review(input: ReviewDecisionInput): Promise<ReviewedDecision> {
    const result = await reviewDecision({ ...input, ...this.context });
    await this.refreshAfterMutation(result.dryRun);
    return result;
  }

  async supersede(input: SupersedeDecisionInput): Promise<SupersededDecision> {
    const result = await supersedeDecision({ ...input, ...this.context });
    await this.refreshAfterMutation(result.dryRun);
    return result;
  }

  private async refreshAfterMutation(dryRun: boolean): Promise<void> {
    if (!dryRun && this.refresh) await this.refresh();
  }
}

export function createDecisionApplicationService(
  options: DecisionApplicationServiceOptions = {},
): DecisionApplicationService {
  return new DecisionApplicationService(options);
}
