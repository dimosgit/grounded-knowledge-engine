import assert from "node:assert/strict";
import { parseDecision } from "./src/decisions.js";
const fixture = `---
schema_version: 1
record_type: decision
decision_id: example
workspace_id: demo
project_id: example
title: Example decision
status: active
owner: test-owner
decided_at: 2026-09-01
evidence_checked_at: 2026-09-01
review_after: 2026-09-07
confidence: medium
updated: 2026-09-01
---
## Decision question
Which approach?
## Recommendation
Use the shared contract.
## Alternatives considered
- Duplicate the parser.
## Rationale
Keep record meaning consistent.
## Assumptions
- None recorded.
## Risks and caveats
- None recorded.
## Evidence snapshot
- kb/topics/evidence.md:3 — Supporting evidence
## Review history
- None recorded.
## Supersession
- None recorded.
`;
const parsed = parseDecision(fixture, "kb/decisions/example.md", "2026-09-07");
assert.equal(parsed.reviewState, "due");
assert.equal(parsed.projectId, "example");
assert.deepEqual(parsed.evidence, [
  { path: "kb/topics/evidence.md", line: 3, section: "Supporting evidence" },
]);
assert.throws(
  () => parseDecision(fixture.replace("schema_version: 1", "schema_version: 2"), parsed.path),
  /schema_version/,
);
assert.throws(() => parseDecision(fixture, "kb/decisions/another.md"), /canonical path/);
console.log("Decision record contract passed.");
