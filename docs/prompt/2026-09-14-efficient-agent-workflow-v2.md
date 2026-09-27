# 1. Feature Title

Efficient native-agent workflow v2 and measured evaluation

Status: **superseded after the 2026-09-17 forced-load comparison exposed instruction
overhead**. The benchmark harness remains in use; current token-first behavior and
measurement rules are in the [workflow guide](../agent-workflows.md).
Do not execute the remaining historical plan as current instructions.
This plan updates the execution approach in the original
[workflow brief](2026-09-14-native-agent-complex-task-workflow.md). Its scope and
acceptance requirements supersede that brief only for the improvements below.
`AGENTS.md` remains the repository's sole agent operating contract.

## 2. Objective

Reduce coordination overhead while preserving observable correctness. Make small
tasks exit directly into normal execution, use explicit session-level model
mappings for substantial work, and delegate only when independent work justifies
it. Compare the result with ordinary execution on both strong and lower-cost
models before making efficiency claims.

## 3. Context

- Product area: `skills/complex-task-workflow`, its provider references, and
  `docs/agent-workflows.md`.
- Current behavior: the skill chooses an execution shape, then unconditionally
  prescribes work packets, a task table, provider-reference reads, and recovery
  steps. Lack of model selection also forces sequential execution even when
  native delegation is available.
- Problem: the fast path is incomplete, model tiers remain abstract, and the
  existing pilot cannot establish the value of cheaper workers or parallel work.

### Existing evidence

The first pilot used identical synthetic fixtures in two isolated directories:
normal execution and the new workflow, both on `gpt-6-astra`. It tested a typo,
a small summary/render feature, and tag-parser repair.

| Measurement               | Normal execution |  Workflow |
| ------------------------- | ---------------: | --------: |
| End-to-end agent time     |        111.847 s | 110.702 s |
| Independent checks passed |            26/26 |     26/26 |
| Total processed tokens    |          472,723 |   355,709 |
| Cached input tokens       |          433,152 |   346,496 |
| Output tokens             |            2,120 |     2,415 |

These are historical observations, not acceptance targets. There was one paired
run, different cache conditions, no nested delegation, and no model switching.
Each agent began with roughly 32,500 input tokens of runtime context. The baseline
also made three timing-only tool calls versus one in the workflow arm. The apparent
token improvement cannot be attributed entirely to the workflow. Both models
passed easy tests, which leaves little opportunity to demonstrate quality gains.

Read before implementation:

1. `AGENTS.md`, `package.json`, and `gke.layers.json`.
2. `skills/complex-task-workflow/SKILL.md` and `agents/openai.yaml`.
3. Its active provider reference, plus the other reference only when updating it.
4. `docs/agent-workflows.md` and the optional source-checkout reference in
   `skills/grounded-knowledge-workflow/SKILL.md`.

The temporary original pilot is not a required dependency. Preserve the historical
facts above and create reproducible sanitized fixtures for further evaluation.

## 4. Scope

In scope:

1. A real direct-execution exit and conditional loading of advanced instructions.
2. A session-level mapping from worker roles to available models and reasoning
   settings, with accurate capability fallbacks.
3. Delegation criteria based on independent work and integration overhead.
4. Compact assignments, batched independent operations, and bounded escalation.
5. Synthetic benchmark fixtures, independent acceptance checks, an offline metrics
   summarizer, and a documented manual native-client evaluation procedure.
6. Honest status updates and a separate public-repository compliance review.

Out of scope:

1. A model API integration, scheduler, persistent worker service, or automatic
   spawning from the benchmark utilities.
2. Repairing or reinstalling clients, modifying user settings, changing credentials,
   or scanning unrelated session histories.
3. New GKE tools, schemas, engine behavior, Cockpit screens, or package distribution.
4. Weakening tests, authority boundaries, or evidence requirements to save tokens.
5. Claiming instructions remove runtime-supplied context or enforce hard budgets.

Creating this plan does not launch trials or activate new model settings.

## 5. Requirements

