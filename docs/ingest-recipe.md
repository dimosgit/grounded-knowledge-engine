# Capture recipe — ingesting a document via chat

Use this when you want to feed a document (notes, spec, PDF, spreadsheet) into
the Grounded Knowledge Engine through Claude Code, Codex, Gemini CLI, or another
MCP-capable agent with the `kb` server connected. The agent extracts the key
facts and captures them as a KB note via `kb.upsert_note`; every later answer is
then grounded in them.

> Real captures require the MCP server to run with writes enabled.
> `npm run setup:mcp` configures this by default for Claude Code, Codex, and
> Gemini CLI (it sets `KB_MCP_ENABLE_WRITES=true` in each client adapter); use
> `--no-writes` for a read-only server, where captures fall back to a safe
> dry-run preview.

## Prompt template

Paste this into the chat **with the document attached**:

```text
Read the attached document and capture it into the KB.

Steps:
1. Derive a clear, specific title.
2. Summarize the key facts as bullet points. Preserve IDs, dates, system names,
   and decisions verbatim — do not paraphrase identifiers.
3. Do NOT include any secrets, passwords, API keys, or tokens in the note.
4. Call kb.upsert_note with:
   - kind: "topic"
   - title: <your title>
   - module: <best-fit module key, e.g. general>
   - type: "concept"
   - status: "draft"
   - tags: ["ingested"]
   - body: the summary, with a first line:
     "> Source: <document name> — ingested <today> via chat."
   - dryRun: false   (use true to preview first)
5. Tell me which KB file was written, then run kb.refresh.
```

## Verifying the capture

Ask a question whose answer lives only in the document:

```text
Use kb.answer_grounded (allowDirect=true) to answer: <question about the doc>.
Show the citations.
```

The freshly captured note should appear in the citations. If it doesn't, the
capture likely ran as a dry-run (check that `KB_MCP_ENABLE_WRITES=true`) or the
question didn't share enough vocabulary with the note — refine and retry.

## When to use the CLI instead

For batches, or for binary files where you want consistent local extraction
rather than the desktop app's, use the CLI:

```bash
npm run ingest -- ./inbox
```

See [`document-ingestion-plan.md`](document-ingestion-plan.md) for the full
design and format support.
