# 1. Feature Title

Execute the v2 workflow comparison with a lower-cost coordinator

Status: **historical execution handoff; completed once and do not reuse for
performance claims**. Its C arm forced the workflow onto every task and therefore
measured instruction overhead. Use the current
[workflow guide](../agent-workflows.md) for the corrected evaluation design.
Stop here when looking for current execution instructions; the remainder is retained
only as the record of the completed v2 trial.

## 2. Objective

Run the existing synthetic assignments through ordinary execution and the v2
workflow. Deliver actual elapsed time, independently graded quality, and observed
token usage. Use this document as the execution handoff: do not redesign the
workflow or substitute offline tests for live results.

## 3. Context

- Product area: `scripts/workflow-pilot/`, `skills/complex-task-workflow/`, and
  `docs/agent-workflows.md`.
- The fixtures, evaluator, and summarizer already exist. The previous 19 passing
  offline tests validate these utilities; they are not a live comparison.
- The historical v1 pilot used the same strong model in both arms. It cannot
  establish v2 performance or savings from cheaper models.
- Read `AGENTS.md`, this handoff, and the workflow guide. Read only the active
  provider reference when resolving native execution capabilities. Repository
  source inspection does not require GKE retrieval.

## 4. Scope

In scope:

1. Verify the existing harness, resolve available execution capabilities once,
   prepare fresh fixtures, execute bounded trials, grade them, and report results.
2. Use the current lower-cost session as the experiment controller. Launch fresh
   isolated trial coordinators so this long conversation does not contaminate
   their context. Count each trial coordinator and all its descendants.
3. Produce local measurement artifacts outside the checkout and a sanitized
   Markdown report under `docs/`, after checking its contents.

Out of scope:

1. Refactoring the harness, implementing an agent platform, changing persistent
   model settings, installing providers, or adding MCP routing.
2. Reading unrelated session logs, private KB content, or credentials.
3. Running the full 30-run matrix automatically, publishing, committing, or pushing.

## 5. Requirements

### Execution configuration

Before launching, write a local `run-config.md` containing:

| Setting                | Default / resolution                                               |
| ---------------------- | ------------------------------------------------------------------ |
| Provider               | Current supported native client; one provider per comparison block |
| Lower-cost model       | Current operator-selected model, verified from runtime metadata    |
| Reasoning              | Current effective setting; use exactly the same for B/C/D          |
| Strong model           | Only an explicitly permitted, available model; otherwise omit A    |
| D workers              | Same lower-cost model/settings; at most two workers                |
| Experiment profile     | Six-run B/C exploration below                                      |
| Launch limit           | Six trial coordinators; no automatic replacements                  |
| Total live wall budget | Proposed 20 minutes, including setup of live trials and grading    |
| Per-run limit          | Proposed three minutes from dispatch, including descendants        |
| Paid API allowance     | None unless separately authorized                                  |
| Output location        | Fresh temporary directory outside the repository                   |

These limits are proposed defaults, not a claim that the earlier request approved
paid trials. Executing this handoff with its defaults explicitly accepted is enough
to proceed without repeated confirmations. If the operator only requests planning,
prepare the handoff and stop. If model choice/budget is unresolved at execution,
complete offline preflight first and ask one bundled question for the missing values.
Availability does not establish which model is cheaper: record operator selection
and distinguish it from independently verified pricing.

The six-run profile answers whether v2 instructions help the selected model:

| Order | Workload  | Arm | Repetition |
| ----- | --------- | --- | ---------- |
| 1     | typo      | B   | 1          |
| 2     | typo      | C   | 1          |
| 3     | adapters  | C   | 1          |
| 4     | adapters  | B   | 1          |
| 5     | ingestion | B   | 1          |
| 6     | ingestion | C   | 1          |

Run one top-level trial at a time. B is ordinary single-agent execution. C uses
the v2 skill with delegation explicitly disabled. The first B/C pair doubles as
an instrumentation smoke test; retain both observations, including failures.
One pair per workload is exploratory, not evidence of a stable improvement.

Optional extension, only when selected before starting: permit ten total runs
with an agreed total budget. Append A/typo, A/adapters, A/ingestion, D/adapters,
all repetition 1. A uses the approved stronger model with ordinary execution.
D uses the B/C coordinator model and permits native workers. This block tests
model selection and delegation, but its fixed order remains a limitation.
Do not silently replace an unavailable arm with another configuration.

