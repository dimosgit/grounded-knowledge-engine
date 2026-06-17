# Demo KB Sources and Attribution

The demo knowledge base is built from public, openly licensed sources plus a thin
layer of original orchestration notes authored for this repository.

## Real sources (bulk knowledge layer)

| Source | URL | Ref | Date pulled | License | What changed |
|---|---|---|---|---|---|
| Model Context Protocol docs | https://github.com/modelcontextprotocol/docs | `main` (2026-06-17) | 2026-06-17 | MIT (© 2024–2025 Anthropic, PBC and contributors) | Concepts from the architecture / tools / resources pages were **paraphrased** into short original Markdown notes (`demo-kb/topics/mcp-source-*.md`). No verbatim text was copied; each note records its upstream `source:` path in front matter. |

The upstream MIT license notice is preserved verbatim in
[`demo-kb/NOTICES/modelcontextprotocol-docs-LICENSE.txt`](../demo-kb/NOTICES/modelcontextprotocol-docs-LICENSE.txt).

## Original content (orchestration shell)

The following are synthetic notes written specifically for this demo to exercise
the project-tracking and capture surfaces; they are not derived from any external
source:

- `demo-kb/topics/router-project-board.md` — project board (`## Current status`,
  `## Next 3 actions`, `## Blockers`), conceptually linked to building an
  MCP-grounded router on top of the MCP docs above.
- `demo-kb/open_questions.md` — open questions log.
- `kb/topics/mcp-primitive-decision.md` — a decision note written by the MCP smoke
  test to demonstrate the capture → retain → reuse loop.

## Reproducibility note

The notes are paraphrases pinned to the upstream `main` branch as pulled on
2026-06-17. When refreshing the demo corpus, update the `Ref` / `Date pulled`
columns above and re-run `npm run eval` to confirm retrieval still passes.
