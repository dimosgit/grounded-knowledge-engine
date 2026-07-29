# Open-Question Application Service

This module owns mutation of the compatibility document at
`kb/open_questions.md`. Protocol and UI adapters should call
the workspace-pinned `OpenQuestionApplicationService`; they should not accept
repository context per request or read and rewrite the document themselves.
The lower-level `mutateOpenQuestion` function remains available for focused
domain tests and integrations that already own a trusted workspace context.

## Contract

- Markdown remains canonical and keeps the existing `# Open Questions` entry
  syntax.
- Question text is normalized to one line, Unicode NFKC, collapsed whitespace,
  and lowercase for exact deduplication. No fuzzy matching is performed.
- A deterministic `entryId` is returned without adding an ID to legacy
  Markdown.
- Real mutations require an enabled write gate and a writable workspace.
  Dry-run still plans a result when writes are disabled.
- The application service pins the repository root, workspace policy, write
  gate, clock, and refresh callback once. Caller-controlled input cannot
  redirect a mutation into a different workspace.
- The workspace lock covers reading, duplicate detection, and atomic writing.
- Retrieval refresh runs once after a created or appended result, and never for
  `unchanged` or dry-run.

The repository in `open-question-repository.ts` is the only filesystem layer.
It authorizes the canonical file, temporary file, and lock through the shared
workspace path policy.

## Verification

Run the focused suite from the repository root:

```bash
npm run test:questions
```

The root `npm run test:gke` suite also includes these tests.