### R1. Exit early for clear local work

Place the fast-path decision before provider references, model discovery, task
tables, and packet creation. A clear local task with an obvious completion check
must proceed directly: read relevant files, edit, verify, report. Explicitly skip
the remaining coordination procedure for this path.

Do not change the current conversation model or start a worker just to perform a
tiny edit. Use the current model when no lower-cost session was selected in advance.
If a real dependency or uncertainty emerges, transition once to the advanced path
with a short explanation. Existing repository policy always applies.

### R2. Resolve model roles once per session

For advanced work, create a compact in-session mapping with these fields:

```text
Role | requested tier | verified model ID | reasoning setting | capability source
```

Roles are implementer, explorer, and consultant/reviewer; one model may serve
multiple roles. Prefer an operator-selected lower-cost implementer when the task
is well specified and independently testable. Consult a stronger model for
unresolved design uncertainty or repeated failure without a new explanation.

Use values exposed by the native client and permitted by the operator. Record
unknown values explicitly. Do not infer price solely from a model name. If an
available model has no verified cost data, describe its selection without asserting
it is cheaper. Model availability is not permission to change persistent settings.

Read provider-specific resolution guidance only when establishing this mapping or
when a capability changes. Reuse it for later packets in the same session. Honor
the existing Codex precedence correction, including custom-agent overrides and
reasoning-effort compatibility. Do not equate requested and effective settings.

### R3. Separate capability fallbacks

| Delegation available | Worker model control available | Behavior                                                             |
| -------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Yes                  | Yes                            | Use mapped workers when delegation criteria pass                     |
| Yes                  | No                             | Allow useful same-model delegation; disclose inherited/unknown model |
| No                   | Yes                            | Execute in the current session; no worker can be created             |
| No                   | No                             | Execute in the current session and disclose limits when relevant     |

Do not install a workaround or silently switch the main model. Do not repeatedly
probe known unavailable capabilities within one session.

### R4. Delegate substantial independent work

Use a maximum of two concurrent workers by default, within actual client capacity.
Delegate only when all conditions hold:

- The packet has an independently verifiable deliverable and enough meaningful
  work to justify startup, context loading, and integration.
- Dependencies and shared interfaces are settled.
- Writable paths have a single owner; any conflicts are serialized.
- The coordinator or another worker can make useful progress concurrently.

Do not use number of files, prompt length, or an arbitrary time estimate as the
sole trigger. Two tiny functions belong in one packet. Two substantial independent
adapters against an agreed contract can be separate packets. Where uncertain,
prefer one worker and collect evidence before adding coordination.

Keep GKE-specific verification constraints visible when relevant: use
`gke.layers.json` for scope, and never run Cockpit test and build concurrently.

### R5. Reduce interaction overhead and preserve recovery limits

Keep worker packets to objective/output, relevant evidence, dependencies/interface,
write ownership, acceptance checks, resolved model request, and remaining budget.
Pass applicable policy references or essential restrictions explicitly to workers
when their context does not inherit them. Do not send the whole conversation by
default or let workers recursively delegate.

Batch independent reads and checks when safe. A single return should contain
changed files, commands/results, and blockers. Avoid repeated status-only requests
or asking the model to call a clock for benchmark bookkeeping. User-facing progress
updates still follow the client's communication rules.

Maintain the existing per-packet maximum: initial attempt, two repairs, at most one
authorized and supported consultation, then one final repair. Count attempts across
handoffs and model changes; the budget does not reset. If consultation is unavailable,
report that fact and use at most the remaining final repair when there is a concrete
new hypothesis. Escalate uncertain design before coding when appropriate; do not
spend retries blindly to reach a consultation threshold.

### R6. Measure complete runs with external instrumentation

Read start/end timestamps from the native run lifecycle outside the worker's task.
Do not add timing-only tool calls to either arm. Include coordinator startup,
instruction loading, every worker, integration, verification, waiting, and final
reporting. Wall time is the overall span, not the sum of overlapping worker times.

