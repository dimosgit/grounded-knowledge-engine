---
name: complex-task-workflow
description: Explicit playbook for coordinating large implementation tasks after the user or repository contract has selected it. Use only for multiple substantial disjoint deliverables or an explicit parallel-speed request; never auto-load it for routine work.
---

# Token-First Complex Task Workflow

Follow `AGENTS.md`; user instructions remain authoritative.

## Confirm the entry condition

The always-loaded repository contract owns the cheap routing decision. This skill is
explicit-only because a mistaken automatic load costs an extra context-bearing turn.
If it was selected for one clear path or a small synthetic task, stop here and return
to ordinary execution: do not read references, inspect models, plan, or delegate.

Continue only for either:

- two substantial independent deliverables with disjoint writes, separate checks,
  and enough work for each to repay agent startup;
- an explicit user request to trade additional tokens for parallel elapsed time.

Invocation does not make delegation efficient by itself.

## Choose the cheapest topology

Keep one coordinator by default. Search narrowly, batch independent tool calls,
read only relevant files, run the smallest meaningful checks, and stop when they pass.

Without reliable usage telemetry, assume every fresh agent increases total tokens.
In token-priority mode, use at most one worker and only when its separate context
lets the coordinator avoid a large, distinct body of input. Never repeat the worker's
exploration. In explicit time-priority mode, at most two workers may overlap when
they have disjoint files, settled interfaces, and meaningful independent work.
Never delegate recursively.

## Route only a real worker

Do not build a role table. Immediately before the first worker call, read the active
provider reference only if the native tool schema is insufficient:
[Codex](references/codex.md) or [Claude Code](references/claude-code.md).

Use native model and reasoning arguments, selecting the lowest-capability exposed
option adequate for the deliverable and check. A model name in prose selects nothing.
Unknown effective settings stay unknown. Same-model workers may save parallel time;
they are not a token or cost optimization.

Use a stronger model only for one narrow unresolved decision when likely rework
costs more than the consultation. Do not add a reviewer by default.

## Make delegation replace work

Send only:

```text
Objective and output
Relevant input paths
Exclusive writable paths
Settled interface or decision question
One acceptance check
Return changed paths, check result, blocker
```

Link files instead of pasting content. Include only action-changing policy the worker
does not inherit. The coordinator owns shared interfaces and integration, then checks
the diff and acceptance command without reproducing the analysis. Allow one targeted
repair; afterward the coordinator takes over or reports the blocker.

Report the topology, effective settings when observable, and checks. Claim savings
only from comparable measurements including every descendant. The separate
[Grounded Knowledge Workflow](../grounded-knowledge-workflow/SKILL.md) owns explicitly
requested durable capture.
