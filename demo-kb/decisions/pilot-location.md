---
schema_version: 1
record_type: decision
workspace_id: demo
decision_id: pilot-location
title: Select the First Pilot Location
status: active
owner: demo-workspace
decided_at: 2026-05-15
evidence_checked_at: 2026-06-01
review_after: 2026-07-15
confidence: medium
updated: 2026-06-01
tags: demo, decision-replay, pilot
---

# Select the First Pilot Location

## Decision question

Which of Valencia, Málaga, or Lisbon should host the first pilot?

## Recommendation

Use Valencia for the first pilot, with a protected two-week scheduling buffer.

## Alternatives considered

- Málaga
- Lisbon

## Rationale

Valencia offers the best current balance of operating cost, partner readiness, and launch scope.
The later evidence narrows the available launch window but does not overturn the recommendation.

## Assumptions

- The Valencia partner can preserve a two-week scheduling buffer.
- Setup costs remain within the validated comparison range.

## Risks and caveats

- A shorter launch window would weaken the operating plan.
- The comparison does not replace local legal or tax review.

## Evidence snapshot

- demo-kb/sources/pilot-location-evidence.md:13 — Initial comparison

## Review history

### Review 2026-06-01

- Reviewer: demo-workspace
- Recommendation supported: yes
- Next review after: 2026-07-15
- Assumptions needing human validation:
  - Confirm the two-week scheduling buffer with the Valencia partner.
- Evidence changes:
  - weakened: demo-kb/sources/pilot-location-evidence.md:21 — The launch window is narrower than first assumed.
- Notes: Retain Valencia, but make the scheduling buffer explicit.

## Supersession

- None recorded.