### Measurement and stopping

1. Record exact requested and effective models/settings separately. Null means
   unavailable. Do not claim model switching from a prompt alone.
2. Stop dispatching when launch or wall limits are reached. Stop the active trial
   and descendants using supported native cancellation at the per-run deadline.
   Poll/wait in intervals no longer than 60 seconds. If cancellation cannot be
   enforced, disclose this before launching; do not promise a hard runtime cap.
3. No hidden-test feedback or post-grading repairs. Trial workers may use visible
   tests; allow at most two repairs for B/C/A. D follows the skill's bounded loop,
   but no external stronger-model consultation is authorized by these defaults.
   The deadline overrides all remaining repair allowances.
4. Count failed runs and timeouts. Do not re-run until successful or delete costly
   observations. A harness repair creates a new experiment block and requires new
   fixtures; it does not erase the original failures.
5. Separate experiment-controller overhead from trial tokens and elapsed time.
   Report controller usage if available; otherwise say it is unmeasured. No total
   experiment cost claim is permitted when controller/descendant usage is missing.

## 6. Technical Constraints

- `AGENTS.md` remains the sole repository contract. Preserve all pre-existing
  staged work and unrelated untracked files. Do not reset, stash, or bulk stage.
- Native workers need their assigned `work/` directory, necessary policy, and
  arm instructions only. No inherited conversation, solved fixtures, evaluator,
  held-out cases, test-only solutions, or other arms' output.
- Use native filesystem/process isolation when available. A prompt restriction
  and the harness hashes are not an OS sandbox. Record actual isolation; if fresh
  sessions or required separation cannot be provided, report the blocked arm.
- C/D may read the skill and the active provider reference as explicit read-only
  context. Preserve identical common task/policy context across arms; the skill's
  extra context is the intended treatment. Never copy skill files into `work/`:
  extra files fail the evaluator's scope checks.
- Keep fixtures and evaluator sources fixed throughout a comparison block.
- Node 22.5 or later is required. No new dependencies or engine/UI changes.
- Generated code executes with evaluator permissions. Inspect it before execution
  and use an appropriate native sandbox. Stop if it attempts network access,
  launches unrelated processes, or reads/writes outside its assignment.

## 7. Implementation Notes

### Action 1 — establish a checkpoint and run preflight

From the checkout, inspect `git status --short` and record existing changes locally.
Run the commands in section 8. Resolve actual tools for fresh sessions, model
selection, waiting/cancellation, lifecycle events, and per-session usage once.
Use callable native agent tools; do not invent command flags or tool parameters.
Do not use user-visible task creation unless the operator explicitly requests new
tasks. Internal subagents are authorized when this execution handoff is invoked.
If nested agents are unavailable, mark D unavailable; B/C can still run if fresh
trial sessions are supported. If usage is unavailable, use null and continue only
with an explicitly labeled time/quality comparison.

### Action 2 — prepare the experiment directory

Create a fresh temporary directory outside the checkout. Store its path in a local
variable named `pilot_dir`; never repurpose HOME or CODEX_HOME. Store the checkout
path in `repo_dir`. Keep local metadata in this experiment directory:

```text
run-config.md
ledger.json
normalized-metrics.json
summary.json
evaluations/
fixtures/
```

Keep native session identifiers and absolute paths in the private ledger only.
Public metrics use aliases such as `b-typo-1-main`. For every scheduled row, create
a fresh fixture with the following command, replacing the workload and alias:

```bash
node scripts/workflow-pilot/prepare.mjs typo "$pilot_dir/fixtures/b-typo-1"
```

Capture the returned `root`, `work`, and manifest. Never reuse a solved directory.
Do not infer matching fixture identity from filenames: retain the evaluator's
actual `fixtureId` for the results. Prepare all arms from the same unchanged harness.

### Action 3 — dispatch one trial with this common prompt

Replace placeholders before dispatch. Keep the common wording identical:

```text
Work only in <WORK_DIR>. Read TASK.md and satisfy every requirement.
Only edit the writable files named there. Preserve TASK.md, visible tests,
and unrelated files. Do not create extra files or install dependencies.
You may run the visible checks. Do not read the benchmark harness,
held-out cases, manifests, other trial directories, or solution files.
Follow the attached applicable repository restrictions.
No network access, external communication, commits, or publishing.
Do not measure your own time or estimate token usage.
Return a concise list of changes, checks actually run, and remaining failures.
<ARM_INSTRUCTION>
```

