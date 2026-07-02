# Security

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Instead use
[GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (**Security → Report a vulnerability**), or email the maintainer
directly at **dimobskn@gmail.com**.

You can expect an initial response within a few days. Please include reproduction
steps and the affected version/commit.

## Scope

This is a local-first tool: your documents, the derived index, and the MCP server all
run on your machine. The public `gke.dimouzunov.com` Cockpit is a static demo
frontend over sanitized repository content; it does not expose user workspaces,
the MCP server, or write tools. The most security-relevant areas are:

- the MCP server's stdio handling (`tools/kb-mcp-server`),
- the setup script that writes machine-local config (`npm run setup:claude`),
- and any path/file handling in the CLI ingestion (`tools/grounding`).

Findings that require an attacker to already control your local filesystem or to supply
malicious documents you then knowingly ingest are lower priority, but still welcome.
