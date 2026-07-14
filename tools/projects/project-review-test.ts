import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { reviewWorkspace } from "./project-review.js";
import { calculateProjectAttention } from "./project-attention.js";

const execFileAsync = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-project-review-"));

try {
  assert.deepEqual(
    calculateProjectAttention({
      reviewAfter: "2026-07-13",
      asOf: "2026-07-13T18:30:00.000Z",
      status: "active",
      blockers: ["Approval pending."],
      openQuestions: ["Who signs?"],
    }),
    {
      reviewState: "due",
      daysUntilReview: 0,
      needsAttention: true,
      attentionReasons: ["Review due 2026-07-13", "1 blocker", "1 open question"],
    },
  );
  assert.deepEqual(
    calculateProjectAttention({
      reviewAfter: "2026-07-01",
      asOf: "2026-07-13",
      status: "completed",
      blockers: ["Historical only."],
    }),
    {
      reviewState: "not-applicable",
      daysUntilReview: null,
      needsAttention: false,
      attentionReasons: [],
    },
  );

  await writeProject("alpha", {
    title: "Alpha Rollout",
    status: "active",
    reviewAfter: "2026-07-10",
    sourceRoot: "kb/sources/alpha",
    blockers: ["Security approval is pending."],
    questions: ["Who owns production access?"],
  });
  await writeProject("due-today", {
    title: "Due Today",
    status: "active",
    reviewAfter: "2026-07-13",
    sourceRoot: "kb/sources/due-today",
  });
  await writeProject("beta", {
    title: "Beta Rollout",
    status: "active",
    reviewAfter: "2026-07-20",
    sourceRoot: "kb/sources/beta",
  });
  await writeProject("unscheduled", {
    title: "Unscheduled Work",
    status: "active",
    reviewAfter: "",
    sourceRoot: "kb/sources/unscheduled",
  });
  await writeProject("completed", {
    title: "Completed Work",
    status: "completed",
    reviewAfter: "2026-07-01",
    sourceRoot: "kb/sources/completed",
    blockers: ["Historical blocker."],
  });
  await write(
    "kb/sources/alpha/evidence.md",
    "---\nrecord_type: source\nproject_id: alpha\nupdated: 2026-07-01\n---\n# Alpha Evidence\n\nBaseline.\n",
  );
  await write(
    "kb/sources/beta/evidence.md",
    "---\nrecord_type: source\nproject_id: beta\nupdated: 2026-07-01\n---\n# Beta Evidence\n\nBaseline.\n",
  );

  await git(["init"]);
  await git(["config", "user.email", "tests@example.invalid"]);
  await git(["config", "user.name", "GKE Tests"]);
  await git(["add", "kb"]);
  await git(["commit", "-m", "baseline"], "2026-07-01T12:00:00Z");

  await write(
    "kb/sources/alpha/evidence.md",
    "---\nrecord_type: source\nproject_id: alpha\nupdated: 2026-07-12\n---\n# Alpha Evidence\n\nChanged after the review window.\n",
  );
  await write(
    "kb/sources/beta/evidence.md",
    "---\nrecord_type: source\nproject_id: beta\nupdated: 2026-07-12\n---\n# Beta Evidence\n\nChanged independently.\n",
  );
  await git(["add", "kb/sources/alpha/evidence.md", "kb/sources/beta/evidence.md"]);
  await git(["commit", "-m", "update evidence"], "2026-07-12T12:00:00Z");

  await write(
    "kb/sources/alpha/local-note.md",
    "---\nrecord_type: source\nproject_id: alpha\nupdated: 2026-07-11\n---\n# Local Alpha Note\n\nIgnored or untracked workspace evidence.\n",
  );
  await write(
    "kb/sources/alpha/mtime-note.md",
    "---\nrecord_type: source\nproject_id: alpha\n---\n# Mtime Alpha Note\n\nPortable timestamp fallback.\n",
  );
  const mtime = new Date("2026-07-11T15:00:00.000Z");
  await fs.utimes(path.join(root, "kb/sources/alpha/mtime-note.md"), mtime, mtime);

  const alpha = await reviewWorkspace(
    {
      projectId: "alpha",
      asOf: "2026-07-13",
      since: "2026-07-10T00:00:00Z",
    },
    root,
    ["kb"],
  );
  assert.equal(alpha.structured.projectCount, 1);
  assert.equal(alpha.structured.attentionCount, 1);
  const alphaReview = alpha.structured.projects[0];
  assert.equal(alphaReview.reviewState, "overdue");
  assert.equal(alphaReview.daysUntilReview, -3);
  assert.deepEqual(alphaReview.blockers, ["Security approval is pending."]);
  assert.deepEqual(alphaReview.openQuestions, ["Who owns production access?"]);
  assert.ok(alphaReview.attentionReasons.some((reason) => /overdue/i.test(reason)));
  const alphaChanges = new Map(
    alphaReview.changedDocuments.map((document) => [document.path, document]),
  );
  assert.equal(alphaChanges.get("kb/sources/alpha/evidence.md")?.source, "git");
  assert.equal(alphaChanges.get("kb/sources/alpha/local-note.md")?.source, "frontmatter");
  assert.equal(alphaChanges.get("kb/sources/alpha/mtime-note.md")?.source, "mtime");
  assert.ok(
    alphaReview.changedDocuments.every((document) => !document.path.includes("sources/beta")),
  );
  assert.ok(alphaReview.changedDocuments.every((document) => document.citation.line > 0));
  assert.match(alpha.contentText, /Workspace review/);
  assert.match(alpha.contentText, /kb\/sources\/alpha\/evidence\.md/);

  const all = await reviewWorkspace({ asOf: "2026-07-13" }, root, ["kb"]);
  assert.deepEqual(
    all.structured.projects.map((project) => project.reviewState),
    ["overdue", "due", "scheduled", "unscheduled", "not-applicable"],
  );
  assert.equal(
    all.structured.projects.find((project) => project.projectId === "completed")?.needsAttention,
    false,
  );
  assert.equal(
    all.structured.projects.find((project) => project.projectId === "unscheduled")?.daysUntilReview,
    null,
  );

  const due = await reviewWorkspace({ asOf: "2026-07-13", state: "due" }, root, ["kb"]);
  assert.deepEqual(
    due.structured.projects.map((project) => project.projectId),
    ["due-today"],
  );

  await assert.rejects(
    () => reviewWorkspace({ asOf: "2026-02-30" }, root, ["kb"]),
    /asOf must be an ISO date or timestamp/,
  );
  await assert.rejects(
    () => reviewWorkspace({ asOf: "2026-07-10", since: "2026-07-11T00:00:00Z" }, root, ["kb"]),
    /since must not be later than asOf/,
  );
  await assert.rejects(
    () => reviewWorkspace({ projectId: "missing", asOf: "2026-07-13" }, root, ["kb"]),
    /Unknown project ID/,
  );

  console.log("Project review service tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function writeProject(
  projectId: string,
  options: {
    title: string;
    status: string;
    reviewAfter: string;
    sourceRoot: string;
    blockers?: string[];
    questions?: string[];
  },
): Promise<void> {
  await write(
    `kb/projects/${projectId}/project.md`,
    `---
schema_version: 1
record_type: project
workspace_id: test
project_id: ${projectId}
title: ${options.title}
status: ${options.status}
owner: test
track: test
started_at: 2026-07-01
updated: 2026-07-01
review_after: ${options.reviewAfter}
source_roots: ${options.sourceRoot}
---
# ${options.title}

## Outcome
Deliver safely.

## Blockers
${renderItems(options.blockers)}

## Open questions
${renderItems(options.questions)}
`,
  );
}

function renderItems(items: string[] | undefined): string {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded.";
}

async function write(relPath: string, content: string): Promise<void> {
  const target = path.join(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function git(args: string[], date?: string): Promise<void> {
  const env = date
    ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    : process.env;
  await execFileAsync("git", ["-C", root, ...args], { env, encoding: "utf8" });
}
