# V2 workflow comparison results

This exploratory comparison ran on 2026-09-17 using the current
operator-selected lower-cost session. It compares ordinary single-agent work
(B) with the v2 workflow applied sequentially (C). The runtime did not expose
an effective model identifier, reasoning setting, or per-session token counters,
so those measurements are unavailable. This report does not establish a cheaper
model's cost, model-routing behavior, or a general performance result.

## Design

Six fresh, synthetic fixtures ran one top-level trial at a time. Each B/C pair
started from a matching fixture and was independently graded after completion.
Arm C read the workflow skill but had delegation and external consultation
disabled. The controller observed time immediately before dispatch through after
grading; it therefore includes dispatch, worker execution, and grading overhead.

No native per-agent filesystem sandbox or per-session token telemetry was exposed.
Each trial used a separate temporary directory, prompt restrictions, and the
evaluator's scope checks. The resulting isolation is weaker than an OS sandbox.

| Workload  | Arm | Status                | Time (s) | Quality | Scope violations | Input / cached / output / total tokens |
| --------- | --- | --------------------- | -------: | ------- | ---------------: | -------------------------------------- |
| Typo      | B   | Passed                |   40.890 | 7 / 7   |                0 | Unavailable                            |
| Typo      | C   | Passed                |   43.007 | 7 / 7   |                0 | Unavailable                            |
| Adapters  | B   | Passed after deadline |  180.979 | 39 / 39 |                0 | Unavailable                            |
| Adapters  | C   | Passed                |  179.718 | 39 / 39 |                0 | Unavailable                            |
| Ingestion | B   | Passed                |   66.703 | 21 / 21 |                0 | Unavailable                            |
| Ingestion | C   | Passed                |   78.094 | 21 / 21 |                0 | Unavailable                            |

The adapter B trial exceeded its 180-second limit by 0.979 seconds. It remains
in the table rather than being discarded. All other controller-observed durations
were within the limit.

## Comparison

The time delta is `(B - C) / B`: a positive value would favor the workflow arm.

| Workload  | B/C time delta | Interpretation                                  |
| --------- | -------------: | ----------------------------------------------- |
| Typo      |          -5.2% | C was slower in this one observation.           |
| Adapters  |          +0.7% | Effectively tied; B also exceeded the deadline. |
| Ingestion |         -17.1% | C was slower in this one observation.           |

Quality was preserved in all three pairs. The normalized summarizer retained all
six observations, marked usage as partial, and correctly declined to classify the
pairs as comparable because model and reasoning metadata were null. It also left
cost estimates null and reported no efficiency win.

One run per workload is exploratory. Controller-observed timing includes native
dispatch and polling effects, cache state was not controlled, and the setup did
not test a stronger model or native delegation. Do not use these measurements to
choose a model or claim workflow savings.

The comparison also exposed a design error: C explicitly loaded the skill for
every workload, including work that should never activate it. C therefore measured
ordinary execution plus instruction overhead. The token-first revision moves the
gate into discovery metadata and prohibits this forced-load setup for routine work.

## Verification

Before live dispatch, the following passed:

```bash
node --test scripts/workflow-pilot/pilot.test.mjs
npx eslint 'scripts/workflow-pilot/**/*.mjs'
node --check scripts/workflow-pilot/prepare.mjs
node --check scripts/workflow-pilot/evaluate.mjs
node --check scripts/workflow-pilot/summarize.mjs
```

The harness suite reported 19 passing tests. Each live trial then passed the
independent evaluator: 7 checks for typo, 39 for adapters, and 21 for ingestion.
The local run ledger, evaluator outputs, normalized metrics, and summary remain
outside the checkout because they contain local execution metadata.

## Next experiment

Install the revised skill in an isolated client that reports effective model,
reasoning, skill activation, and per-session cumulative usage. First verify on a
simple B/C pair that C does not activate. Then use a genuinely substantial task to
compare ordinary lower-cost execution with token-priority routing. Test parallel
time-priority execution separately because it may reduce time while increasing
tokens. Use at least three rotated repetitions and retain every failure or deadline
overrun.
