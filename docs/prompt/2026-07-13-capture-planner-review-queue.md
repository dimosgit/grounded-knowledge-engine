# Feature Prompt Template

**Implementation status:** Implemented on 2026-07-13. The P1 routing and
source-diff follow-ups remain tracked in the linked roadmap.

## 1. Feature Title

`Capture Planner and Review Queue`

## 2. Objective

Separate capture planning from canonical knowledge mutation so duplicate
matching, route selection, and content conflicts are visible before a
consequential write. Preserve GKE's local-first Markdown model while providing
a deterministic queue that humans and agents can inspect and apply without
adding another tool to the default MCP catalog.

## 3. Context

- Product area: `MCP capture policy, knowledge writes, local operational state, CLI, and future Cockpit review workflow`
- Current behavior: `kb.answer_and_capture` can create a note or open question, and `kb.upsert_note` uses title/body similarity to reuse an existing note path. A fuzzy match can therefore select an existing file as the normal non-append write target. Writes are gated and dry-run is supported, but no durable proposal/diff state exists between answer and canonical mutation.
- Problem to solve: `Dedupe advice and write authorization are coupled. The engine needs a reviewable plan/apply boundary so fuzzy matches cannot silently replace canonical knowledge and stale proposals cannot overwrite newer edits.`

## 4. Scope

- In scope:
  1. Define a versioned `CaptureProposal` contract shared by the grounding/capture service, CLI, MCP structured output, and later Cockpit use.
  2. Make fuzzy duplicate candidates advisory-only; they must never change the write target automatically.
  3. Persist review-required proposals under `.gke/capture-proposals/` as local operational state.
  4. Add deterministic CLI/core operations to list, show, apply, and reject proposals.
  5. Require explicit conflict policy and base-content hash verification before replacing an existing note.
  6. Keep proposal files out of indexing, Cockpit content sync, demo export, resources, and public artifacts.
  7. Preserve existing exact-create, open-question, write-gate, dry-run, and deterministic ingestion behavior where it remains safe.
- Out of scope:
  1. Adding a fifth tool to the default MCP profile.
  2. Building the Cockpit review drawer in this milestone.
  3. Implementing Workspace Vaults, Decision Replay, semantic embeddings, OCR, or hosted writes.
  4. Replacing Markdown as canonical storage.
  5. Enabling writes through the read-only HTTP bridge.

## 5. Requirements

1. Add a versioned `CaptureProposal` type with at least:
   - proposal ID and creation timestamp;
   - source operation (`answer`, `ingest`, or explicit upsert);
   - proposed note kind, title, relative path, track, module, project ID, status,
     tags, and body;
   - proposed action (`create`, `append`, `replace`, or `open_question`);
   - duplicate candidates with path, match reason, and score;
   - `baseContentHash` when an existing target is involved;
   - evidence citations and grounded confidence when available;
   - `requiresReview` and machine-readable reasons.
2. Store pending proposals as JSON under
   `.gke/capture-proposals/<proposal-id>.json`. Use workspace-relative values
   only; never store absolute host paths.
3. Treat `.gke/` as operational state:
   - do not index it;
   - do not expose it through generic record resources;
   - do not copy it into Cockpit content;
   - do not include it in demo export or package output.
4. Change fuzzy dedupe behavior:
   - exact requested path or deterministic source identity may identify the
     target;
   - slug/title/body similarity may only populate `duplicateCandidates`;
   - a fuzzy match must never rewrite `relPath` automatically.
5. Add an explicit conflict policy for writes to existing notes:
   `error`, `append`, or `replace`.
   - Default to `error` for existing paths.
   - `replace` requires `baseContentHash` to match the current file.
   - A mismatch returns a conflict without modifying canonical files.
6. Define proposal creation policy:
   - ambiguous route, fuzzy duplicate, or existing-target replacement always
     requires review;
   - an open question may keep the existing safe additive behavior;
   - preserve the current immediate-create behavior for an unambiguous new path
     unless implementation proves that a queue-by-default migration is safer.
7. Add deterministic operations in reusable TypeScript core code:
   - `listCaptureProposals`;
   - `getCaptureProposal`;
   - `applyCaptureProposal`;
   - `rejectCaptureProposal`.
8. Expose those operations through the existing `gke` CLI as a `capture`
   command group, for example:
   - `gke capture list`;
   - `gke capture show <proposal-id>`;
   - `gke capture apply <proposal-id> --action <create|append|replace|open-question>`;
   - `gke capture reject <proposal-id>`;
   - `--dry-run` and `--json` where applicable.
9. Do not add proposal CRUD tools to the core MCP catalog. Extend
   `kb.answer_and_capture` structured output with proposal status/path metadata
   only if it fits the existing schema budget. If full-profile MCP review is
   considered, document and test the catalog decision separately.
10. Apply a proposal as one conflict-checked operation:
    - validate proposal schema and workspace-relative paths;
    - verify write roots and realpath containment;
    - verify the current content hash when required;
    - write via a temporary file plus atomic rename;
    - refresh derived retrieval state only after the canonical write succeeds;
    - mark or remove the proposal only after success.
11. Rejecting a proposal must not mutate canonical knowledge. Keep rejection
    history minimal and local; deletion is acceptable if documented.
12. Update ingestion so deterministic re-ingestion passes an explicit conflict
    policy. Unchanged source input must remain idempotent; changed-source diff
    review is a follow-up roadmap item unless required to keep ingestion safe.
