#!/usr/bin/env node
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnKbServer } from "../kb-mcp-server/mcp-client.js";
import { formatTechnicalPeerHandoff, resumeProject } from "./index.js";

const publicRepoRoot = process.cwd();
const canonicalDemo = await resumeProject({ projectId: "router-rollout" }, publicRepoRoot, ["demo-kb", "kb"]);
assert.equal(canonicalDemo.structured.title, "Router Rollout");
assert.match(canonicalDemo.structured.currentFocus, /project-resume capsule/i);
assert.ok(canonicalDemo.structured.keyDocuments.includes("demo-kb/sources/router-rollout/evidence.md"));
assert.ok(!canonicalDemo.contentText.includes("transport project"));

const legacyDemo = await resumeProject({ projectId: "project-tracking" }, publicRepoRoot, ["demo-kb", "kb"]);
assert.equal(legacyDemo.structured.title, "Router Project Board");
assert.equal(legacyDemo.structured.nextThreeActions.length, 3);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-context-"));

try {
  await write(
    "kb/projects/client-alpha/project.md",
    `---
schema_version: 1
record_type: project
project_id: client-alpha
title: Client Alpha Rollout
status: active
source_roots: kb/sources/client-alpha
---
# Client Alpha Rollout

## Outcome
Deploy the pilot safely.

## Current focus
Validate the deployment checklist.

## Last meaningful change
The API contract was approved and the implementation
now uses the shared parser.

## Active decisions
- Use the regional pilot.

## Blockers
- Waiting for security review.

## Open questions
- Who owns production access?

## Next actions
1. Finish the checklist.
2. Run the dry run.
3. Record the result.
4. Ignore this fourth action.

## Key documents
- kb/sources/client-alpha/evidence.md
`,
  );
  await write(
    "kb/sources/client-alpha/evidence.md",
    `---
record_type: source
project_id: client-alpha
---
# Shared Pilot Deployment Review

Alpha-only marker.
`,
  );
  await write(
    "kb/projects/client-beta/project.md",
    `---
schema_version: 1
record_type: project
project_id: client-beta
title: Client Beta Rollout
status: active
source_roots: kb/sources/client-beta
---
# Client Beta Rollout

## Current focus
Validate the deployment checklist.
`,
  );
  await write(
    "kb/sources/client-beta/evidence.md",
    `---
record_type: source
project_id: client-beta
---
# Shared Pilot Deployment Review

Beta-only secret marker.
`,
  );

  const alpha = await resumeProject({ projectId: "client-alpha" }, root, ["kb"]);
  assert.equal(alpha.structured.title, "Client Alpha Rollout");
  assert.equal(alpha.structured.currentFocus, "Validate the deployment checklist.");
  assert.equal(
    alpha.structured.recentChanges,
    "The API contract was approved and the implementation now uses the shared parser.",
  );
  assert.deepEqual(alpha.structured.nextThreeActions, [
    "Finish the checklist.",
    "Run the dry run.",
    "Record the result.",
  ]);
  assert.ok(alpha.structured.keyDocuments.includes("kb/sources/client-alpha/evidence.md"));
  assert.ok(!alpha.contentText.includes("Beta-only"));
  assert.ok(alpha.structured.citations.every((citation) => citation.path === "kb/projects/client-alpha/project.md"));
  assert.match(formatTechnicalPeerHandoff(alpha.structured), /Technical handoff: Client Alpha Rollout/);

  await assert.rejects(
    () => resumeProject({ projectId: "missing-project" }, root, ["kb"]),
    /Unknown project ID/,
  );
  await assert.rejects(
    () => resumeProject({ projectId: "client-alpha" }, root, ["does-not-exist"]),
    /Unknown project ID/,
  );

  const { child, client } = spawnKbServer({
    KB_MCP_REPO_ROOT: root,
    KB_MCP_SCAN_ROOTS: "kb",
    KB_MCP_PROFILE: "core",
    KB_MCP_ENABLE_WRITES: "false",
  });
  try {
    await client.initialize("project-context-test");
    const resumed = await client.callTool("kb.resume_project", { projectId: "client-alpha" });
    assert.equal(resumed.structuredContent?.projectId, "client-alpha");
    const resource = await client.request("resources/read", {
      uri: "gke://project/client-alpha/context",
    });
    assert.match(resource.contents?.[0]?.text || "", /Client Alpha Rollout/);
  } finally {
    child.kill("SIGTERM");
  }

  console.log("Project Context contract passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function write(relPath: string, content: string): Promise<void> {
  const target = path.join(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}
