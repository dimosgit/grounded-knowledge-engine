# tools/ingest — document ingestion

Turns documents (PDF, DOCX, XLSX, PPTX, HTML, CSV, JSON, XML, ZIP, EPUB,
Markdown, and text) into KB topic notes under `kb/`, so the grounding engine and
the cockpit graph pick them up unchanged. Fully local — no external API.

For the user-facing guide and the design rationale, see the README's
[`## Ingesting documents`](../../README.md) section and
[`docs/document-ingestion-plan.md`](../../docs/document-ingestion-plan.md). This
file is for developers working on the ingestion code itself.

## Usage

```bash
npm run ingest -- <folder> [--module <key>] [--project [name]] [--dry-run] [--no-scrub] [--max-chars <n>]
```

| Flag                    | Default        | Meaning                                                                                                                                                                         |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<folder>` (positional) | `./inbox`      | Folder to scan recursively for supported files.                                                                                                                                 |
| `--module <key>`        | `general`      | Module frontmatter key for the captured topic notes.                                                                                                                            |
| `--project [name]`      | off            | Also create a canonical project record (named after the folder when `name` is omitted) and link every captured note as a key document. Reuses the project if it already exists. |
| `--dry-run`             | off            | Extract and preview notes without writing to the KB.                                                                                                                            |
| `--no-scrub`            | off (scrub on) | Disable secret/API-key redaction.                                                                                                                                               |
| `--max-chars <n>`       | `12000`        | Chunk threshold; longer documents split into `(part N)` notes.                                                                                                                  |

The CLI uses the shared Capture Planner and workspace policy directly, then
refreshes retrieval after accepted writes. It hashes raw bytes before
conversion and records the converter, converter version, extraction settings,
accepted hash, and generated note paths in `kb/sources/<source-id>.md`.
Unchanged bytes and settings skip conversion completely. Changed or removed
chunks enter the existing capture review queue; `.gke/ingest-candidates/` keeps
the candidate version pending until every associated proposal is applied or
rejected.
With `--project`, the project record is created through the shared
`tools/projects` service before the index refresh: the ingest folder becomes a
`source_roots` entry when it lives inside the workspace, and each note is
linked explicitly under Key documents — membership stays explicit-only.

### Converter selection

Rich documents use Microsoft MarkItDown when the local CLI is available. The
native Node extractors remain in place for deterministic tests and as fallback
for PDF/DOCX/XLSX.

```bash
python -m pip install 'markitdown[all]'

GKE_INGEST_CONVERTER=auto npm run ingest -- ./inbox        # default
GKE_INGEST_CONVERTER=native npm run ingest -- ./inbox      # old Node path
GKE_INGEST_CONVERTER=markitdown npm run ingest -- ./inbox  # require MarkItDown
GKE_MARKITDOWN_BIN=/path/to/markitdown npm run ingest -- ./inbox
```

`GKE_MARKITDOWN_TIMEOUT_MS` defaults to `60000`. Markdown and plain text always
use the native pass-through path.

## Pipeline

```text
hash → detect → extract → normalize → capture/review → source record → index
```

## Modules

| File                 | Responsibility                                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractors.ts`      | `detectFormat`, `extractText`. MarkItDown is preferred for rich documents in `auto` mode; PDF/DOCX/XLSX fall back to `unpdf`, `mammoth` raw text, and `exceljs` sheet-to-Markdown extraction. Markdown/text are pass-through. Returns text, warnings, and cached converter identity/version provenance.        |
| `normalize.ts`       | `deriveTitle` (heading → short first line → filename), `scrubSecrets` (AWS keys, JWTs, bearer tokens, private-key blocks, `key=secret` assignments), `chunkText` (split on `##` boundaries / size, hard-split over-long lines), `normalizeDocument` (orchestrates + prepends a `> Source: …` provenance line). |
| `source-record.ts`   | Stable source identity, extraction-settings hashing, canonical source record parsing/rendering, and workspace-authorized atomic writes.                                                                                                                                                                        |
| `candidate-state.ts` | Operational candidate-run state and capture-proposal resolution; finalizes the accepted source record only after all proposals apply.                                                                                                                                                                          |
| `ingest.ts`          | CLI orchestration: hash before conversion, skip accepted unchanged sources, create non-conflicting notes, queue changed/removal proposals, preserve topic metadata and project links, and print source-aware counts.                                                                                           |
| `fixtures/`          | `tokens.ts` (unique tokens per format) + `make-fixtures.ts` (generates the committed `sample.*` binaries). Regenerate with `npm run ingest:fixtures`.                                                                                                                                                          |

## Tests

```bash
npm run test:ingest:unit   # pure functions: detect, title, chunk, scrub, slug, normalize
npm run test:ingest        # binary retrieval plus source identity, unchanged short-circuit,
                           # one/many chunk transitions, proposal apply/reject, and links
```

Both are plain `node:assert` scripts (the convention for `tools/` tests). The
integration test spawns the real CLI and a verification MCP server against a
temp-dir sandbox, so it never writes to the real `kb/`.

## Design notes / boundaries

- **Canonical provenance lives in source records.** Generated topic notes also
  carry `source_id`, ingest-root-relative `source_uri`, and `source_chunk`
  frontmatter while preserving unknown existing fields.
- **Candidate state is operational.** `.gke/ingest-candidates/` is never scanned,
  synchronized into the Cockpit content bundle, or exported as knowledge.
- **MarkItDown is optional but preferred** for rich documents because it gives a
  consistent Markdown conversion layer across Office, web, archive, and ebook
  inputs. It runs with the current process privileges, so only ingest documents
  you trust.
- **Native extractors stay available** for PDF/DOCX/XLSX via
  `GKE_INGEST_CONVERTER=native`, and as fallback when `auto` cannot run
  MarkItDown.
- **Scanned, image-only PDFs** are detected and skipped with a warning — OCR is
  out of scope.
- **Adding a format:** extend `EXTENSION_MAP`; if MarkItDown supports it, the
  rest of the pipeline usually needs no changes.