13. Preserve backward-compatible structured output fields where possible. Add
    a migration note for any intentionally changed default conflict behavior.
14. Update public documentation to label capture proposals as implemented only
    after the end-to-end queue/apply tests pass.

## 6. Technical Constraints

1. Markdown under the active workspace remains canonical; `.gke/` is local,
   non-canonical operational state.
2. One MCP process remains fixed to one workspace root. Proposal operations
   cannot accept a different workspace root from model-controlled input.
3. All proposal and target paths must be workspace-relative and validated
   against configured roots after realpath resolution.
4. The default MCP catalog remains four tools and must pass the existing schema
   character/tool-count budget.
5. The HTTP bridge remains read-only and must neither advertise nor execute
   proposal application.
6. Do not log note bodies, proposal bodies, secrets, or raw questions by
   default.
7. Preserve Node 22.5+ support and avoid a new runtime database dependency for
   the queue.
8. Concurrent or stale proposal application must fail safely without partial
   canonical writes.
9. Public/demo tests and fixtures must contain synthetic or license-checked
   content only.

## 7. Implementation Notes

1. Suggested areas:
   - new `tools/capture/` domain module for proposal schema, repository, hashing,
     conflict policy, and apply/reject services;
   - `tools/kb-mcp-server/server.ts` for adapting `answer_and_capture` to the
     new planner service;
   - `tools/kb-mcp-server/catalog.ts` for bounded structured-output additions;
   - `tools/projects/cli.ts` or a small top-level CLI dispatcher for the
     `capture` command group;
   - `tools/ingest/ingest.ts` for explicit deterministic conflict behavior;
   - `tools/grounding/document-core.ts` to confirm `.gke/` exclusion remains
     centralized.
2. Keep proposal serialization deterministic: stable key order, schema version,
   normalized paths, and ISO timestamps.
3. Use SHA-256 over the exact existing file bytes for `baseContentHash`.
4. Handle these edge cases explicitly:
   - fuzzy candidate exists but proposed new path is free;
   - exact target changes after proposal creation;
   - proposal file is malformed or references an unsafe path;
   - proposal is applied twice;
   - process stops between canonical rename and proposal cleanup;
   - two proposals target the same existing note;
   - writes are disabled;
   - dry-run apply;
   - deterministic ingestion reuses an existing target.
5. Do not copy workspace-specific taxonomy rules into the public engine.
   Routing policy is a follow-up built on the proposal contract.
6. Link the completed implementation from
   `docs/planning/2026-07-13-capture-integrity-and-operator-workflow-roadmap.md`
   and update implementation-status labels truthfully.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Required tests must include:
   - fuzzy match returns a review candidate and does not modify the existing
     note;
   - exact new note creation remains functional;
   - default existing-path conflict returns an error;
   - explicit replace succeeds with the correct hash;
   - stale hash fails with zero canonical mutation;
   - append is explicit and deterministic;
   - proposal list/show/apply/reject CLI behavior;
   - proposal paths cannot escape `.gke/capture-proposals/`;
   - unsafe target paths and symlinks are rejected;
   - proposals are absent from search, resources, Cockpit sync, and demo export;
   - HTTP transport cannot apply or discover write operations;
   - ingestion remains idempotent and cited after re-indexing;
   - the ground → proposal/apply → re-ground → cite loop passes end to end.
3. Run relevant checks before commit:
   - Lint: `npm run lint && npm --prefix apps/cockpit run lint`
   - Type check: `npm run typecheck && npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm run test:gke && npm run test:mcp:http && npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm run scrub`
   - Formatting: `npm run format:check && npm --prefix apps/cockpit run format:check`
4. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. A fuzzy duplicate candidate never changes the write target or existing note
   automatically.
2. Every replacement of an existing note is explicit and guarded by the exact
   base-content hash.
3. Review-required captures produce a versioned proposal that `gke capture
list/show` can inspect without exposing absolute paths.
4. `gke capture apply` performs one validated canonical write, refreshes the
   index, and makes the captured knowledge retrievable with citations.
5. Applying a stale proposal fails clearly and leaves both the canonical note
   and current index unchanged.
6. `gke capture reject` leaves canonical knowledge unchanged.
7. `.gke/capture-proposals/` content is never indexed, returned as a generic
   resource, copied into Cockpit content, or included in public/demo exports.
8. Existing stdio grounding, project resume, ingestion, public Cockpit, and
   read-only HTTP tests remain green.
9. The core MCP catalog still contains exactly the approved four tools and
   remains within its schema budget.
10. Documentation distinguishes implemented behavior from the remaining
    roadmap.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.

## 12. Assumptions and Open Questions

- Assumptions:
  1. The first milestone keeps immediate creation for a clearly new,
     unambiguous note while routing consequential/conflicting writes to review.
  2. `.gke/` is the correct home for pending proposals because they are local
     operational state rather than portable knowledge.
  3. CLI review is sufficient for the first milestone; the Cockpit consumes
     the same service later.
  4. Existing deterministic ingestion may use an explicit replace policy where
     source identity and path are controlled by the ingester.
- Open questions:
  1. Should queue-by-default become a workspace policy after the first
     milestone?
  2. Should rejected proposals be deleted, tombstoned locally, or retained for
     a configurable period?
  3. Should full-profile MCP eventually expose one semantic capture-review
     operation, or should review remain CLI/Cockpit-only?
  4. Should proposal application update an optional workspace-specific
     governance hook after the canonical note write?
