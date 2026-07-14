---
name: grounded-knowledge-workflow
description: Use Grounded Knowledge Engine to answer from local evidence, resume an explicitly identified project, and retain durable knowledge. Trigger when a user asks about their documents, previous research, project state, decisions, or wants useful new context preserved across Claude, Codex, Gemini, or another MCP-capable agent.
---

# Grounded Knowledge Workflow

Use the engine as shared memory, not as a replacement for judgment. Keep this
skill thin: select the semantic operation and let the MCP server and CLI enforce
retrieval, project scope, citations, and writes.

## Use the one-call Q&A fast path

- For an ordinary definition, recall, explanation, or comparison, call
  `kb.answer_and_capture` exactly once with `responseMode: auto` and
  `responseFormat: compact`.
- Do not call `kb.search` or `kb.get_record` before it. The answer tool performs
  its own retrieval, grounding, deduplication, and capture planning.
- After a successful call, return the answer, citations, capture status,
  `tokenUsage`, and `timings` immediately.
- Do not inspect the written note, edit navigation/digests, or run broad KB
  checks afterward. Continue into maintenance only when the result reports an
  error or review requirement, or the user explicitly asks for curation.

## Choose the operation

1. For a named project or “continue where I stopped,” call
   `kb.resume_project` with the explicit `projectId`.
2. For an evidence-only search request, call `kb.search`.
3. For one known record, call `kb.get_record` by path, title, slug, or filename.
4. For a grounded answer that may retain useful context, call
   `kb.answer_and_capture`.
5. For project creation and administration, use the deterministic `gke` project
   CLI rather than inventing an MCP file-management workflow.

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
- Never expose absolute host paths when workspace-relative citations suffice.

## Retain deliberately

- Capture only durable, reusable knowledge: decisions, verified explanations,
  project facts, unresolved questions, or procedures worth recalling later.
- Avoid capturing transient chat, speculation, secrets, or duplicated material.
- When writes are disabled, use `kb.answer_and_capture` as a read-only grounded
  answer and report that capture was skipped.
- When a write is consequential or the intended note is unclear, preview with
  `dryRun` before persisting.
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
gke validate <project-id>
```

Validate after creating, updating, or linking a project. Preserve Markdown as
the canonical source of truth.
