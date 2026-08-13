# Workspace configuration reference (`.gke/workspace.json`)

One JSON file describes a workspace: its boundary (`scanRoots`/`writeRoots`),
its identity, its **domain vocabulary**, and its **viewer settings**. The
engine reads it once per process via `loadWorkspaceContext()`.

## Registering multiple local vaults

The optional machine-local `.gke/workspaces.json` registry maps workspace IDs
to absolute local roots. It is setup metadata, not canonical knowledge, and
must remain gitignored.

```bash
npm run setup:mcp -- --workspace client-alpha \
  --workspace-root "/path/to/client-alpha"
npm run setup:mcp -- --workspace client-alpha
npm run setup:mcp -- --list-workspaces
```

The first command registers the root and creates a separately named
`kb-client-alpha` adapter. Later commands resolve the ID from the registry.
Each adapter starts its own immutable workspace process. Named vaults default
to writes disabled; `--writes` requires `readOnly: false` in that vault's
`.gke/workspace.json`. The registry never enables cross-workspace retrieval.

## Registration scope (`--scope`)

Scope controls **where the client registration is written**, never which
knowledge base the server reads:

| Scope               | Writes to                                                                                                     | Visible from       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------ |
| `project` (default) | `.mcp.json`, `.claude/settings.local.json`, `.codex/config.toml`, `.gemini/settings.json`, `.vscode/mcp.json` | this checkout only |
| `user`              | `~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, VS Code's user `mcp.json`                | every folder       |

```bash
npm run setup:mcp -- --scope user
npm run setup:mcp -- --scope user --workspace client-alpha --writes
```

A knowledge base is a location, not a working directory: `KB_MCP_REPO_ROOT` is
written as an absolute path and the server resolves its root from that (falling
back to its own install path), never from `process.cwd()`. A user-scope adapter
therefore grounds against the same vault whatever folder the client is opened
in. Give each vault a distinct workspace ID before registering it at user
scope — server names share one namespace across all folders, so two default
`kb` registrations from different checkouts would collide.

User scope edits configs outside the repo, so the first write of each file is
copied to `<file>.gke-backup`. Clients cache their tool catalog at startup:
restart them to pick up the change.

## Committing the file

`.gke/` holds operational state and is gitignored. To version the
single-workspace configuration while keeping the local registry, proposals,
and candidates ignored, use a negation pair — order matters, and a plain
`.gke/` entry would make the negation dead:

```gitignore
.gke/*
!.gke/workspace.json
```

## Base fields

| Field         | Default                  | Meaning                                            |
| ------------- | ------------------------ | -------------------------------------------------- |
| `id`          | `default`                | Lowercase slug reported through MCP.               |
| `label`       | id                       | Human display name.                                |
| `scanRoots`   | `["demo-kb","kb"]`       | Workspace-relative roots the engine indexes.       |
| `writeRoots`  | `["kb",".gke",".cache"]` | Roots the engine may write beneath.                |
| `readOnly`    | `false`                  | Reject every write when true.                      |
| `sensitivity` | `internal`               | `personal \| internal \| sensitive \| restricted`. |

## `domain` — vocabulary block (all fields optional)

Without this block the engine behaves exactly as before the block existed
(`DEFAULT_DOMAIN_PROFILE`). With it, a specialized workspace configures what
previously required a code fork:

| Field                                                      | Purpose                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`, `labelTokens`                                     | Domain name in answer hints and the "what is X in `<domain>`?" glossary fast-path.                                                                      |
| `modeAliases`                                              | External mode names mapped onto the internal `domain`/`project` modes. Advertised in the MCP tool schemas and accepted by the search CLI and eval sets. |
| `queryExpansions`                                          | `{ merge: "extend"\|"replace", entries: { term: [expansions] } }`.                                                                                      |
| `textNormalizations`                                       | Extra regex rewrites applied before tokenization (indexing and queries).                                                                                |
| `pathMappings`                                             | `{ prefix, sourceKind?, track? }[]` — path-prefix classification.                                                                                       |
| `defaultTrack`                                             | Track name boosted in domain-mode scoring.                                                                                                              |
| `inferMode`                                                | `{ project: [regex], domain: [regex] }` for `mode: "auto"`.                                                                                             |
| `projectQueryPattern`                                      | How queries name the project workstream; domain-mode search penalizes project docs unless the query matches.                                            |
| `scoringRules`                                             | Additive rerank rules: `{ id, backend?, mode?, sourceKind?, module?, track?, queryRegex?, queryNotRegex?, boost }`.                                     |
| `captureDefaults`                                          | `{ track, module, tags, moduleTagRules }` stamped on captured/ingested topics.                                                                          |
| `primaryModuleRules`, `projectModeModule`, `defaultModule` | Query-pattern → module routing for captures.                                                                                                            |

Changing the block invalidates retriever caches automatically (the compiled
profile's fingerprint participates in cache keys and index manifest hashes).

## `ui` — cockpit viewer block

| Field                | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sourceFolders`      | `{ from, to? }[]` — folders synced into the viewer's content tree (overridable with `KB_PREVIEW_SOURCE_FOLDERS`). |
| `rootFiles`          | Repo-root standalone files (e.g. `readme.md`) synced alongside (`KB_PREVIEW_ROOT_FILES` overrides).               |
| `defaultActiveTrack` | Initial track filter in the viewer (default `all`).                                                               |

## Example: a specialized workspace

```json
{
  "id": "sap-learning-workspace",
  "scanRoots": ["kb", "reference-docs", "client-notes", "readme.md"],
  "domain": {
    "label": "SAP",
    "modeAliases": { "sap": "domain", "client": "project" },
    "queryExpansions": {
      "merge": "replace",
      "entries": { "rap": ["restful", "abap", "behavior", "eml", "cds"] }
    },
    "pathMappings": [
      { "prefix": "reference-docs/", "sourceKind": "reference-source", "track": "sap" },
      { "prefix": "client-notes/", "sourceKind": "project", "track": "sap" },
      { "prefix": "kb/", "track": "sap" }
    ],
    "defaultTrack": "sap",
    "projectQueryPattern": "\\bclient\\b",
    "captureDefaults": { "track": "sap", "module": "rap-core", "tags": ["sap", "kb-captured"] }
  },
  "ui": {
    "sourceFolders": [{ "from": "kb" }, { "from": "client-notes" }],
    "rootFiles": ["readme.md"],
    "defaultActiveTrack": "sap"
  }
}
```

## Governance checks (cockpit)

`npm --prefix apps/cockpit run check:kb` validates topic ownership, digest
structure, and maintenance cadence for workspaces that keep a
`kb/modules/topic-ownership.json` map. Workspaces without one pass with a
notice; CI for governed workspaces can enforce presence with
`check-topic-module-ownership.ts --require-ownership`. Point the checks (and
the viewer) at another workspace with `KB_PREVIEW_REPO_ROOT`.
