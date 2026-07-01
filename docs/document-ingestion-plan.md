# Document Ingestion Plan — Grounded Knowledge Engine

**Status:** Implemented (v1 + v1.1, MarkItDown-enhanced). **Owner:** GKE. **Last updated:** 2026-07-01.

> Both phases shipped. v1 = the documented chat path
> ([`ingest-recipe.md`](ingest-recipe.md) + README). v1.1 = the local CLI
> (`npm run ingest`) with MarkItDown-backed rich document conversion plus native
> PDF/DOCX/XLSX fallbacks in `tools/ingest/`, covered by `npm run test:ingest`.
> This document remains the design reference.

## Why this exists

The way the GKE is used in practice is **document-first**: you feed real
documents — meeting notes, specs, PDFs, spreadsheets — into a Claude or Codex
chat, and the agent turns them into structured knowledge that grounds every
later answer. That "drop a document → it becomes durable project context" loop
is the most valuable thing the engine does for a newcomer, and right now it is
undocumented and only works for binary files if a human first converts them to
text by hand.

This plan makes document ingestion a **first-class, documented capability**, in
two phases, and treats **PDF / DOCX / XLSX as primary inputs — not a "future"
footnote.** Most people will feed exactly those formats; Markdown-only ingestion
is not enough.

## Design principle (do not violate)

Ingestion must not add a second source of truth. Per
[`docs/architecture.md`](architecture.md), **Markdown in
`kb/` is canonical and everything else derives from it.** Therefore:

> A document is ingested when its content has been turned into one or more
> well-formed Markdown KB notes under `kb/`. From that point the existing
> pipeline — retrieval/grounding (`tools/grounding/`), the MCP server
> (`tools/kb-mcp-server/`), and the cockpit graph (`apps/cockpit`) — works
> **unchanged**.

So ingestion is only ever an *input adapter* that ends in a `kb.upsert_note`
(or an equivalent direct Markdown write). It never touches grounding or
visualization. This is what keeps the surface area small and is why the
end-to-end loop test (`npm run test:loop`) already covers the "after capture"
half for free.

## The shared pipeline

Both phases run the same five stages; they differ only in **what drives them**
(a chat agent vs. a CLI):

```text
1. DETECT     file extension -> format
2. EXTRACT    format-specific -> plain text (+ light structure: headings, tables)
3. NORMALIZE  chunk, strip boilerplate, optional PII/secret scrub, derive a title
4. CAPTURE    kb.upsert_note  (kind: topic, with frontmatter) -> kb/topics/*.md
5. INDEX      kb.refresh -> retrievable + appears as a Context Graph node
```

Stages 4–5 already exist and are tested. The new work is stages 1–3, and
wiring a trigger for each phase.

---

## Phase v1 — Documented chat ingestion (Claude / Codex desktop)

**Goal:** make the workflow the author already uses reproducible by anyone, with
zero new code beyond docs + config.

**How it works:** the MCP server already exposes the write primitives
(`kb.upsert_note`, `kb.add_open_question`, `kb.answer_and_capture`). A user
connects the server to Claude or Codex desktop, drops a document into the chat
(the desktop app handles the file → text extraction), and asks the agent to
capture it. The agent calls `kb.upsert_note`, the note lands in `kb/`, and the
next question is grounded in it.

**What's required (all real, all small):**

- **Enable writes.** Writes are gated by `KB_MCP_ENABLE_WRITES` (default
  `false`, see `tools/kb-mcp-server/server.ts:71`). Document this clearly and
  ship a one-line setup note: real ingestion needs `KB_MCP_ENABLE_WRITES=true`.
- **A capture prompt / recipe.** A short, copy-pasteable instruction block:
  *"Read the attached document and capture it to the KB as a topic note: derive
  a title, summarize the key facts as bullet points, preserve any IDs/dates
  verbatim, then call `kb.upsert_note`."*
- **A guardrail note.** Remind users that desktop-app extraction quality varies
  and that captured notes should be reviewed (the engine is grounded, not
  authoritative).

**Limitation (acknowledged, acceptable for v1):** extraction depends on the
desktop app, so fidelity for complex PDFs/spreadsheets is whatever Claude/Codex
gives you. Phase v1.1 removes that dependency.

**Deliverables:** a `## Ingesting documents` section in the README + this plan,
and the capture recipe committed (e.g. `docs/ingest-recipe.md` or a
`kb.upsert_note` prompt template). No engine code changes.

---

## Phase v1.1 — CLI folder ingestion with real extractors

**Goal:** ingest binary documents directly, no chat app in the loop, fully
local, no external API calls.

**Trigger:** a new script, e.g. `npm run ingest -- ./inbox`, that walks a
folder and runs the pipeline on every supported file. Mirrors the existing
`tools/`-script pattern (`smoke-test.ts`, `evaluate-retrieval.ts`).

