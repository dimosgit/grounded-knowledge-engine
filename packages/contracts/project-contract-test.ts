#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createProjectMembership,
  selectProjectNextActions,
  PROJECT_CONTRACT_VERSION,
  calculateProjectAttention,
  meaningfulSectionItems,
  normalizeProjectId,
  parseProjectDocument,
  sectionSummary,
} from "./src/projects.js";

const fixture = `---
record_type: project
project_id: Boundary Example
workspace_id: demo
status: active
source_roots: kb/sources/boundary-example, kb/topics/shared.md
---

# Boundary Example

## Current focus

Keep UI and engine interpretations aligned.

## Next 3 actions

- Add the contract package
- Preserve soft-wrapped
  project actions
- [ ] Verify the Cockpit adapter

## Blockers

- None.

## Key documents

- [Evidence](../../sources/boundary-example/evidence.md)
`;

assert.equal(PROJECT_CONTRACT_VERSION, 1);
assert.equal(normalizeProjectId(" Boundary Example "), "boundary-example");

const parsed = parseProjectDocument(fixture, "kb/projects/boundary-example/project.md", "Fallback");
assert.equal(parsed.manifest.projectId, "boundary-example");
assert.equal(parsed.manifest.workspaceId, "demo");
assert.deepEqual(parsed.manifest.sourceRoots, [
  "kb/sources/boundary-example",
  "kb/topics/shared.md",
]);
assert.equal(
  sectionSummary(parsed.sections.get("current-focus")),
  "Keep UI and engine interpretations aligned.",
);
assert.deepEqual(meaningfulSectionItems(parsed.sections.get("next-actions")), [
  "Add the contract package",
  "Preserve soft-wrapped project actions",
  "Verify the Cockpit adapter",
]);
assert.deepEqual(meaningfulSectionItems(parsed.sections.get("blockers")), []);
assert.deepEqual(parsed.explicitPaths, ["../../sources/boundary-example/evidence.md"]);

assert.deepEqual(
  calculateProjectAttention({
    reviewAfter: "2026-09-05",
    asOf: "2026-09-06T12:00:00.000Z",
    status: "active",
    blockers: ["Waiting for approval"],
  }),
  {
    reviewState: "overdue",
    daysUntilReview: -1,
    needsAttention: true,
    attentionReasons: ["Review overdue since 2026-09-05", "1 blocker"],
  },
);

const membership = createProjectMembership(
  "sample",
  "kb/projects/sample/project.md",
  ["kb/sources/sample"],
  ["../../topics/shared.md"],
);
for (const relPath of [
  "kb/projects/sample/evidence.md",
  "demo-kb/projects/sample/evidence.md",
  "kb/sources/sample/note.md",
  "demo-kb/sources/sample/note.md",
  "kb/topics/shared.md",
]) {
  assert.equal(membership({ relPath }), true, relPath);
}
assert.equal(membership({ relPath: "kb/projects/unrelated/evidence.md" }), false);
assert.equal(
  membership({ relPath: "kb/elsewhere.md", frontmatter: { project_id: "Sample" } }),
  true,
);
const next = selectProjectNextActions({
  content: "## Delivery checklist\n- [ ] Current action\n- [ ] 🟡 Active action\n- [x] Done action",
  status: "active",
  recordedNextActions: ["Stale action"],
});
assert.deepEqual(next.nextActions, ["Active action", "Current action"]);
assert.equal(next.recommendedNextAction, "Active action");
assert.deepEqual(next.nextThreeActions, next.nextActions);
for (const content of [
  "## Delivery checklist\n- [x] Done",
  "## Delivery checklist\n",
  "- [ ] 🔴 Waiting",
]) {
  const finished = selectProjectNextActions({
    content,
    status: "active",
    recordedNextActions: ["Stale action"],
  });
  assert.deepEqual(finished.nextActions, []);
  assert.deepEqual(finished.nextThreeActions, []);
  assert.equal(finished.recommendedNextAction, "No next action recorded.");
}

console.log(`Project contract v${PROJECT_CONTRACT_VERSION} passed.`);