Use exactly one arm instruction:

- **A/B:** “Use ordinary single-agent execution. Do not load the complex-task
  workflow skill or delegate. Use visible checks and at most two repair attempts.”
- **C:** “Read and apply <SKILL_PATH>. Use the current model. Delegation and external
  consultation are disabled for this trial. Keep the direct exit for simple work.
  Use visible checks and at most two repair attempts.”
- **D:** “Read and apply <SKILL_PATH>. Native delegation is permitted with at most
  two workers using <LOW_MODEL>/<REASONING>. You own summary.mjs and integration;
  workers may exclusively own json.mjs and csv.mjs respectively. Delegate only if
  the skill's usefulness criteria pass. Do not delegate recursively or consult an
  additional model. Include worker identifiers in your return.”

Use a verified model-setting argument when supported, not merely its name in the
prompt. For D, observe whether delegation actually occurred; a sequential fallback
does not establish delegation savings. Essential repository restrictions must be
supplied explicitly when the worker has no inherited policy context.

### Action 4 — record lifecycle, grade, and checkpoint each trial

Before dispatch, record the trial alias and requested configuration. Record native
dispatch/start and completion/cancellation events outside the trial. Include launch,
skill reading, visible checks, workers, integration, and reporting in elapsed time.
If native timestamps are unavailable, use controller-observed before-dispatch and
after-completion timestamps consistently and label the measurement as observed,
including polling delay. No timing-only calls inside the trial.

After all descendants stop, inspect the changes and run from the checkout:

```bash
node scripts/workflow-pilot/evaluate.mjs "$pilot_dir/fixtures/b-typo-1" > "$pilot_dir/evaluations/b-typo-1.json"
```

Capture the exit status even when nonzero; grading failure is a result. Do not let
a shell's fail-fast behavior skip result collection. Record quality and scope
violations exactly as emitted. A cancelled run cannot be reported as completed
merely because its partial files pass: retain cancellation in the ledger/report
and exclude it from success claims. The current normalized schema has no status
field; do not invent one or falsify evaluator counts to encode cancellation.

Checkpoint the ledger after each trial: status, actual session tree, effective
models/settings, timing source, isolation, evaluation path, usage source, missing
telemetry, and budget remaining. For an aborted or ungradeable trial, retain its
observed time/usage in the report's failures table even if no valid normalized
record can be constructed. Never fabricate required timestamps or quality counts.

### Action 5 — normalize counters and summarize

Use the exact schema and example in `docs/agent-workflows.md`, under “Normalized
metrics schema.” Populate one record per gradeable trial with valid lifecycle data:

1. Copy arm, workload, repetition, actual fixtureId, timestamps, and quality.
2. Give each coordinator/descendant a globally unique neutral session alias.
3. Collect final cumulative counters once per session; do not sum snapshots.
   Prefer fresh sessions. Reused sessions require a reliable pre-run subtraction.
4. Count cached input as a subset of input. Total processed tokens = input + output.
   Do not double-count reasoning tokens or descendants already included by a provider.
5. Populate `treeComplete` only from a complete observed inventory. Unknown model,
   reasoning, usage, or counter is null. Missing values are never zero.
6. Read only identified pilot sessions, and only the usage metadata required.
   Never copy raw transcripts or credentials into the normalized artifact.

Then run:

```bash
node scripts/workflow-pilot/summarize.mjs "$pilot_dir/normalized-metrics.json" > "$pilot_dir/summary.json"
```

The summarizer cannot encode cancellation, isolation failures, or all instruction
violations. Cross-check its output against the ledger before drawing conclusions.
If no valid measured records exist, do not create fake ones to make it run: deliver
a blocker report. Cost remains null unless a separately authorized, sourced pricing
analysis is performed; this task does not modify the cost schema.

### Action 6 — write the comparison report

Create `docs/workflow-comparison-v2-results.md`; if it already exists, preserve it
and choose an unused date-suffixed filename. Include:

1. Date, experiment profile, actual model/reasoning choices, sample size, and limits.
2. A row for every attempted trial: arm, workload, status, seconds, checks passed /
   total, scope violations, input, cached input, output, total tokens, completeness.
