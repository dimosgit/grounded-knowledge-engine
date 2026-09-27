# Workflow comparison v3 results

Date: 2026-09-17

Status: **exploratory; the current policy removed the automatic-load regression and
used fewer median tokens across three complete equal-quality pairs, but it was
slower and one additional pair was interrupted.**

## Configuration

- Runner: Codex CLI 0.154.0 with user configuration ignored
- Model: `gpt-5.6-luna`
- Reasoning: `low`
- Workload: fresh isolated `adapters` and `typo` fixtures
- Quality: held-out evaluator with fixture, scope, and evaluator-integrity checks
- Timing: process start through final runner event
- Tokens: final native CLI counters; processed tokens are input plus output, with
  cached input already included in input
- Pairing: matching arms started concurrently with identical task requirements

No worker agents were created. Raw event logs and generated fixtures stayed outside
the repository. The report uses only aggregate counters and evaluator results.

## Automatic skill-loading candidate

The first candidate allowed implicit skill invocation and relied on its description
to reject routine work. That gate was not reliable: Codex read the full skill in two
of three typo runs and all three adapter runs.

| Workload | Metric                  | Ordinary | Implicit workflow | Change |
| -------- | ----------------------- | -------: | ----------------: | -----: |
| Typo     | Accepted runs           |      3/3 |               3/3 |      — |
| Typo     | Full-skill loads        |      0/3 |               2/3 |      — |
| Typo     | Median time             | 29.441 s |          31.305 s |  +6.3% |
| Typo     | Median processed tokens |   92,473 |           108,196 | +17.0% |
| Adapters | Accepted runs           |      2/3 |               3/3 |      — |
| Adapters | Full-skill loads        |      0/3 |               3/3 |      — |
| Adapters | Median time             | 67.955 s |          77.132 s | +13.5% |
| Adapters | Median processed tokens |  115,004 |           156,560 | +36.1% |

The adapter quality totals differ, so that row is not an equal-quality efficiency
comparison. The routine result is equal quality and demonstrates a regression. A
shorter skill body cannot remove the cost because selecting the skill adds another
context-bearing model and tool turn.

## Current explicit-only policy

The correction disables implicit invocation. A short routing rule in `AGENTS.md`
keeps clear tasks in the current agent, batches inspection, uses the supplied
acceptance check, and loads the full workflow only for genuinely substantial
disjoint work or an explicit parallel-speed request.

The final controlled matrix produced two complete pairs before both arms reached the
shared account usage limit during pair three. A fourth pair completed after the
usage window reset, providing three complete comparisons while retaining the failed
pair.

| Metric                  | Ordinary | Current policy | Change |
| ----------------------- | -------: | -------------: | -----: |
| Complete accepted pairs |      3/3 |            3/3 |      — |
| Full-skill loads        |      0/3 |            0/3 |      — |
| Median time             | 65.503 s |       69.728 s |  +6.5% |
| Median processed tokens |  134,333 |        117,847 | -12.3% |

Pair three is retained as a failed trial. Both runner sessions stopped on the same
usage-limit response and exposed no final usage counters. The ordinary artifact had
already reached 39/39 held-out checks; the policy artifact stopped at 12/39. Neither
result is included in the three-pair medians.

The completed pairs meet the exploratory token criterion: at least three matched
passing pairs, equal quality, complete counters, and lower median processed tokens.
They do not meet the time criterion, and the failed third pair prevents an overall
quality-preserved matrix. The result is a provisional token improvement, not a
proven overall efficiency win.

## Decision

Keep implicit skill invocation disabled. The automatic-load candidate is rejected
for routine and small multi-file work. Keep the inexpensive `AGENTS.md` fast path:
it avoids the demonstrated regression and reduced median processed tokens across
the three completed final pairs. The observed 6.5% time increase is below the 20%
threshold used for a material time finding, but it is still a regression rather
than an improvement.

Do not claim automatic model-selection, delegation, cost, or cross-provider savings
from this experiment. A stronger conclusion needs five completed pairs with the
same evaluator and settings; retain the interrupted pair and add at least two fresh
matched pairs in an uninterrupted usage window.
