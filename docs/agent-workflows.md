# Complex task workflows

The optional [complex-task skill](../skills/complex-task-workflow/SKILL.md)
coordinates substantial implementation work. GKE continues to own evidence,
project resume, and explicitly authorized capture.

The always-loaded repository contract is the activation gate. The skill is
explicit-only because live testing showed that description-based automatic
selection loaded it for routine work. Native model-setting details are in the
[Codex reference](../skills/complex-task-workflow/references/codex.md) and
[Claude Code reference](../skills/complex-task-workflow/references/claude-code.md).
The repository's `.agents/skills` link exposes this source to Codex without copying
it. Claude installations can expose the same source through their normal skill
setup. The npm package does not include it, and no user-level settings are changed.
Do not load the skill for routine work. The packaged grounding skill falls back
normally when the source is absent.

## Activation and token-first execution

Routine edits, clear fixes, small synthetic tasks, and sequential work stay with the
current model without loading the skill. The previous design put the gate in skill
discovery metadata, but automatic selection still loaded the workflow in two of
three routine trials. The current design puts a short gate in `AGENTS.md` and marks
the full skill explicit-only. A defensive early exit remains for misrouting.

Even after activation, a single coordinator is the default. Total tokens take
priority over elapsed time. A worker is useful only when its separate context
replaces a large body of coordinator context or the user explicitly prioritizes
parallel speed. Unknown worker overhead counts against delegation.

Model discovery occurs only when a worker will actually be spawned. The workflow
uses the runtime's native model and reasoning arguments; prose does not select a
model. Token-priority mode permits at most one lower-capability worker for a narrow,
independently testable deliverable. Time-priority mode may use two concurrent
workers with disjoint write ownership. Same-model workers are a possible time
optimization, not a token or cost optimization.

Worker prompts carry only objective, relevant paths, exclusive write scope, settled
interface, and one acceptance check. The coordinator verifies the diff and command
without repeating the worker's exploration. One targeted repair is allowed before
the coordinator takes over or reports the blocker. No reviewer or stronger model
is added by default.

## Historical v1 pilot

On 2026-09-14 a paired same-model Codex pilot completed a typo, a small two-module
feature, and a parser repair. Both arms used `gpt-6-astra` and passed 26 independent
checks with no repairs.

| Metric                           | Ordinary execution | V1 workflow |
| -------------------------------- | -----------------: | ----------: |
| End-to-end time                  |          111.847 s |   110.702 s |
| Total processed tokens           |            472,723 |     355,709 |
| Cached input (included in input) |            433,152 |     346,496 |
| Output tokens                    |              2,120 |       2,415 |

There was one pair, differing cache conditions, and about 32,500 initial context
tokens per agent. Timing-only calls also differed between arms. No nested workers,
model switching, or Claude trial ran. These numbers do not prove workflow savings.

An exploratory v2 B/C trial is documented in the
[v2 comparison results](workflow-comparison-v2-results.md). It preserved quality
but did not expose effective model or token telemetry, and it did not establish a
time or cost improvement.

The [v3 comparison](workflow-comparison-v3-results.md) collected native token
counters. It rejected implicit skill invocation after measuring routine-task
regressions. The current explicit-only policy showed lower median tokens across
three complete equal-quality pairs, while median time increased. A shared usage
limit interrupted one additional pair, so the token result remains exploratory
rather than a proven overall win.

## Offline pilot tools

The utilities under [scripts/workflow-pilot](../scripts/workflow-pilot/prepare.mjs)
use built-in Node.js and never contact providers or load credentials. They create
fresh synthetic assignments, independently grade outputs, and summarize normalized
metrics. They do not launch agents.

Three workloads are available:

| Workload    | Worker assignment                                                          | Writable files                          |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------- |
| `typo`      | Exact text correction                                                      | `README.md`                             |
| `adapters`  | JSON and CSV import adapters with a shared contract and integrated summary | `json.mjs`, `csv.mjs`, `summary.mjs`    |
| `ingestion` | Idempotent ingestion, changed content, and exact project isolation         | `store.mjs`, `ingest.mjs`, `search.mjs` |

