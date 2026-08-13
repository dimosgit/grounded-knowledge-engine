# GKE Five-Minute Golden Path

This tutorial proves the complete Grounded Knowledge Engine loop inside Codex
or Claude:

1. connect GKE;
2. resume a project;
3. answer from local evidence;
4. retain one grounded learning;
5. retrieve it from a fresh agent session.

The walkthrough uses the packaged, writable demo workspace. It does not touch
your real project files.

## Before you start

- Install Node 22.5 or newer. Node 24 is recommended.
- Open a terminal in a directory where GKE may create `gke-demo/`.
- Have Codex or Claude available locally.

## 1. Install GKE

```bash
npm install --global https://github.com/dimosgit/grounded-knowledge-engine/releases/download/v0.2.1/grounded-knowledge-engine-0.2.1.tgz
```

Verify the installed release:

```bash
gke --version
```

Expected result: `0.2.1`.

## 2. Create and connect the demo workspace

```bash
gke demo
cd gke-demo
gke setup
```

`gke demo` creates a writable, sanitized workspace with canonical Markdown
under `kb/`. `gke setup` registers one local MCP server with Codex, Claude,
Gemini CLI, and GitHub Copilot, then runs a real protocol smoke test.

The generated client configuration is local to this workspace and ignored by
Git. Restart Codex or Claude from the `gke-demo` directory after setup.

## 3. Resume a project

Send this prompt to the fresh agent session:

> Use GKE to resume the `router-rollout` project. Give me the recommended next
> action, current focus, blockers, and the supporting citations. Do not inspect
> the files manually before calling GKE.

The agent should call `kb.resume_project`. Check that the response identifies
the Router Rollout project, recommends a next action, and cites workspace files
such as:

- `kb/projects/router-rollout/project.md`;
- `kb/sources/router-rollout/evidence.md`.

This proves that a fresh agent can recover structured project state without
reconstructing it from chat history.

## 4. Ask with evidence

Send:

> Use GKE's primary grounded Q&A operation to answer: Why does the router
> rollout keep Markdown as canonical project state? Include the evidence
> citations and do not retain a new note yet.

The agent should call `kb.answer_and_capture` once with automatic or disabled
retention. Its response should include a grounded answer, confidence, citations,
and a capture status showing that no write occurred.

## 5. Retain the grounded learning

Send:

> Answer that question with GKE again and retain the grounded result as a new
> topic titled `Golden Path Retained Learning` at
> `kb/topics/golden-path-retained-learning.md`. Scope it to project
> `router-rollout`. Tell me the exact capture action and path.

The agent should use `kb.answer_and_capture` with the explicit `note` capture
strategy and requested path. Because this is a new explicit destination in the
writable demo workspace, the expected result is one canonical Markdown create.

Verify it outside the model:

```bash
test -f kb/topics/golden-path-retained-learning.md && echo "Captured"
```

Expected result: `Captured`.

## 6. Retrieve it in a fresh session

Close the current agent session. Start a new Codex or Claude session from the
same `gke-demo` directory and send:

> Use GKE to retrieve `golden-path-retained-learning`. Explain the retained
> principle in one sentence and cite its file. Do not rely on previous chat
> context.

The agent should retrieve the new canonical note through `kb.get_record` or the
grounded Q&A path and cite:

```text
kb/topics/golden-path-retained-learning.md
```

You have now completed the compounding loop: resume, ground, capture, and reuse
across sessions.

## What this proves

- The agent works through the local MCP server from the existing CLI or IDE.
- Project state is explicit and recoverable in a fresh session.
- Answers carry workspace-relative evidence citations.
- Automatic Q&A does not silently retain knowledge.
- Explicit retention writes inspectable Markdown.
- The captured learning remains available after conversation history is gone.

## Use GKE with a real workspace

Run `gke setup` from the root of a project that contains a `kb/` or `demo-kb/`
folder. For a separately registered workspace vault, use:

```bash
gke setup --workspace my-project --workspace-root "/path/to/my-project"
```

Registered vaults default to writes disabled. Enable writes only when the
workspace's own `.gke/workspace.json` explicitly sets `readOnly` to `false`.

`gke setup` registers the server for that folder only. To reach the same
workspace from every folder, add `--scope user`, which writes each client's
home configuration instead:

```bash
gke setup --scope user
```

Either way, restart the client afterwards — clients read their MCP tool
catalog at startup. `gke setup --help` lists every option.

## Remove the demo

The demo is self-contained in `gke-demo/`. Delete that directory when you no
longer need it. Removing the directory also removes its generated local client
configuration and captured demo knowledge.
