# GEMINI.md

This file provides guidance to Gemini CLI when working with code in this
repository. The canonical agent guidance is shared across Claude Code, Codex,
and Gemini CLI in a single file to prevent drift:

@AGENTS.md

Gemini CLI specifics:

- This repo's `kb` MCP server adapter is generated into `.gemini/settings.json`
  by `npm run setup:mcp` (machine-local, gitignored). If the file is missing,
  run that command before expecting `kb.*` tools to resolve.
