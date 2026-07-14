# Current Hardening and Operator Execution Plan

**Status:** In progress — prompts 0–5 delivered; prompt 6 is next.
**Review date:** 2026-07-14.
**Baseline:** Capture planning, policy routing, daily project review, retrieval
quality gates, visible answer token estimates, and the local Cockpit Ask/review
workflow are implemented.

## Objective

Finish the trust, provenance, and operator-workflow foundations before adding
checkpoints, Decision Replay, semantic retrieval, or another MCP tool. This plan
is intentionally divided into small prompts that a coding model can execute one
at a time without reconstructing the wider roadmap.

## Execution rules

1. Execute the prompts in the order shown below.
2. Use one prompt per implementation turn or pull request.
3. Read `AGENTS.md` and the selected prompt completely before editing.
4. Do not silently include work from a later prompt.
5. Preserve backward compatibility unless the prompt explicitly authorizes a
   contract change.
6. Add tests with each behavior change and run every command listed in the
   prompt.
7. Stop and report a blocker when an acceptance criterion cannot be met. Do not
   weaken the criterion to make the task pass.
8. Update implementation-status labels when a prompt is delivered.

## Ordered work

| Order | Prompt                                                                                                                       | Outcome                                                                                              | Depends on |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 0     | [CI and Roadmap Truth Gate](../prompt/2026-07-14-ci-and-roadmap-truth-gate.md) **Delivered**                                 | CI runs the authoritative suite; production-boundary and status claims are checked.                  | None       |
| 1     | [Thin Workspace Leakage Guard](../prompt/2026-07-14-thin-workspace-leakage-guard.md) **Delivered**                           | Configured roots, reads, and writes are realpath-confined to one immutable workspace.                | 0          |
| 2     | [Source-Aware Re-ingestion](../prompt/2026-07-14-source-aware-reingestion.md) **Delivered**                                  | Source identity, hashes, converter provenance, and changed-source review become durable.             | 1          |
| 3     | [Shared Open-Question Mutation Service](../prompt/2026-07-14-shared-open-question-mutation-service.md) **Delivered**         | Open-question writes become atomic, deduplicated, reusable, and workspace-authorized.                | 1          |
| 4     | [Project-Scoped Ask and Live Capture Queue](../prompt/2026-07-14-cockpit-project-scoped-ask-and-live-queue.md) **Delivered** | Project Ask uses the active project and new proposals immediately update the review workflow.        | 1, 3       |
| 5     | [Cockpit Daily Attention](../prompt/2026-07-14-cockpit-daily-attention.md) **Delivered**                                     | Existing due-review, blocker, open-question, and changed-document signals become operable in the UI. | 1, 4       |
| 6     | [Cockpit Modal Accessibility](../prompt/2026-07-14-cockpit-modal-accessibility.md)                                           | Drawers, command search, and mobile navigation have consistent keyboard and focus behavior.          | 4          |
| 7     | [Cockpit Content Scaling](../prompt/2026-07-14-cockpit-content-scaling.md)                                                   | Metadata loads eagerly, Markdown bodies load on demand, and CI enforces an initial-bundle budget.    | 0, 4       |

Prompts 2 and 3 may run in parallel only when separate branches are used and
both start from the completed Workspace Leakage Guard. For a smaller model,
sequential execution is preferred.

## Why this order

1. The CI truth gate prevents later work from appearing green while new suites
   are not executed.
2. Workspace authorization must sit below ingestion, mutation services, MCP,
   and Cockpit adapters so later work inherits one boundary.
3. Source-aware ingestion and open-question mutation then close the remaining
   engine integrity gaps.
4. Cockpit workflow improvements consume completed engine contracts instead of
   inventing frontend-only rules.
5. Accessibility and scaling follow the corrected workflow to avoid polishing
   components that are still changing structurally.

## Deferred until this plan is complete

- Checkpoint creation.
- Decision Replay.
- Semantic or embedding retrieval.
- Hosted writes or permanent remote deployment.
- New core MCP tools.
- Cross-workspace search.

## Plan-level completion gate

The plan is complete only when:

1. CI runs the complete root and Cockpit verification paths.
2. Adversarial tests prove that an active workspace cannot index, read, cite,
   or write another workspace.
3. Changed source documents produce reviewable proposals with durable
   provenance.
4. Concurrent open-question writes do not lose or duplicate entries.
5. Project Ask is visibly scoped, capture-queue state is live, and daily
   attention is available in the Cockpit.
6. Modal keyboard behavior and initial-bundle budgets are enforced in tests.
7. `README.md`, `docs/workspace-data-architecture.md`, and active roadmap status
   labels describe only implemented behavior as implemented.
