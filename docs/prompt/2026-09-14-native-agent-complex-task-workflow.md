# 1. Feature Title

Native Claude Code and Codex coordination for complex GKE tasks

Status: **implementation brief; proposed workflow, not implemented**.
Findings recorded on 2026-09-14. This document is a bounded implementation
assignment, not a second agent operating contract. `AGENTS.md` remains canonical.

## 2. Objective

Make complicated assignments easier for lower-cost models to execute by giving
them explicit work packets, dependency boundaries, verification requirements,
and a bounded recovery loop. Let native Claude Code or Codex capabilities
coordinate workers and select configured model tiers while GKE continues to
provide grounded evidence and durable project continuity. Start with a reusable
skill and documented provider adapters; measure value before building a runner.

## 3. Context

- Product area: agent workflow instructions and repository integration.
- Current behavior: GKE retrieves evidence, supports project resume and explicit
  checkpoints, and retains authorized knowledge. Its existing workflow skill
  routes these operations but does not specify a complex-task execution protocol.
- Problem: large assignments can accumulate unnecessary context, repeat failed
  approaches, or delegate work without clear ownership and acceptance checks.
- Evidence boundary: findings come from checked-out source and official product
  documentation. No workflow benchmark or live cross-provider trial was performed.

### Repository evidence to read

| Source                                                 | What it establishes                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                            | Canonical authority, workspace boundaries, separate npm trees, verification and publication rules |
| `skills/grounded-knowledge-workflow/SKILL.md`          | Existing grounding, explicit retention, resume, and checkpoint workflow                           |
| `tools/grounding/answer-service.ts`                    | Grounded-answer service; not a model-routing engine                                               |
| `tools/projects/checkpoint-service.ts`                 | Existing checkpoint creation and scoped evidence validation                                       |
| `docs/architecture.md`                                 | Deterministic engine with CLI, MCP, and Cockpit surfaces                                          |
| `docs/separation-of-concerns.md` and `gke.layers.json` | Source ownership, dependencies, and scoped verification                                           |
| `package.json`                                         | Actual scripts and packaged-file allowlist                                                        |

### External findings and limits