Each generated `work/TASK.md` states complete requirements and scope. The larger
workloads include visible regression tests and unrelated files that must stay
unchanged. Independent acceptance cases and test-only correct solutions remain in
the repository, outside the worker's assigned directory.

### Prepare and evaluate

Run from the repository root with Node 22.5 or later:

```bash
node scripts/workflow-pilot/prepare.mjs adapters
```

The command prints a new temporary `root`, its `work` directory, and a manifest.
Optionally pass a second argument naming an empty output directory outside the
checkout. Existing non-empty targets, repository overlaps, and symlinked parent
paths into the checkout are rejected. Create a fresh directory for every arm,
workload, and repetition; never reuse a solved fixture.

Give the worker only its `work` path, `TASK.md`, applicable repository policy, and
the chosen arm instructions. The coordinator retains `manifest.json`. Configure
native sandbox boundaries where available so workers cannot modify the manifest,
read held-out cases, or access other arms. Path checks and hashes detect certain
violations; they are not an OS sandbox.

After the worker finishes, replace the example path below with the printed root:

```bash
node scripts/workflow-pilot/evaluate.mjs /path/to/pilot-directory
```

Evaluation verifies fixture and evaluator checksums, protected files, and file scope
before and after running acceptance cases. It returns a fixture checksum,
case outcomes, passed/total counts, and scope violations. Required failures produce
a nonzero exit code; crashes or a ten-second acceptance timeout also fail. The child
process executes generated JavaScript with the evaluator process's permissions.
Review generated code and run evaluation in an appropriate native sandbox; the
subprocess timeout does not provide filesystem/network isolation.

Keep evaluator sources stable during a trial matrix. Any change requires fresh
fixtures and a new comparison block. Do not give agents held-out results before
their final submission; visible tests provide their feedback loop.

### Collect metrics outside the worker

Use native task-start and task-complete events for overall start/end times.
Include startup, skill loading, checks, all workers, integration, waiting, and final
reporting. Do not ask workers to call a clock or self-estimate tokens.

Collect each identified session's final cumulative counters once, including the
coordinator and every descendant. If a session was reused, subtract its recorded
pre-run counters before supplying this run's usage; prefer fresh sessions. Do not
sum cumulative event snapshots. A runtime that already aggregates descendants
requires separating those totals before this per-session input can be used.

Read only the explicitly identified pilot sessions. Never export raw transcripts,
credentials, paths, or private context. Use neutral session aliases in the metrics.
The summarizer accepts only the documented fields, but syntactically valid labels
can still contain identifying text: review the normalized file before publication.

Record `treeComplete: true` only when the coordinator/descendant inventory is
complete. An absent expected session, null model, null usage/counter, or an explicitly
incomplete tree results in partial aggregate usage. Observed per-model subtotals
are retained and labeled as observed, not complete. A model or reasoning value that
the client does not expose must be null.

### Normalized metrics schema

