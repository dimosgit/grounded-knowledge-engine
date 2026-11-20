# Use GKE with an Obsidian vault

Obsidian is where you read and write notes. GKE is where your coding agent
remembers. Both work on the same folder of Markdown files, so nothing is
imported, exported, or synchronized. GKE is not affiliated with Obsidian; it
simply reads and writes the same files.

## Two-minute demo

```bash
gke demo
cd gke-demo
gke setup
```

1. Open Obsidian, choose **Open folder as vault**, and pick `gke-demo/kb`.
   The demo ships a starter configuration: dark theme, graph colors by folder,
   and attachments saved in an `assets` subfolder.
2. Open **Start here** and press `Cmd/Ctrl+G` for the graph.
3. Restart Claude Code or Codex in `gke-demo` and keep the graph visible while
   you ask, for example:
   - "Why did we keep the default MCP profile small?"
   - "What's in the tunnel threat model?"
   - "What does the router cost to host each month?" (the notes do not say)
   - "Remember for the transport review: tunnels now close automatically after
     30 minutes." (watch the project note change in Obsidian)

What to look for:

- **Cited answers.** Every answer names the file and line it came from.
- **Honest gaps.** A question the notes cannot answer gets "not in your notes",
  not a guess.
- **Retention without clutter.** When the agent learns something, it updates the
  note that owns the fact. Obsidian shows the change as soon as the file is
  written; a new note appears in the graph only when no note owns the fact yet.

## Your own vault

Point a workspace at the vault folder (see
[workspace configuration](../workspace-config.md#using-an-obsidian-vault)):

- Block-list properties, `aliases`, `[[wiki-links]]`, `![[embeds]]` and inline
  `#tags` are understood.
- `.obsidian/` and `.trash/` are never indexed.
- Writes keep list properties as lists. GKE writes standard Markdown links,
  which Obsidian also reads.
- The optional `ui.obsidian` setting adds **Open in Obsidian** to the local
  Cockpit reader.