1. Claude Code supports custom subagents with their own context, instructions,
   tools, and model settings. Delegation can follow a subagent's description.
   This supports selecting a configured specialist; it does not prove optimal
   complexity classification. Source:
   [Claude Code subagents](https://code.claude.com/docs/en/subagents).
2. Claude Code's `opusplan` uses Opus during planning and Sonnet during execution.
   This is phase-based switching. Source:
   [model configuration](https://code.claude.com/docs/en/model-config).
3. Claude Code documents an experimental advisor that the main model can consult
   at decision points. Availability depends on the supported provider, model,
   account, and configuration. It adds usage and is optional for this proposal.
   Source: [advisor](https://code.claude.com/docs/en/advisor).
4. Codex supports subagents with configurable models and reasoning effort.
   Current local releases delegate after a direct request or applicable project
   or skill instruction. Inheritance and configuration precedence matter.
   Source: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
5. Native delegation does not require adding an MCP server. GKE MCP still serves
   the separate purpose of grounded memory. A prompt-level execution loop does
   not guarantee restart recovery, scheduling, or durable unattended execution.

Recheck official documentation and the installed client's supported configuration
before writing provider examples. Do not copy model identifiers or configuration
keys from memory, promise account access, or describe an untested adapter as tested.
The friend's actual setup was not inspected; the mechanisms above are plausible
explanations, not a diagnosis of that setup.

## 4. Scope

In scope:

1. One opt-in complex-task skill with a simple-task fast path.
2. Explicit task packets, role assignments, dependency order, and file ownership.
3. Abstract fast, balanced, and strong model tiers, resolved through supported
   local client capabilities and operator preferences.
4. A bounded execute/verify/repair procedure and concise handoff format.
5. Separate Claude Code and Codex usage references with sequential fallback.
6. Synthetic acceptance scenarios and a small manual comparison protocol.
7. Minimal discoverability links in existing repository documentation.

Out of scope:

1. New MCP tools, model APIs, credentials, routing services, or SDK dependencies.
2. A scheduler, daemon, persistent job queue, autonomous cross-provider manager,
   or claims that execution survives a closed session.
3. New GKE record types, database tables, Cockpit screens, or automatic KB capture.
4. Installing or rewriting user-level skills, `.claude/`, `.codex/`, generated
   local settings, or changing the active main model without user authority.
5. Packaging or setup-command changes in this first iteration. Repository use
   and documented manual activation are enough; distribution is separate work.
6. A blanket instruction to delegate all tasks or use the strongest model for all
   work. Cost savings are a hypothesis to evaluate.

## 5. Requirements

### R1. Select the execution shape

Choose a shape before spawning workers and explain it in one short sentence:

| Condition                                                                   | Shape                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Clear, local change with straightforward verification                       | One agent, direct execution                                     |
| Unclear behavior, shared design decisions, or tightly coupled files         | One agent plans first; sequential implementation                |
| Two or more ready, independently verifiable work packets                    | Coordinator plus bounded workers                                |
| Repeated failure, conflicting evidence, or consequential design uncertainty | Focused stronger-model consultation if available and authorized |

Classify using uncertainty, consequences of mistakes, dependencies, and
verifiability. Prompt length alone is not a complexity signal. Inspection of
source code uses local files; user-project context follows existing GKE routing.
Do not force memory retrieval into an ordinary source-code implementation task.

### R2. Use a minimal work packet

Every delegated assignment must supply these fields; `none` is valid where
appropriate. Keep the packet concise and link evidence instead of copying a
whole conversation.

```text
ID and objective:
Required output:
Inputs and evidence paths:
Dependencies and frozen interface assumptions:
Allowed write paths (or read-only):
Acceptance checks and commands:
Role and requested model tier:
Retry budget:
Return: changed files, checks/results, unresolved issues, next action.
```

The coordinator owns the integrated result. A worker's self-reported success is
input to verification, not proof that the task is complete.

### R3. Bound ownership and concurrency

- Use at most two workers concurrently by default, within the client's actual
  capacity. The coordinator can perform independent useful work while they run.
- Only the coordinator assigns workers; do not request recursive delegation.
- Give each writable file one owner at a time. Shared manifests, interfaces, and
  integration changes default to the coordinator.
- Finalize shared contract changes before dependent engine/UI implementation.
- If files overlap, serialize work. Use isolated worktrees only if supported
  and useful; do not assume workers get isolation automatically.
- Use `gke.layers.json` for scope guidance. Cockpit tests and builds must run
  sequentially because they both synchronize content.
- Run workers in parallel only when they can make progress without waiting for
  another worker's unfinished output.

### R4. Route models conservatively

| Role                                                            | Default tier                                             | Escalation trigger                                    |
| --------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Explorer: read files, identify relevant paths and facts         | Fast                                                     | Conflicting evidence or broad architectural ambiguity |
| Implementer: bounded change against agreed behavior             | Balanced                                                 | Failure budget reached or specification inconsistency |
| Reviewer: check consequential assumptions and integrated result | Strong for consequential work; balanced for routine work | Unresolved failure with material impact               |

Roles are assignments, not a requirement to spawn three agents. Small tasks use
one agent. The active conversation can act as coordinator without switching its
model. Do not use model self-reported confidence as the sole routing criterion.

Resolve a tier only to a model the client exposes and the operator permits.
Record the requested tier and the actual model if observable; otherwise record
`not reported`. If model selection is unavailable, inherit the current model
and disclose the fallback. If delegation is unavailable, run packets sequentially
in the current session. Do not install another system to bypass these limits.

### R5. Bound verification and recovery

1. Define observable completion checks before implementation.
2. Execute the ready packet and run its relevant checks.
3. On failure, identify the failing behavior and revise the hypothesis before
   another edit; avoid repeating an unchanged command as a repair strategy.
4. Allow at most two repair attempts after the initial implementation attempt
   for each packet. After that, use at most one focused consultation if supported
   and authorized, followed by one final repair attempt.
5. The consultation does not reset the budget. If still failing, report the
   blocker, evidence, and next required input. Continue unrelated ready work only
   where it remains valid.
6. Stop when acceptance checks pass. Do not keep reviewing indefinitely or claim
   success when a required check is unavailable.

This is an instruction-level budget, not a runtime-enforced guarantee. Report
attempts honestly. User-set tighter limits take precedence. A successful command
alone does not establish behavior that the command did not test.

### R6. Separate session progress from durable memory

Maintain a short task table in session context: ID, dependency, owner, status,
acceptance evidence, and remaining retries. Valid statuses are ready, running,
blocked, and done. This is not a new canonical GKE schema.

At completion or a blocker, report achieved behavior, changed files, verification,
remaining work, and a precise next start. Use existing checkpoint/decision/capture
operations only when the user explicitly authorizes persistence and workspace
policy permits it. Never turn speculative worker notes into durable facts.

## 6. Technical Constraints

1. Preserve `AGENTS.md` as the only operating contract. The new skill supplies a
   procedure and references existing policy rather than duplicating it.
2. Keep GKE provider-neutral. Model routing belongs to native agent configuration
   and instructions, not `tools/grounding`, `tools/projects`, or MCP transport.
3. Do not change the existing one-call grounded Q&A path or explicit capture rules.
4. Preserve unrelated tracked and untracked work and private workspace files.
5. Use sanitized examples and repository-relative paths in committed materials.
6. Treat current official documentation as necessary but insufficient evidence of
   local availability. Explain unsupported features and continue with fallback.
7. No automatic publishing, pushing, installation, or credential use is authorized
   by this brief. Commit only when separately requested.

## 7. Implementation Notes

Implement one packet at a time. Read this brief and `AGENTS.md`, then inspect only
the files needed for that packet. Do not ask a cheaper worker to redesign the
architecture or implement all optional future features.

### Packet A — reusable workflow

- Dependencies: none.
- Write scope: `skills/complex-task-workflow/SKILL.md` only.
- Create the skill using the client's available skill-creation guidance.
- Trigger on explicit complex-task workflow use, or substantive multi-step work
  where the applicable runtime permits skill activation. Include R1's fast path.
- Implement R1–R6, including packets, model fallback, ownership, and retry limits.
- Link provider-specific behavior to reference files created in Packet B.
- Exit check: a reader can execute the procedure without inventing missing
  ownership, escalation, completion, or persistence rules.

### Packet B — native client references

- Dependency: A's workflow contract agreed.
- Write scope: `skills/complex-task-workflow/references/claude-code.md` and
  `skills/complex-task-workflow/references/codex.md`.
- Read current official docs before specifying configuration syntax.
- Provide a native activation prompt for each client and an optional, documented
  model-tier mapping example. Keep examples inert: do not write active settings.
- Explain main-model selection versus worker-model selection; changing a worker
  does not silently change the conversation model.
- Claude: explain custom subagents; describe `opusplan` and advisor as optional
  alternatives with their different semantics and availability restrictions.
- Codex: explicitly request bounded subagents in the activation prompt; describe
  supported model/reasoning controls and inheritance. Do not assume proactive
  delegation is enabled in every session.
- Exit check: both references include a no-subagents/no-model-control fallback,
  source links, and a distinction between documented and locally tested behavior.

### Packet C — discovery and evaluation

- Dependencies: A and B complete.
- Write scope: `docs/agent-workflows.md`, a short link in `README.md`, and a short
  cross-reference in `skills/grounded-knowledge-workflow/SKILL.md`.
- Explain how to invoke the new workflow from a source checkout without claiming
  it is shipped by the existing package or automatically installed.
- Put scenarios and the comparison protocol from section 8 in the guide.
- Preserve the existing skill's fast path and capture semantics.
- Do not alter `AGENTS.md` unless integration truly needs one small reference;
  do not add blanket delegation authority. Explicit activation suffices for v1.
- Exit check: document what is implemented, what is manual, and what remains
  proposed; no implied scheduler or durable executor.

### Packet D — integration review

- Dependencies: A–C complete.
- Coordinator owns corrections to shared files and final verification.
- Review all requirements against the final files and execute section 8 checks.
- Return a requirement-to-file checklist, command results, manual trial results
  if run, and remaining limitations. Do not claim hypothetical benchmark results.

Future trigger: consider a runner only after measured demand for restart recovery,
unattended schedules, durable retries, or cross-provider execution. That requires
a separate design and authorization.

## 8. Test Requirements

1. Implement behavior and its validation together. For this instructions-only
   iteration, use the scenario matrix below and formatting checks; do not add
   brittle tests that merely assert prose contains certain words. If executable
   code or configuration generation enters scope later, add meaningful automated
   regression tests in the same change.
2. Run the following from the repository root after implementation:

   ```bash
   npx prettier --write skills/complex-task-workflow/SKILL.md skills/complex-task-workflow/references/*.md skills/grounded-knowledge-workflow/SKILL.md docs/agent-workflows.md README.md
   npx prettier --check skills/complex-task-workflow/SKILL.md skills/complex-task-workflow/references/*.md skills/grounded-knowledge-workflow/SKILL.md docs/agent-workflows.md README.md
   git diff --check
   ```

   Root `npm run format` does not include all nested documentation and skill
   files, so explicit formatting is required. Use the root format command when
   required by repository policy and inspect for unrelated formatting changes.

3. If executable engine behavior changes in separately approved scope, run
   `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:gke`.
   Setup/package changes additionally warrant `npm run test:mcp:setup` and
   `npm run test:package`. None is a substitute for native-client trials.
4. Before any authorized commit, run relevant checks, stage only intended files,
   and run `npm run scrub`. The scrub gate does not fully cover untracked new
   files. Report missing scanner/overlay prerequisites as blocked verification.
5. **No commit on failing tests.** Never label an unrun check as passed.

### Scenario matrix

Evaluate the final instructions against every row. Mark instruction review and
actual client execution separately; a paper walkthrough is not a live test.
Use temporary synthetic fixtures for live trials.

| Scenario                                   | Required outcome                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| One-file typo                              | Single agent; no forced delegation or capture                                   |
| Engine and UI feature with shared contract | Contract first; independent work only after interface agreement                 |
| Two workers need the same file             | One owner; serialize or reassign                                                |
| Worker reports done but check fails        | Packet remains incomplete; recovery budget consumed explicitly                  |
| Two repairs fail                           | One consultation at most, one final repair, then concrete blocker if unresolved |
| Subagents disabled                         | Same packets executed sequentially                                              |
| Requested model unavailable                | Inherit available model and disclose; no fabricated model identity              |
| User asks only for implementation          | No automatic KB note/checkpoint                                                 |
| User authorizes handoff capture            | Existing scoped checkpoint path and policy used                                 |
| Cockpit verification                       | Test and build run sequentially                                                 |
| Fresh session without persisted progress   | No claim to remember execution; request or reconstruct evidence                 |

### Comparison protocol

Use three fixed sanitized assignments: a narrow edit, a cross-layer feature, and
a reproducible failing-test diagnosis. For each, compare a single-agent baseline
with this workflow using the same starting revision, acceptance criteria, and
permissions. Use isolated disposable checkouts so one run cannot help the other.

Record completion and acceptance results, elapsed time, actual model(s), repairs,
and provider-reported usage when available. Mark unavailable metrics explicitly;
GKE visible-text estimates are not provider-billed totals. Run at least one paired
trial per assignment as a pilot, and report that three pairs cannot establish a
general cost advantage. Expand trials only if the pilot warrants it. Do not claim
the workflow is cheaper when billing/usage evidence is unavailable.

## 9. Acceptance Criteria

1. The new skill is explicitly usable from chat and retains a simple-task path.
2. Every delegated packet has a testable output, dependencies, ownership, and a
   bounded failure policy; parallel work cannot silently overlap file ownership.
3. Both provider references use verified documentation and explain model selection
   limits, explicit activation, and sequential fallback.
4. The complete scenario matrix has recorded review outcomes; live trials are
   distinguished from instruction walkthroughs and unavailable trials.
5. Existing grounding, memory authorization, engine behavior, and package setup
   remain unchanged apart from documented discovery links.
6. Formatting and applicable checks pass, or failures are reported with no commit.
7. No cost, autonomous execution, packaging, or restart guarantees exceed evidence.

## 10. Deliverables

1. One reusable skill and two provider reference files from A–B.
2. A usage/evaluation guide and minimal links from C.
3. Scenario validation results, plus live trial results only if actually executed.
4. An implementation summary with changed files, exact commands and outcomes,
   requirement coverage, and remaining limitations.
5. Automated tests with any separately authorized executable behavior change;
   no unnecessary runtime code or testing framework for this documentation phase.

## 11. Mandatory Agent Rules

1. Follow `AGENTS.md`; this brief adds task procedure, not competing policy.
2. Execute all required checks before any separately authorized commit.
3. Never commit code with failing tests. **No commit on failing tests.**
4. Report exact commands executed and whether each passed, failed, or was blocked.
5. Escalate concrete blockers instead of skipping required validation.
6. Preserve unrelated work. Do not install configuration, push, deploy, or publish.
7. Complete A, then B, then C, then D by default. Delegation is optional and only
   useful for independently bounded work; a cheaper single model can do all four.

## 12. Assumptions and Open Questions

Assumptions:

1. The immediate goal is a repository-scoped, chat-invoked workflow; a durable
   orchestration service is not required.
2. Fast/balanced/strong tiers are stable conceptual roles; exact model IDs and
   prices must be resolved locally, not hardcoded into shared policy.
3. Two concurrent workers and the specified repair budget are conservative
   starting defaults, not benchmark-proven optima.
4. The user will authorize implementation separately by assigning this brief.
   Creating this document does not install or activate its proposed workflow.

Open questions, non-blocking for A–C:

1. Which locally available models should map to each tier? Default to inherited
   model when no verified operator preference exists.
2. Should the skill later ship in the package or through client setup? Defer until
   the repository workflow is validated.
3. Are elapsed time, usage, or reduced supervision most valuable to the operator?
   Collect all available pilot measurements without assuming a single priority.