**Format support is the headline feature.** The current implementation prefers
the local Microsoft MarkItDown CLI for rich documents in `GKE_INGEST_CONVERTER=auto`
mode, then falls back to native Node extractors for PDF/DOCX/XLSX when needed.
`GKE_INGEST_CONVERTER=native` keeps the old path, while
`GKE_INGEST_CONVERTER=markitdown` makes MarkItDown mandatory.

| Format | Extension | Converter | Notes |
|---|---|---|---|
| PDF | `.pdf` | MarkItDown; native `unpdf` fallback | Text-layer PDFs work directly. Scanned/image PDFs need OCR (see risks). |
| Word | `.docx` | MarkItDown; native `mammoth.extractRawText` fallback | MarkItDown can preserve richer Markdown structure; native fallback prioritizes reliability. |
| Excel | `.xlsx`, `.xls` | MarkItDown; native `exceljs` fallback | Native fallback emits each sheet as a Markdown table and keeps sheet names as headings. |
| PowerPoint | `.pptx` | MarkItDown | Slide extraction is now covered by the shared converter instead of a custom parser. |
| Web/data/archive/ebook | `.html`, `.csv`, `.json`, `.xml`, `.zip`, `.epub` | MarkItDown | Supported when the MarkItDown CLI is installed. |
| Markdown / text | `.md`, `.txt` | built-in | Pass-through; minimal normalization. |

**Pipeline specifics for v1.1:**

- **Detect** by file extension (`EXTENSION_MAP` in `extractors.ts`). Magic-byte
  sniffing is a possible future hardening; not implemented.
- **Extract** via the table above. Tables and headings are preserved as
  Markdown so retrieval keeps structure (the BM25 retriever already weights
  titles/headings — see `tools/grounding/retriever.ts`).
- **Normalize:** chunk long documents (e.g. by heading or ~1–2k tokens),
  derive a title from filename + first heading, strip repeated headers/footers,
  and run an **optional secret/PII scrub** before anything is written (these are
  real-world business docs).
- **Capture:** write through `kb.upsert_note` (kind `topic`) so dedupe,
  frontmatter rendering, and the write gate all apply consistently — rather than
  hand-writing files. Source filename and ingest date go into frontmatter for
  provenance.
- **Index:** call `kb.refresh` once at the end; the cockpit graph then shows the
  new nodes automatically (covered by `graph-capture.test.ts`).

**Testing (extends the existing harness):**

- A fixtures folder (`tools/ingest/fixtures/`) with a tiny sample `.pdf`,
  `.docx`, and `.xlsx`.
- An ingestion integration test in the spirit of `loop-integration-test.ts`:
  ingest the fixtures into a sandbox KB → assert one KB note per document → ask a
  question keyed to content that only exists inside the binary file → assert it
  is retrieved and cited. This proves "feed a PDF → it's grounded" end-to-end.

---

## Scope boundaries / risks

- **Scanned PDFs (no text layer)** need OCR (e.g. `tesseract.js`). Out of scope
  for v1.1; detect and warn ("no extractable text — needs OCR") rather than
  silently producing an empty note.
- **Spreadsheet semantics.** Large/multi-tab workbooks can explode into noise.
  Cap rows/sheets and summarize rather than dumping everything.
- **Secrets/PII.** Business docs contain credentials and personal data. The
  scrub step is a requirement, not a nice-to-have, before this is recommended
  for shared/public KBs.
- **No external APIs.** All extraction stays local to honor the engine's
  "grounded, local-first" positioning.

## Checklist

- [x] v1: README `## Ingesting documents` section + `KB_MCP_ENABLE_WRITES`
      setup note.
- [x] v1: committed capture recipe / prompt template
      ([`ingest-recipe.md`](ingest-recipe.md)).
- [x] v1.1: `npm run ingest -- <folder>` script with detect → extract → normalize
      → `kb.upsert_note` → `kb.refresh` (`tools/ingest/ingest.ts`).
- [x] v1.1: PDF / DOCX / XLSX extractors wired (`unpdf`, `mammoth`, `exceljs` in
      `tools/ingest/extractors.ts`).
- [x] v1.1+: MarkItDown converter mode wired for rich document formats
      (`auto`/`native`/`markitdown` via `GKE_INGEST_CONVERTER`).
- [x] v1.1: provenance (source filename + ingest date) embedded in note body, and
      deterministic source-derived note paths so distinct files never collide.
- [x] v1.1: secret/key scrub stage on by default (`--no-scrub` to disable).
- [x] v1.1: fixtures + ingestion integration test asserting binary-doc content is
      grounded and cited (`npm run test:ingest`).
- [x] Detect-and-warn for scanned PDFs (OCR deferred).

Notes vs. the original plan:
- Provenance lives in the note **body** (a `> Source: …` line), not frontmatter,
  because `kb.upsert_note` renders a fixed frontmatter schema (no arbitrary
  fields). Same effect, no server change.
- DOCX native fallback uses `mammoth.extractRawText` (raw text) for reliability;
  MarkItDown is preferred when installed for richer Markdown conversion.
