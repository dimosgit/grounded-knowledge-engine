---
name: grounded-knowledge-workflow
description: Use Grounded Knowledge Engine to select an isolated workspace, answer from local evidence, resume an explicitly identified project, create an explicit project checkpoint, and retain durable knowledge. Trigger when a user asks about their documents, workspace or client context, previous research, project state, decisions, handoffs, or wants useful new context preserved across Claude, Codex, Gemini, GitHub Copilot, or another MCP-capable agent.
---

# Grounded Knowledge Workflow

Use the engine as shared memory, not as a replacement for judgment. Keep this
skill thin: select the semantic operation and let the MCP server and CLI enforce
retrieval, project scope, citations, and writes.

## Use the one-call Q&A fast path

- For an ordinary definition, recall, explanation, or comparison, call
  `kb.answer_and_capture` exactly once with `responseMode: auto` and
  `responseFormat: compact`, and `captureStrategy: auto`.
- Do not call `kb.search` or `kb.get_record` before it. The answer tool performs
  its own retrieval and grounding. Automatic retention is read-only.
- After a successful call, return the answer, citations, capture status,
  `tokenUsage`, and `timings` immediately.
- No note or review proposal is created by this fast path. Continue into
  maintenance only when the user explicitly asks for curation or retention.

## Choose the operation

1. For a named project or “continue where I stopped,” call
   `kb.resume_project` with the explicit `projectId`.
2. For an evidence-only search request, call `kb.search`.
3. For one known record, call `kb.get_record` by path, title, slug, or filename.
4. For a grounded answer that may retain useful context, call
   `kb.answer_and_capture`.
5. For project creation and administration, use the deterministic `gke` project
   CLI rather than inventing an MCP file-management workflow.
6. When the user explicitly asks to preserve a project handoff or progress
   boundary, use `gke checkpoint`; never create one merely because a project was
   viewed or resumed.
7. When the user explicitly asks to preserve or inspect a durable decision, use
   the full-profile decision MCP tools when available. Use the local
   `gke decisions` CLI for administration or when the MCP server is running the
   core profile. Local Cockpit preview/apply may append a reviewed change; the
   public Cockpit remains read-only.

## Ground before answering

- Check local knowledge first for questions about the user's documents,
  projects, prior research, or previous decisions.
- Base factual claims on returned evidence and preserve workspace-relative
  citations.
- Distinguish sourced facts from inference or recommendations.
- If evidence is insufficient, say what is missing. Do not turn a weak match
  into certainty.
- Use external research only when the user asks for it or local evidence cannot
  answer a question that genuinely requires current information. Keep external
  findings distinct from existing local knowledge.

## Report the visible token footprint

- Include the `tokenUsage` summary returned by `kb.answer_and_capture` or the
  grounded answer service near the end of the user-facing answer.
- Preserve its label: a GKE visible-text estimate is not the provider-billed
  total and does not include hidden instructions, reasoning, or agent overhead.
- If a provider supplies exact usage, prefer that value and label it as provider
  reported. Never silently turn an estimate into an exact count.

## Preserve boundaries

- Require an explicit project ID for project resume.
- Never infer project membership from semantic similarity alone.
- If a project is unknown or empty, stop clearly; never fall back to global
  search and present it as project context.
- Treat the active MCP process as one workspace. Do not attempt to switch
  workspace through a tool argument.
- When multiple vaults exist, select the separately named MCP entry before
  retrieval or mutation. Confirm the workspace identity returned by GKE when
  client context matters.
- Never expose absolute host paths when workspace-relative citations suffice.

Register and select vaults through setup, not through an MCP request:

```bash
npm run setup:mcp -- --workspace client-alpha \
  --workspace-root "/path/to/client-alpha"
npm run setup:mcp -- --workspace client-alpha
npm run setup:mcp -- --list-workspaces
```

Named vaults default to writes disabled. Use `--writes` only when the selected
workspace configuration explicitly allows writes.

## Retain deliberately

- Capture only durable, reusable knowledge: decisions, verified explanations,
  project facts, unresolved questions, or procedures worth recalling later.
- Avoid capturing transient chat, speculation, secrets, or duplicated material.
- Keep `captureStrategy: auto` for ordinary Q&A; it never writes, even when
  workspace writes are enabled.
- Use `captureStrategy: note` or `captureStrategy: open_question` only when the
  user explicitly asks to retain knowledge. Supply a deliberate title and
  routing context rather than turning the raw question into a topic name.
- For explicit retention, preview consequential or unclear writes with `dryRun`
  before persisting.
- Tell the user what was captured and where. Never imply a write occurred if it
  was skipped or rejected.

## Administer projects through the CLI

Run project commands from the engine repository or through the installed `gke`
binary:

```bash
gke create <project-id> --title "<title>"
gke list
gke show <project-id>
gke update <project-id> --current-focus "<focus>"
gke link <project-id> <workspace-relative-source>
gke checkpoint <project-id> --title "<label>" \
  --what-changed "<change>" --next-start "<starting point>" \
  --evidence "<workspace-relative-path>:<line>"
gke validate <project-id>
```

Checkpoint evidence must be workspace-relative, line-addressed, and explicitly
inside project scope. Preview uncertain checkpoint writes with `--dry-run`.
Validate after creating, updating, or linking a project. Preserve Markdown as
the canonical source of truth.

## Preserve and replay decisions

The MCP full profile exposes read-only `kb.get_decision` and
`kb.list_decisions`. With writes enabled it also exposes
`kb.record_decision`, `kb.review_decision`, and `kb.supersede_decision`.
Mutation tools are deliberately absent when writes are disabled. The ledger
and individual records are also readable through:

```text
gke://workspace/decisions
gke://decision/{decisionId}
```

The Cockpit exposes a Decision Ledger and Decision Replay detail view. It shows
freshness, the original evidence snapshot, classified changes, and review
history. In local development, `Review what changed` validates citations and
previews the evidence diff before enabling an explicit canonical write. The
static public build remains read-only, while MCP and CLI review remain
available for automation.

Use explicit, cited inputs. Do not convert an inferred recommendation into an
active decision without the user's intent. Use `responseFormat: compact` by
default and request `full` only when the complete evidence snapshot or review
history is needed. Treat every stale warning as user-visible.

For local administration or a core-profile connection, use the CLI:

```bash
gke decisions create <decision-id> --title "<title>" \
  --owner "<owner>" --status active --confidence medium \
  --decided-at <YYYY-MM-DD> --evidence-checked-at <YYYY-MM-DD> \
  --review-after <YYYY-MM-DD> --question "<question>" \
  --recommendation "<recommendation>" --rationale "<rationale>" \
  --evidence "<workspace-relative-path>:<line>"
gke decisions get <decision-id> --as-of <YYYY-MM-DD>
gke decisions list --review-state overdue
gke decisions review <decision-id> --reviewed-at <YYYY-MM-DD> \
  --review-after <YYYY-MM-DD> --reviewer "<reviewer>" \
  --supported uncertain --evidence "<path>:<line>@weakened"
gke decisions supersede <decision-id> <replacement-id> \
  --superseded-at <YYYY-MM-DD> --reason "<reason>"
```

Active decisions require at least one validated evidence citation. Project
decisions accept evidence only from explicit project scope. Use `--dry-run`
before uncertain mutation and preserve visible due/overdue warnings. Reviews
must not replace the original evidence snapshot. Use explicit classifications;
do not infer factual contradiction from text similarity. Supersession must
retain both records and their bidirectional links.