Aggregate each unique session's final cumulative token counters once. Include
coordinator and all descendants. Never sum cumulative snapshots or count the same
worker twice. Preserve input, cached input (a subset of input), output, and any
provider-specific fields with their documented semantics. Report missing telemetry
as unavailable and incomplete trees as partial, never zero.

Processed tokens are not money. Compute a cost estimate only with dated, cited
pricing for each actual model and documented cache accounting; label it an estimate,
not a subscription charge. Otherwise show usage categories and leave cost unavailable.

### R7. Use comparison arms that isolate the benefit

| Arm | Configuration                                          | Question                                       |
| --- | ------------------------------------------------------ | ---------------------------------------------- |
| A   | Strong model, ordinary single-agent execution          | What quality does the strong baseline achieve? |
| B   | Operator-selected lower-cost model, ordinary execution | Is a cheaper model alone sufficient?           |
| C   | Same model as B, v2 workflow, sequential execution     | What does the instruction workflow add?        |
| D   | Same coordinator model as C, v2 plus up to two workers | Does useful parallel work improve the result?  |

Arm D is only applicable to the workload with independent substantial work. Do not
force it for a typo or a tightly coupled task. Record consultant models and their
usage in C/D if escalation occurs. Capability restrictions that make arms identical
must be disclosed; do not relabel same-model trials as a cost-routing test.

Use three fixture workloads:

1. A precise local edit: exact preservation and no coordination required.
2. Two import adapters against a fixed shared record contract: separate JSON and
   delimited-text input paths, normalization, validation errors, and integrated
   summary output. Include malformed rows, escaping, missing values, and immutability.
3. A failing ingestion/retrieval regression spanning multiple modules: duplicate
   identity, unchanged re-ingestion, changed content, and explicit project isolation.
   Build a synthetic miniature; do not touch the real engine or private KB.

Provide realistic distractor modules, frozen starting fixtures, stated requirements,
visible regression tests, and independent held-out acceptance cases. Keep evaluator
files outside worker write scope. Check them before and after execution for changes.
Fresh fixture copies prevent solution leakage; workers must not read other arms.

## 6. Technical Constraints

1. Preserve `AGENTS.md` as the only operating contract and retain the existing
   explicit-only invocation policy. No competing contract or blanket delegation rule.
2. Preserve GKE grounding/capture behavior and the packaged-skill missing-file fallback.
3. Keep role mappings in session context; do not persist client settings or model IDs
   into shared policy. Inert examples may use clearly labeled placeholders.
4. Benchmark helpers are offline file/metrics tools with built-in Node.js only.
   They must not invoke providers, read credentials, or install dependencies.
5. Utilities must use caller-selected, validated output directories outside the
   checkout and refuse existing non-empty output targets. No recursive deletion or
   reset of user directories; fresh temporary directories are the default.
6. Export only sanitized benchmark metadata, fixture checksums, measurements, and
   outcomes. Raw session logs may contain private context: never copy them into
   the public repository or search unrelated sessions. Consume explicitly identified
   pilot sessions locally and retain only allowlisted aggregate fields.

## 7. Implementation Notes

Complete these packets in order. The default implementation is sequential; the
plan itself does not require a team to write a few documentation files.

### Packet A — lightweight skill

- Scope: `skills/complex-task-workflow/SKILL.md`.
- Implement R1, R3–R5. Keep the entrypoint compact and the direct exit unmistakable.
- Preserve capture authorization and bounded recovery.
- Verify with instruction walkthroughs: tiny edit, same-model delegation, missing
  delegation, overlapping paths, early uncertainty, and exhausted repair budget.
- Exit: simple tasks do not load advanced instructions or create packets/tables.

### Packet B — concrete native routing

- Dependency: A's procedure settled.
- Scope: the existing Claude Code and Codex reference files.
- Implement R2–R3, including session mapping, effective model checks, and independent
  fallbacks. Update activation prompts to preserve the direct path.
- Verify current official native-client documentation before writing model-control
  syntax. Use the available OpenAI documentation skill for Codex guidance.