3. B/C paired time and token deltas by workload. Use `(B - C) / B * 100`; positive
   means reduction. Do not divide by zero or compute a token delta from partial data.
4. A/B and C/D only if those arms actually ran comparably. Explicitly identify
   configuration drift, declined delegation, shared context, and cache differences.
5. Controller overhead, missing metrics, failures, cancelled/ungradeable trials,
   and reasons any scheduled arm was skipped. Never omit expensive failed attempts.
6. A plain conclusion: observed improvement, regression, or inconclusive. Six or
   ten one-repetition trials cannot satisfy the three-pair provisional threshold.
   No overall efficiency win or cheaper-model savings claim from token counts alone.
7. Exact verification commands and outcomes. Clearly separate live results from
   offline harness tests. Recommend the next experiment only if evidence warrants it.

Review the report for private identifiers and absolute machine paths. Keep raw
artifacts outside Git. Do not update historical numbers to represent v2 trials.

## 8. Test Requirements

Before live execution, run from the repository root:

```bash
node --version
node --test scripts/workflow-pilot/pilot.test.mjs
npx eslint 'scripts/workflow-pilot/**/*.mjs'
node --check scripts/workflow-pilot/prepare.mjs
node --check scripts/workflow-pilot/evaluate.mjs
node --check scripts/workflow-pilot/summarize.mjs
```

Expected existing baseline: 19 tests pass. Stop live dispatch if required preflight
fails. Type checking and the full engine/Cockpit suites are unnecessary for a
results-only task. If a harness defect requires code edits, implement its regression
test with the fix, run relevant checks, and start a separately identified block.

After creating the report, format that exact file and run `npm run format` and
`npm run format:check`, then `git diff --check`. Review formatter changes and
preserve unrelated work. Stage only the new sanitized report for the public scan:

```bash
git add -- docs/workflow-comparison-v2-results.md
npm run scrub
gitleaks git --pre-commit --staged --redact --no-banner
git diff --cached --check
git diff --cached --name-status
```

Substitute the actual filename if a suffix was needed. Existing staged files remain
staged. Do not bypass missing scanners or local sanitization configuration.
**No commit on failing tests.** No commit or push is requested even if checks pass.

## 9. Acceptance Criteria

1. Every scheduled row has either actual results or a specific skipped/blocked reason.
2. B/C use the same effective model/reasoning and fresh identical starting fixtures.
3. Results include quality, elapsed time, available token categories, and uncertainty.
4. Failed, cancelled, and incomplete runs remain visible; no fabricated measurements.
5. Actual worker/model behavior is documented separately from requested behavior.
6. The report and verification results pass the public-repository checks, or clearly
   name the failed gate without claiming release readiness.
7. No unapproved paid matrix, persistent settings changes, commit, or publication.

## 10. Deliverables

1. Sanitized comparison report in `docs/`.
2. Local run configuration, checkpoint ledger, evaluator outputs, normalized metrics,
   and summary outside the checkout; link them locally without publishing private paths.
3. Final response containing the result table, limitations, report link, and checks.
4. Code/test changes only if an actual harness defect required a separately tracked fix.

## 11. Mandatory Agent Rules

1. Follow `AGENTS.md`; this file is task instructions, not a replacement contract.
2. Execute required checks before any subsequently authorized commit.
3. Never commit with failing tests. Report exact commands and outcomes honestly.
4. Ask once for genuinely missing authority/configuration; continue independent
   offline preparation while awaiting it. Do not ask again for already accepted limits.
5. Do not finish by saying only that the harness works. Produce live observations
   when execution is authorized and supported, or a precise capability blocker.
6. Resume from the ledger after interruption. Do not relaunch a completed/active
   trial or reset its limits because conversational context was lost.

## 12. Assumptions and Open Questions

- This document is a planning artifact. No new live trials have run while writing it.
- The operator will open it in the desired lower-cost model and authorize execution.
- Proposed default is six B/C trials, 20 minutes total, three minutes per run, with
  no paid API use. The operator may accept or change those values at launch.
- Concrete model IDs and reasoning settings are deliberately runtime-resolved,
  not hardcoded guesses. Unknown telemetry remains explicitly unavailable.
- The six-run profile measures instruction overhead. Measuring stronger-model
  selection and native delegation additionally requires the optional A/D extension.
