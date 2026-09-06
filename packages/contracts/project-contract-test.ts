#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  PROJECT_CONTRACT_VERSION,
  calculateProjectAttention,
  meaningfulSectionItems,
  normalizeProjectId,
  parseProjectDocument,
  sectionSummary,
} from "./src/projects.js";
import * as compatibilityApi from "../../tools/projects/project-manifest.js";
import * as attentionCompatibilityApi from "../../tools/projects/project-attention.js";

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

assert.equal(compatibilityApi.parseProjectDocument, parseProjectDocument);
assert.equal(compatibilityApi.normalizeProjectId, normalizeProjectId);
assert.equal(attentionCompatibilityApi.calculateProjectAttention, calculateProjectAttention);
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

for (const relativePath of [
  "../../apps/cockpit/src/domain/projects.ts",
  "../../apps/cockpit/src/components/LocalProjectDelta.tsx",
  "../../apps/cockpit/src/hooks/useOperatorAttention.tsx",
  "../../apps/cockpit/src/lib/workspace-review-api.ts",
]) {
  const browserConsumer = await fs.readFile(new URL(relativePath, import.meta.url), "utf8");
  assert.match(browserConsumer, /from "@gke\/contracts\/projects"/);
  assert.doesNotMatch(browserConsumer, /tools\/projects/);
}

console.log(`Project contract v${PROJECT_CONTRACT_VERSION} passed.`);
