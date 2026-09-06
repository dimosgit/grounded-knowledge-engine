// Compatibility surface for existing engine imports. Pure project attention
// rules belong to the shared browser-safe project contract.
export {
  buildProjectAttentionReasons,
  calculateProjectAttention,
  calculateProjectReviewState,
  isCompletedProjectStatus,
  isValidIsoDate,
} from "../../packages/contracts/src/projects.js";

export type {
  ProjectAttention,
  ProjectAttentionInput,
} from "../../packages/contracts/src/projects.js";
