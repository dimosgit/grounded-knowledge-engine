#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../projects/project-service.js";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { createDecision, getDecision, listDecisions } from "./decision-record.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-decision-record-"));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "gke-decision-outside-"));

try {
  await fs.mkdir(path.join(root, "demo-kb"), { recursive: true });
  await fs.mkdir(path.join(root, "kb"), { recursive: true });
  const workspace = await loadWorkspaceContext({ repoRoot: root });
  await createProject({
    repoRoot: root,
    workspace,
    scanRoots: ["kb"],
    projectId: "alpha-pilot",
    title: "Alpha Pilot",
    workspaceId: "personal",
    owner: "decision-tester",
    sourceRoots: ["kb/sources/alpha-pilot"],
  });
  await write(
    root,
    "kb/sources/alpha-pilot/market.md",
    "# Market Evidence\n\nThe sanitized pilot evidence supports the recommendation.\n",
  );
  await write(
    root,
    "kb/sources/other/market.md",
    "# Other Evidence\n\nThis is not part of Alpha Pilot.\n",
  );

  const dryRun = await createDecision({
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    projectId: "alpha-pilot",
    title: "Select the pilot location",
    status: "active",
    owner: "decision-tester",
    decidedAt: "2026-07-29",
    evidenceCheckedAt: "2026-07-29",
    reviewAfter: "2026-08-20",
    confidence: "medium",
    tags: ["location", "pilot"],
    question: "Which location should host the pilot?",
    recommendation: "Use the sanitized Alpha location.",
    alternatives: ["Beta location", "Gamma location"],
    rationale: "The cited local evidence best supports Alpha.",
    assumptions: ["The pilot requirements remain stable."],
    risks: ["The evidence may become stale."],
    evidence: [{ path: "kb/sources/alpha-pilot/market.md", line: 3 }],
    dryRun: true,
  });
  assert.equal(dryRun.decisionId, "select-the-pilot-location");
  assert.equal(dryRun.path, "kb/decisions/select-the-pilot-location.md");
  assert.equal(await exists(path.join(root, dryRun.path)), false);
  assert.match(dryRun.content, /record_type: decision/);
  assert.match(dryRun.content, /kb\/sources\/alpha-pilot\/market\.md:3 — Market Evidence/);

  const created = await createDecision({
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    projectId: "alpha-pilot",
    title: "Select the pilot location",
    status: "active",
    owner: "decision-tester",
    decidedAt: "2026-07-29",
    evidenceCheckedAt: "2026-07-29",
    reviewAfter: "2026-08-20",
    confidence: "medium",
    tags: ["location", "pilot", "location"],
    question: "Which location should host the pilot?",
    recommendation: "Use the sanitized Alpha location.",
    alternatives: ["Beta location", "Gamma location"],
    rationale: "The cited local evidence best supports Alpha.",
    assumptions: ["The pilot requirements remain stable."],
    risks: ["The evidence may become stale."],
    evidence: [
      { path: "kb/sources/alpha-pilot/market.md", line: 3 },
      { path: "kb/sources/alpha-pilot/market.md", line: 3 },
    ],
  });
  assert.equal(created.dryRun, false);
  assert.deepEqual(created.tags, ["location", "pilot"]);
  assert.equal(created.evidence.length, 1);
  if (process.platform !== "win32") {
    const mode = (await fs.stat(path.join(root, created.path))).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  const byId = await getDecision(created.decisionId, {
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    asOf: "2026-08-20",
  });
  assert.equal(byId.reviewState, "due");
  assert.equal(byId.recommendation, "Use the sanitized Alpha location.");
  assert.deepEqual(byId.alternatives, ["Beta location", "Gamma location"]);
  assert.equal(byId.evidence[0].section, "Market Evidence");

  const byPath = await getDecision(created.path, {
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    asOf: "2026-08-21",
  });
  assert.equal(byPath.reviewState, "overdue");
  const byTitle = await getDecision("Select the pilot location", {
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    asOf: "2026-08-19",
  });
  assert.equal(byTitle.reviewState, "current");

  const filtered = await listDecisions({
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    projectId: "alpha-pilot",
    status: "active",
    reviewState: "overdue",
    owner: "decision-tester",
    tag: "pilot",
    asOf: "2026-08-21",
  });
  assert.deepEqual(
    filtered.map((decision) => decision.decisionId),
    [created.decisionId],
  );

  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        decisionId: created.decisionId,
        title: "Duplicate ID",
        owner: "decision-tester",
        decidedAt: "2026-07-30",
        evidenceCheckedAt: "2026-07-30",
        reviewAfter: "2026-08-30",
        confidence: "low",
        question: "Should this duplicate exist?",
        recommendation: "No.",
        rationale: "IDs are unique.",
      }),
    /Decision ID already exists/,
  );
  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        projectId: "alpha-pilot",
        title: "Out of scope evidence",
        owner: "decision-tester",
        decidedAt: "2026-07-30",
        evidenceCheckedAt: "2026-07-30",
        reviewAfter: "2026-08-30",
        confidence: "low",
        question: "Can unrelated evidence be cited?",
        recommendation: "No.",
        rationale: "Project scope is explicit.",
        evidence: [{ path: "kb/sources/other/market.md", line: 3 }],
      }),
    /outside explicit project scope/,
  );
  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        title: "Invalid date",
        owner: "decision-tester",
        decidedAt: "2026-02-30",
        evidenceCheckedAt: "2026-07-30",
        reviewAfter: "2026-08-30",
        confidence: "low",
        question: "Is the date valid?",
        recommendation: "No.",
        rationale: "The calendar rejects it.",
      }),
    /valid YYYY-MM-DD/,
  );
  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        title: "Injected section",
        owner: "decision-tester",
        decidedAt: "2026-07-30",
        evidenceCheckedAt: "2026-07-30",
        reviewAfter: "2026-08-30",
        confidence: "low",
        question: "Can a section be injected?",
        recommendation: "No.\n\n## Review history\n\nInjected.",
        rationale: "Stable sections are required.",
      }),
    /cannot inject decision section headings/,
  );
  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        title: "Ungrounded active decision",
        status: "active",
        owner: "decision-tester",
        decidedAt: "2026-07-30",
        evidenceCheckedAt: "2026-07-30",
        reviewAfter: "2026-08-30",
        confidence: "low",
        question: "Can an active decision omit evidence?",
        recommendation: "No.",
        rationale: "Active recommendations must be grounded.",
      }),
    /requires at least one evidence citation/,
  );
  await assert.rejects(
    () =>
      listDecisions({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        reviewState: "unknown" as never,
      }),
    /reviewState must be current, due, or overdue/,
  );

  const outsideEvidence = path.join(outside, "outside.md");
  await fs.writeFile(outsideEvidence, "# Outside\n\nNot allowed.\n", "utf8");
  const linkedEvidence = path.join(root, "kb", "sources", "alpha-pilot", "linked.md");
  try {
    await fs.symlink(outsideEvidence, linkedEvidence);
    await assert.rejects(
      () =>
        createDecision({
          repoRoot: root,
          workspace,
          scanRoots: ["demo-kb", "kb"],
          projectId: "alpha-pilot",
          title: "Symlink escape",
          owner: "decision-tester",
          decidedAt: "2026-07-30",
          evidenceCheckedAt: "2026-07-30",
          reviewAfter: "2026-08-30",
          confidence: "low",
          question: "Can a symlink escape?",
          recommendation: "No.",
          rationale: "Workspace confinement blocks it.",
          evidence: [{ path: "kb/sources/alpha-pilot/linked.md", line: 1 }],
        }),
      /outside.*root|symlink/i,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const concurrentOptions = {
    repoRoot: root,
    workspace,
    scanRoots: ["demo-kb", "kb"],
    title: "Concurrent decision",
    owner: "decision-tester",
    decidedAt: "2026-07-30",
    evidenceCheckedAt: "2026-07-30",
    reviewAfter: "2026-08-30",
    confidence: "low" as const,
    question: "Should one record win?",
    recommendation: "Yes.",
    rationale: "Creation is append-only.",
  };
  const concurrent = await Promise.allSettled([
    createDecision(concurrentOptions),
    createDecision(concurrentOptions),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

  const cliCreate = await runCli([
    "create",
    "cli-decision",
    "--repo-root",
    root,
    "--title",
    "CLI decision",
    "--status",
    "proposed",
    "--owner",
    "decision-tester",
    "--decided-at",
    "2026-07-31",
    "--evidence-checked-at",
    "2026-07-31",
    "--review-after",
    "2026-08-01",
    "--confidence",
    "high",
    "--question",
    "Does the CLI work?",
    "--recommendation",
    "Use the deterministic CLI.",
    "--rationale",
    "The domain service remains shared.",
    "--json",
  ]);
  assert.equal(cliCreate.code, 0, cliCreate.stderr);
  assert.equal(JSON.parse(cliCreate.stdout).decisionId, "cli-decision");

  const cliGet = await runCli([
    "get",
    "cli-decision",
    "--repo-root",
    root,
    "--as-of",
    "2026-08-02",
  ]);
  assert.equal(cliGet.code, 0, cliGet.stderr);
  assert.match(cliGet.stdout, /Warning: decision evidence review is overdue/);

  const cliList = await runCli([
    "list",
    "--repo-root",
    root,
    "--review-state",
    "overdue",
    "--as-of",
    "2026-08-21",
    "--json",
  ]);
  assert.equal(cliList.code, 0, cliList.stderr);
  assert.ok(JSON.parse(cliList.stdout).length >= 2);

  const demoDuplicate = "demo-kb/decisions/workspace-duplicate.md";
  await write(
    root,
    demoDuplicate,
    `---
schema_version: 1
record_type: decision
decision_id: workspace-duplicate
---
`,
  );
  await assert.rejects(
    () =>
      createDecision({
        repoRoot: root,
        workspace,
        scanRoots: ["demo-kb", "kb"],
        decisionId: "workspace-duplicate",
        title: "Workspace duplicate",
        owner: "decision-tester",
        decidedAt: "2026-07-31",
        evidenceCheckedAt: "2026-07-31",
        reviewAfter: "2026-08-31",
        confidence: "low",
        question: "Can IDs repeat across roots?",
        recommendation: "No.",
        rationale: "The active workspace owns the ID namespace.",
      }),
    /Decision ID already exists.*demo-kb/,
  );
  await fs.rm(path.join(root, demoDuplicate));

  await fs.mkdir(path.join(root, ".gke"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".gke", "workspace.json"),
    `${JSON.stringify(
      {
        id: "read-only-decisions",
        label: "Read-only decisions",
        scanRoots: ["demo-kb", "kb"],
        writeRoots: ["kb", ".gke"],
        readOnly: true,
        sensitivity: "internal",
      },
      null,
      2,
    )}\n`,
  );
  const readOnly = await runCli([
    "create",
    "blocked-decision",
    "--repo-root",
    root,
    "--title",
    "Blocked decision",
    "--owner",
    "decision-tester",
    "--decided-at",
    "2026-08-01",
    "--evidence-checked-at",
    "2026-08-01",
    "--review-after",
    "2026-09-01",
    "--confidence",
    "low",
    "--question",
    "Can a read-only workspace write?",
    "--recommendation",
    "No.",
    "--rationale",
    "Workspace policy must fail closed.",
  ]);
  assert.equal(readOnly.code, 1);
  assert.match(readOnly.stderr, /read-only/i);
  assert.equal(await exists(path.join(root, "kb/decisions/blocked-decision.md")), false);

  console.log("Decision record service and CLI tests passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
}

async function write(repoRoot: string, relPath: string, content: string): Promise<void> {
  const target = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const tsxBin = path.resolve("node_modules/.bin/tsx");
  const cliPath = path.resolve("tools/cli.ts");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, cliPath, "decisions", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
