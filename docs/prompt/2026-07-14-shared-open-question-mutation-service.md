# Feature Prompt Template

## 1. Feature Title

`Shared Atomic Open-Question Mutation Service`

## 2. Objective

Move open-question mutation out of the MCP protocol handler into a deterministic
application service. Preserve the existing Markdown format while preventing
lost concurrent appends and exact duplicate questions.

## 3. Context

- Product area: `Open-question capture, MCP answer-and-capture, local Cockpit, and canonical Markdown mutation`
- Current behavior: `server.ts reads kb/open_questions.md, constructs the next full string outside its queued write, and writes it directly; this path does not share capture/application-service boundaries.`
- Problem to solve: `Concurrent requests can be based on stale content, protocol code owns repository behavior, and abstained Cockpit answers have no reusable save-as-open-question path.`

## 4. Scope

- In scope:
  1. A provider-neutral open-question application service and repository.
  2. Atomic, workspace-authorized append behavior.
  3. Exact normalized-question deduplication.
  4. Reuse from existing MCP operations and a future Cockpit action.
- Out of scope:
  1. A new MCP tool or a new core catalog entry.
  2. Semantic duplicate detection.
  3. A full open-question database or workflow engine.
  4. Decision records or task creation.

## 5. Requirements

1. Add typed input/result contracts for question, why open, what would resolve,
   status, resolved-by, related path, owner/source, and dry-run.
2. Normalize each scalar to a single safe line and validate status values.
3. Parse existing entries sufficiently to compare normalized question text.
4. Return `unchanged` with the existing entry identity when an exact normalized
   question already exists. Do not append a duplicate.
5. Serialize concurrent mutations with a workspace-local lock or queue that
   includes the read, dedupe decision, and write in one critical section.
6. Write through an atomic temporary-file-and-rename operation with restrictive
   local permissions where supported.
7. Authorize the target through the Workspace Leakage Guard before reading or writing.
8. Preserve the existing `# Open Questions` document and entry syntax so current
   Cockpit parsing remains compatible.
9. Replace the inline `server.ts` mutation with the shared service.
10. Reuse the service from `kb.answer_and_capture` when an answer abstains.
11. Expose a provider-neutral function that the Cockpit adapter can call later;
    do not add the UI in this prompt.
12. Refresh the active retrieval backend once after a successful mutation and
    never for `unchanged` or dry-run.

## 6. Technical Constraints

1. Keep Markdown canonical and `kb/open_questions.md` as the compatibility path.
2. Do not load MCP protocol types into the application service.
3. Do not use fuzzy matching to suppress distinct questions.
4. Preserve writes-disabled and dry-run behavior.
5. Safe error responses must not expose absolute paths.

## 7. Implementation Notes

1. Suggested files: `tools/questions/types.ts`,
   `tools/questions/open-question-service.ts`, a focused test file, and small
   adapter changes in `tools/kb-mcp-server/server.ts`.
2. Prefer extracting a shared atomic-write primitive from capture only if doing
   so does not change capture behavior.
3. Give entries a deterministic internal identity in structured results; do not
   require adding the identity to legacy Markdown unless needed for correctness.
4. Include concurrency tests that start multiple appends before awaiting them.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm run lint`
   - Type check: `npm run typecheck`
   - Unit/integration/e2e tests: `npm run test:answer-service && npm run test:capture && npm run smoke:mcp && npm run test:loop && npm run test:gke`
   - Formatting: `npm run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Twenty concurrent distinct appends produce twenty intact entries with no lost update.
2. Concurrent identical appends produce one canonical entry and deterministic `unchanged` results.
3. Dry-run returns the planned result without creating or changing the file.
4. Writes-disabled and read-only workspaces reject mutation.
5. Existing MCP response schemas and Cockpit open-question parsing remain compatible.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. If preparing a commit, stage only the intended files before the final
   npm run scrub because the tracked-file string scan does not inspect untracked
   additions. Do not stage unrelated user changes.

## 12. Assumptions and Open Questions

- Assumptions:
  1. Exact normalized text is the only automatic dedupe rule for this milestone.
- Open questions:
  1. None. Do not broaden this prompt into lifecycle management for resolved questions.
