---
schema_version: 1
record_type: decision
workspace_id: demo
decision_id: transport-read-only-boundary
project_id: transport-review
title: Keep remote writes disabled.
status: active
owner: demo
decided_at: 2026-06-21
evidence_checked_at: 2026-06-22
review_after: 2026-08-20
confidence: high
updated: 2026-06-22
tags: demo, transport, security, read-only
---

# Keep Remote Writes Disabled

## Decision question

Should the temporary transport experiment expose knowledge-base mutations?

## Recommendation

Keep the transport experiment read-only and allow writes only through the local,
workspace-pinned workflow.

## Alternatives considered

- Permit authenticated remote capture during the experiment.
- Host a permanent shared write endpoint.

## Rationale

The experiment exists to validate the read-only transport contract. Remote writes
would broaden the security review without improving that proof.

## Assumptions

- Local operators can perform any required capture through the existing local workflow.
- The experiment remains temporary and loopback-first.

## Risks and caveats

- Remote participants cannot retain new notes during the transport experiment.

## Evidence snapshot

- demo-kb/sources/transport-review/evidence.md:22 — The transport evidence belongs only to the transport project.

## Review history

- None recorded.

## Supersession

- None recorded.
