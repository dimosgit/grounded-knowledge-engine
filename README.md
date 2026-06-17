# Grounded Knowledge Engine

A local-first engine for grounding AI-agent answers in a user-owned knowledge base,
then capturing useful new knowledge back into that base.

This repository is currently a private extraction workspace. The first public
release target is a clean, history-free repo containing only reviewed allowlisted
files, a demo knowledge base, and reproducible checks.

## Current Scope

- Engine first: Node.js, TypeScript, MCP.
- Optional UI: React cockpit under `apps/cockpit/`.
- Ingestion v0.1: Markdown and plain pre-extracted text.
- Demo content: pending license-checked source selection.

## Working Gates

```bash
npm run manifest:dry-run
npm run scrub
```

