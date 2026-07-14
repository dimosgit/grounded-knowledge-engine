# Feature Prompt Template

## 1. Feature Title

`Source-Aware Re-ingestion and Reviewable Deltas`

## 2. Objective

Give every ingested note a stable source identity and durable extraction
provenance. Skip unchanged sources before conversion and route changed source
content through the existing conflict-safe review workflow without claiming the
new source version is canonical before its proposals are applied.

## 3. Context

- Product area: `tools/ingest, canonical source records, capture proposals, and project source links`
- Current behavior: `Ingestion uses deterministic topic paths and unchanged rendered notes are idempotent, but provenance contains only source path/date; raw content hashes, converter/version, accepted source versions, and chunk-set changes are not modeled.`
- Problem to solve: `Operators cannot prove which source version produced a note or safely understand added, changed, and removed chunks during re-ingestion.`

## 4. Scope

- In scope:
  1. Stable source IDs and canonical `source` records.
  2. Raw source hashing before extraction.
  3. Converter name/version and extraction-setting provenance.
  4. Unchanged-source short-circuiting.
  5. Reviewable changed-source proposals, including chunk additions/removals.
- Out of scope:
  1. OCR, cloud conversion, or hosted artifact storage.
  2. Automatic acceptance of changed canonical content.
  3. Decision evidence snapshots or Decision Replay.
  4. Moving original files into the workspace automatically.

## 5. Requirements

1. Hash raw source bytes with SHA-256 before conversion.
2. Derive a stable, workspace-local `source_id` from the normalized path relative
   to the ingest root. Do not include absolute host paths in canonical Markdown.
3. Record format, converter, converter version, source hash, accepted ingestion
   timestamp, optional project ID, and generated note paths.
4. Write canonical source records under `kb/sources/<source-id>.md` using the
   normative workspace data architecture and `schema_version: 1`.
5. Add optional source metadata to captured topic frontmatter without discarding
   unknown existing fields.
6. Keep candidate-run operational state under `.gke/`; exclude it from retrieval,
   Cockpit sync, exports, and public artifacts.
7. If the raw hash and relevant extraction settings match the accepted source
   version, return `unchanged` without invoking the converter or capture planner.
8. If a source is new, create notes and the source record only after all immediate
   note creates succeed.
9. If an accepted source changes, create proposals for changed or removed note
   paths and immediate creates only for non-conflicting new paths. Do not replace
   accepted notes automatically.
10. A pending candidate source version must not overwrite the accepted hash in
    the canonical source record.
11. Finalize the canonical source record only after every proposal associated
    with that candidate run is applied or explicitly resolved.
12. Rejecting a proposal must leave the accepted source record truthful and mark
    the candidate run as rejected or partially rejected.
13. Preserve explicit project links across re-ingestion and add links for newly
    accepted note paths without duplicating existing links.
14. Report counts for unchanged sources, immediate creates, pending proposals,
    removed chunks, failures, and finalized source records.

## 6. Technical Constraints

1. Reuse Capture Planner hashes, locks, atomic writes, and proposal review; do
   not create a second general-purpose review queue.
2. Backward compatibility: existing ingested topic notes without source metadata
   remain readable and are adopted on their next ingestion.
3. Source records are canonical knowledge; candidate-run state is operational.
4. Converter version lookup must be cached per process and must not run once per chunk.
5. Workspace authorization from the Leakage Guard applies before reading source
   artifacts inside the workspace and before every canonical write.

## 7. Implementation Notes

1. Suggested areas: `tools/ingest/`, `tools/capture/types.ts`,
   `tools/capture/capture-service.ts`, and a small source-record repository under
   `tools/ingest/` or `tools/sources/`.
2. Extend proposal metadata with optional ingestion candidate identity in a
   backward-compatible way. Increment the proposal schema only if old proposal
   files cannot be read safely.
3. Model a candidate run explicitly so multi-chunk ingestion cannot make a
   partially accepted hash look complete.
4. Test one-to-many, many-to-one, and removed-final-chunk transitions.
5. Keep source names and fixture markers synthetic and public-safe.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm run lint`
   - Type check: `npm run typecheck`
   - Unit/integration/e2e tests: `npm run test:ingest:unit && npm run test:ingest && npm run test:capture && npm run test:loop && npm run test:gke`
   - Formatting: `npm run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Re-ingesting unchanged bytes does not invoke extraction and creates no proposal.
2. A changed source produces reviewable current/proposed content and retains the accepted source hash until resolution.
3. Added and removed chunks are represented explicitly; no stale chunk is silently left as current.
4. Applying all candidate proposals finalizes one truthful canonical source record.
5. Rejecting any candidate proposal does not falsely mark the candidate hash as accepted.
6. No canonical record or response contains an absolute host path.

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
  1. The accepted source record represents the version reflected by canonical topic notes.
  2. A partially rejected candidate run requires another explicit ingestion/review cycle.
- Open questions:
  1. If proposal apply cannot safely finalize multi-note candidate state without
     changing the capture contract, stop after implementing and testing the
     candidate-state repository, then request a contract decision.
