# Portable GKE demo workspace

This folder is generated from `demo-kb` by the real project CLI:

```bash
npm run export:demo-projects
npm run project -- list --repo-root examples/demo-project-workspace
npm run project -- validate --repo-root examples/demo-project-workspace
```

It uses the canonical portable layout:

```text
kb/
├── projects/<project-id>/project.md
├── sources/<project-id>/
└── topics/
```

Point the MCP server or another local GKE checkout at this directory to use the
same demo without creating duplicate project IDs in the main repository.