This is a synthetic record illustrating schema version 1, not an observed result.
Use the real evaluator's `fixtureId` and quality output, and actual lifecycle data.

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "arm": "B",
      "workload": "adapters",
      "repetition": 1,
      "fixtureId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "startedAt": "2026-09-14T00:00:00.000Z",
      "endedAt": "2026-09-14T00:01:00.000Z",
      "coordinatorId": "run-b-1-main",
      "treeComplete": true,
      "expectedSessionIds": ["run-b-1-main"],
      "sessions": [
        {
          "id": "run-b-1-main",
          "model": "example-model",
          "reasoning": "medium",
          "usage": {
            "inputTokens": 1000,
            "cachedInputTokens": 800,
            "outputTokens": 100
          }
        }
      ],
      "quality": { "passed": 10, "total": 10, "scopeViolations": 0 }
    }
  ]
}
```

All fields are required; `model`, `reasoning`, `usage`, and individual counters
accept null for unavailable data. Labels permit letters, digits, dots, underscores,
and hyphens. Session aliases must be unique across the file. Timestamps use UTC with
milliseconds. Duplicate runs, duplicate sessions, unexpected fields, unsupported
versions, negative counters, and impossible cache/time ranges are rejected.

```bash
node scripts/workflow-pilot/summarize.mjs /path/to/normalized-metrics.json
```

The output includes every run (including failures), per-model observed usage,
end-to-end durations, arm medians/ranges, and paired comparisons. Cached input is
already part of input. Total processed tokens are input plus output. Do not add a
reasoning subset to output twice; normalize counters according to their native
semantics. Providers with additional billing categories need explicit support before
cost comparison. This version leaves `costEstimate` null and never claims an
overall efficiency win. It does not silently crawl local client logs.

## Performance evaluation procedure

Before launching a matrix, agree on concrete model/reasoning choices and a trial
duration/usage budget. No settings installation or client repair is part of the pilot.

| Arm | Setup                                                                  | Purpose                      |
| --- | ---------------------------------------------------------------------- | ---------------------------- |
| A   | Strong model, ordinary single-agent execution                          | Model-quality baseline       |
| B   | Operator-selected lower-cost model, ordinary single-agent execution    | Lower-cost baseline          |
| C   | Same B settings with the repository's explicit-only routing policy     | Routing-policy effect        |
| D   | Same coordinator settings as C with explicit time-priority parallelism | Parallel wall-time trade-off |

Give all arms the same requirements and visible checks. In C, keep the skill
available but let the repository contract decide whether to read it. Record
requested and effective models, reasoning, skill activation, all descendants, and
cumulative usage.

Use B/C on a simple task to confirm that C does not activate and therefore adds no
workflow context. Use a genuinely substantial workload for routing. D is a separate
time-priority experiment; higher token use can still make it a failed token
optimization even if it is faster. Start with one smoke run, then use at least three
rotated repetitions per comparison when the agreed budget permits.

Compare A/B for model selection, B/C for instruction overhead, and C/D for
delegation. The summarizer requires matching repetitions, fixture checksums, and
quality totals. B/C and C/D need matching known coordinator model/reasoning values.
A/B need different known coordinator models. Model eligibility, authority compliance,
and cache balance still require human review.

A token improvement requires complete coordinator and descendant usage and lower
median total tokens with equal quality. A time improvement requires at least three
matched passing repetitions and at least 20% lower median end-to-end time. Treat
time and tokens separately: D can trade one for the other. Always retain failures
and individual observations. If ordinary lower-cost execution wins, keep it and
remove the extra workflow from that task class.

## Verification and status

Offline checks:

```bash
node --test scripts/workflow-pilot/pilot.test.mjs
npx eslint 'scripts/workflow-pilot/**/*.mjs'
node --check scripts/workflow-pilot/prepare.mjs
node --check scripts/workflow-pilot/evaluate.mjs
node --check scripts/workflow-pilot/summarize.mjs
npm run format:check
npx prettier --check 'skills/complex-task-workflow/**/*.md' docs/agent-workflows.md
git diff --check
```

The offline suite tests correct and broken fixture solutions, protected output paths,
changed tests/evaluator baselines, execution-time mutations, timeouts, metric
aggregation, unknown telemetry, comparisons, and failed-run retention.

Instruction review confirms the explicit-only full workflow, always-loaded routing
gate, single-coordinator default, token-first worker limit, native model argument
requirement, compact handoff, one repair, and no automatic memory capture. These are
document checks, not proof of runtime savings.

Implemented: token-first skill instructions and discovery metadata, provider
references, synthetic fixtures, evaluator, offline metrics summarizer, and
regression tests. No package/setup changes or persistent model defaults were added.

Completed: one exploratory v2 B/C trial across all three synthetic workloads.
Effective model/reasoning and per-session token telemetry were unavailable, so it
does not establish model selection, workflow savings, or cost savings. Claude
trials, native delegation trials, unattended execution, and automatic
cross-provider routing remain unestablished.

Current status: the token-first revision keeps the source checkout discoverable but
disables implicit invocation. The repository contract makes the routing decision
without an extra skill-loading turn, and the full entrypoint remains under 3,600
bytes. Runtime savings still require comparable trials with complete activation,
model, and descendant-usage telemetry.

The loaded `SKILL.md` entrypoint decreased from 5,281 to 3,239 bytes (38.7%).
Provider references are conditional and their combined size decreased from 8,641
to 3,399 bytes (60.7%). These byte counts demonstrate a smaller visible instruction
payload; they are not provider token counts.