- Exit: a reader can either select supported worker settings or clearly use the
  fallback, without installing anything or inventing model availability.

### Packet C — reproducible offline evaluation

- Dependency: A–B; metric semantics settled before report generation.
- Proposed scope: `scripts/workflow-pilot/prepare.mjs`, `evaluate.mjs`,
  `summarize.mjs`, `pilot.test.mjs`, and sanitized `fixtures/` beneath that directory.
- `prepare.mjs`: create separate fresh arm/task fixture copies and manifest checksums.
- `evaluate.mjs`: grade a completed output against independent cases and scope rules;
  return structured case outcomes and fail the process on failed required checks.
- `summarize.mjs`: consume a normalized allowlisted metrics JSON file; compute quality,
  end-to-end time, per-model token categories, and paired comparisons. Do not crawl
  client log directories. Missing model, cache, or descendant data stays explicit.
- `pilot.test.mjs`: test the utilities with synthetic data, including failure cases.
- Document exact CLI arguments once implemented; avoid creating a provider runner.
- Exit: all fixture, safety, metric, and grading tests pass offline.

### Packet D — documentation and review

- Dependency: A–C.
- Scope: `docs/agent-workflows.md`; minimal discovery-reference adjustments only
  if needed. Add an example normalized metrics record and manual collection steps.
- Replace the stale statement that no Codex pilot occurred with the limited historical
  results in section 3. Keep v2 trials, Claude trials, and routing claims distinct.
- Link results from the guide only after actual execution; no speculative pass table.
- Review public-repository scope, staged files, package fallback, and policy conflicts.
- Exit: instructions, implementation status, and measured evidence agree.

### Packet E — bounded live evaluation

- Dependency: A–D, available native clients, and an operator-approved model map and
  trial budget. Do not silently run a large paid matrix to satisfy this plan.
- First execute one smoke run per applicable arm. If instrumentation or fixture
  isolation fails, correct that before comparing performance.
- Target three repetitions per applicable arm/workload: A/B/C on all three workloads,
  D on workload 2 only, for 30 measured runs if the approved budget supports it.
  Smaller approved pilots remain useful but must be labeled exploratory.
- Rotate arm order across repetitions and run comparison arms without competing
  top-level runs. Parallelism inside D is the intentional variable. Record cache
  categories; where cache state cannot be controlled, disclose the limitation.
- Use the same model/reasoning values for B and C. Log all model deviations and
  whether they arose from escalation or capability fallback.
- Exit: independently graded results and measurements are available, or exact
  unavailable arms/metrics are reported. No improvement claim is required to finish.

## 8. Test Requirements

Implement executable changes and meaningful tests together. Instruction-only changes
need behavioral walkthroughs, not tests that merely match wording.

Required offline checks after A–D, from the repository root:

```bash
node --test scripts/workflow-pilot/pilot.test.mjs
npx eslint scripts/workflow-pilot/*.mjs
node --check scripts/workflow-pilot/prepare.mjs
node --check scripts/workflow-pilot/evaluate.mjs
node --check scripts/workflow-pilot/summarize.mjs
npx prettier --write skills/complex-task-workflow/SKILL.md skills/complex-task-workflow/references/*.md docs/agent-workflows.md scripts/workflow-pilot/**/*.mjs
npm run format
npm run format:check
npx prettier --check skills/complex-task-workflow/SKILL.md skills/complex-task-workflow/references/*.md docs/agent-workflows.md
git diff --check
```

Quote glob arguments as required by the shell and explicitly format any new JSON
or Markdown fixtures. If ESLint does not cover the new directory, use a narrowly
scoped configuration adjustment rather than suppressing validation. No TypeScript
changes are planned; if added in authorized scope, run `npm run typecheck`. Engine
behavior changes are out of scope; do not run the entire engine suite as a substitute
for workflow tests.

Offline regression cases:

- Refuse a non-empty output directory and preserve its sentinel file.
- Reject output paths that overlap the repository or fixture source.
- Detect changed evaluator files, forbidden output files, and wrong outputs.
- Calculate wall time from run boundaries; do not sum overlapping worker durations.
- Count each session's final cumulative usage once, including descendants.
- Preserve unknown metrics and mark incomplete usage aggregation partial.
- Reject negative counters, cached input greater than input, invalid time ranges,
  duplicate session IDs, and unsupported metric schema versions.
- Exclude failed acceptance runs from an efficiency-win claim while retaining their
  time and usage in overall reporting; never discard expensive failures.

Use an available skill validator for the revised skill when present. Report any
fallback validation accurately; do not claim a blocked validator ran successfully.

For the public audit, stage only the intended files, then run:

```bash
npm run scrub
gitleaks git --pre-commit --staged --redact --no-banner
git diff --cached --check
git diff --cached --name-status
```

The staged secret scan is necessary because the current scrub gate's history scan
does not by itself scan new uncommitted secrets. Do not weaken missing scanner or
local-overlay failures. **No commit on failing tests.** Committing/publishing still
requires the authority defined by the existing repository contract.

## 9. Acceptance Criteria

1. A local edit uses direct execution without packets, task tables, provider reads,
   model discovery, or forced delegation.
2. Advanced work uses a verified session model mapping or accurately disclosed
   inheritance; lack of model control does not disable useful delegation.
3. Ownership, dependency, retry, grounding, and capture rules remain intact.
4. Offline fixture and metrics tests pass, including failure/isolation cases.
5. Measurements include coordinator and descendant usage; unknown data and cache
   differences cannot silently become savings.
6. Live quality equals the strong baseline on mandatory acceptance cases, with zero
   scope or authority violations, before considering an efficiency recommendation.
7. Proposed promotion threshold: at least 20% lower median end-to-end time or
   estimated model cost, with no more than 10% regression in the other measured
   metric. Missing cost data permits a time finding only, not a cost claim. With
   only three repetitions, label any result provisional rather than statistically
   established. Report individual runs and variability, not just medians.
8. If B alone performs best, recommend normal lower-cost execution. If no arm clears
   the threshold, report that outcome; do not add complexity to force a positive result.
9. All intended changes pass public-repository review and relevant verification.

## 10. Deliverables

1. Revised skill and native references, preserving source-checkout activation.
2. Offline benchmark utilities, sanitized fixtures, and behavioral tests.
3. Updated guide with accurate historical status and manual evaluation instructions.
4. When authorized and executed, an allowlisted measurements file and results report
   with quality, time, token categories, model settings, failures, and limitations.
5. Final requirement coverage, exact check results, public audit, and recommendation.

## 11. Mandatory Agent Rules

1. Follow `AGENTS.md`; preserve unrelated staged, unstaged, and untracked work.
2. Execute relevant checks before any authorized commit. Never commit failing tests.
3. Report exact executed commands and outcomes; distinguish instruction review,
   offline tests, and actual native-client runs.
4. Escalate genuine blockers without skipping required validation or changing scope.
5. Do not publish raw transcripts, machine-local paths, private context, or secrets.
6. Do not assert a price, model identity, completed worker, or efficiency gain without
   evidence. Preserve failed runs in the evaluation record.

## 12. Assumptions and Open Questions

Assumptions:

1. The priority is dependable results with lower total effort; additional agents
   are optional and should earn their overhead.
2. The first implementation remains repository-local and explicitly activated.
3. Native runtime telemetry can be exported for pilot sessions without a new provider
   integration. If not, unsupported measurements remain unavailable.
4. The 20% benefit and 10% tolerated regression thresholds are proposed engineering
   defaults, not user-approved spending limits or proven optimal values.

Choices needed only before live trials:

1. Which available models and reasoning levels are approved for strong, lower-cost,
   and consultant roles? Use concrete exposed IDs, not guessed current products.
2. What is the maximum trial duration and usage/spend budget? Complete offline work
   before requesting any missing live-trial authority.
3. Which native clients can run the pilot without repair or reinstallation? Report
   unavailable clients and test the supported surface first.
